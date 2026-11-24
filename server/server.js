import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, getSettings, saveSettings, tx } from './db.js';
import { addDays, diffDays, isDate, isoWeekday, mondayOf, today } from './dates.js';

const PORT = Number(process.env.PORT) || 8080;
const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

// ---------------------------------------------------------------- helpers

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);
const notFound = (msg = 'Não encontrado') => new HttpError(404, msg);

function str(v, max = 20000) {
  if (v === undefined || v === null) return '';
  return String(v).slice(0, max);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function dishRow(d) {
  if (!d) return null;
  return {
    id: d.id,
    name: d.name,
    ingredients: d.ingredients,
    recipe: d.recipe,
    active: !!d.active,
    hasRecipe: d.recipe.trim().length > 0,
  };
}

const getDish = (id) => dishRow(db.prepare('SELECT * FROM dishes WHERE id = ?').get(id));

function patternDays(start, pattern) {
  return Object.entries(pattern)
    .map(([wd, slot]) => ({ wd: Number(wd), slot: Number(slot) }))
    .filter((p) => p.wd >= 1 && p.wd <= 7 && p.slot >= 1)
    .sort((a, b) => a.wd - b.wd)
    .map((p) => ({ date: addDays(start, p.wd - 1), slot: p.slot }));
}

const numSlots = (pattern) => Math.max(0, ...Object.values(pattern).map(Number));

function getWeekSlots(start) {
  const row = db.prepare('SELECT slots FROM weeks WHERE start = ?').get(start);
  return row ? JSON.parse(row.slots) : {};
}

function setWeekSlots(start, slots) {
  db.prepare('INSERT INTO weeks(start, slots) VALUES (?, ?) ON CONFLICT(start) DO UPDATE SET slots = excluded.slots')
    .run(start, JSON.stringify(slots));
}

// Pratos usados nas N semanas anteriores (para não repetir no aleatório).
function recentDishIds(start, weeks) {
  if (!weeks) return new Set();
  const rows = db.prepare('SELECT DISTINCT dish_id FROM plan_days WHERE date >= ? AND date < ? AND dish_id IS NOT NULL')
    .all(addDays(start, -7 * weeks), start);
  return new Set(rows.map((r) => r.dish_id));
}

// Escolhe `count` pratos ativos ao acaso, evitando `exclude` e depois os recentes (se houver opções suficientes).
function pickRandom(count, exclude, recent) {
  const all = db.prepare('SELECT id FROM dishes WHERE active = 1').all().map((r) => r.id);
  const pool = all.filter((id) => !exclude.has(id));
  const fresh = shuffle(pool.filter((id) => !recent.has(id)));
  const stale = shuffle(pool.filter((id) => recent.has(id)));
  const picked = [...fresh, ...stale].slice(0, count);
  // Se não houver pratos suficientes, repete os que existem.
  while (picked.length < count && all.length) picked.push(all[Math.floor(Math.random() * all.length)]);
  return picked;
}

// Aplica os pratos dos slots aos dias da semana. Mantém o estado (comi/não comi) se o prato não mudou.
function applySlotsToDays(start, slots, onlySlot = null) {
  const { pattern } = getSettings();
  const getDay = db.prepare('SELECT * FROM plan_days WHERE date = ?');
  const upsert = db.prepare(`
    INSERT INTO plan_days(date, slot, dish_id, status, note) VALUES (?, ?, ?, 'planned', '')
    ON CONFLICT(date) DO UPDATE SET slot = excluded.slot, dish_id = excluded.dish_id,
      status = CASE WHEN plan_days.dish_id IS excluded.dish_id THEN plan_days.status ELSE 'planned' END,
      note   = CASE WHEN plan_days.dish_id IS excluded.dish_id THEN plan_days.note ELSE '' END`);

  for (const { date, slot } of patternDays(start, pattern)) {
    if (onlySlot !== null && slot !== onlySlot) continue;
    const existing = getDay.get(date);
    // Se o dia foi alterado à mão para um prato fora dos slots, não mexer quando se muda só um slot.
    if (onlySlot !== null && existing && existing.slot !== slot) continue;
    upsert.run(date, slot, slots[slot] ?? null);
  }
  // Dias fora do padrão mas associados a este slot (ex.: sábado adicionado à mão).
  if (onlySlot !== null) {
    db.prepare(`UPDATE plan_days SET dish_id = ?, status = CASE WHEN dish_id IS ? THEN status ELSE 'planned' END
                WHERE date >= ? AND date <= ? AND slot = ?`)
      .run(slots[onlySlot] ?? null, slots[onlySlot] ?? null, start, addDays(start, 6), onlySlot);
  }
}

// ---------------------------------------------------------------- soup

function soupStatus() {
  const s = getSettings();
  const batch = db.prepare('SELECT * FROM soup_batches ORDER BY made_on DESC, id DESC LIMIT 1').get();
  if (!batch) return { enabled: s.soupEnabled, current: null };
  const eaten = db.prepare('SELECT COUNT(*) AS n FROM soup_eaten WHERE batch_id = ?').get(batch.id).n;
  const age = diffDays(today(), batch.made_on);
  const remaining = batch.portions ? Math.max(0, batch.portions - eaten) : null;
  return {
    enabled: s.soupEnabled,
    current: { ...batch, eaten, remaining, ageDays: age, old: age > s.soupMaxDays, finished: remaining === 0 },
  };
}

function batchForDate(date) {
  return db.prepare('SELECT id FROM soup_batches WHERE made_on <= ? ORDER BY made_on DESC, id DESC LIMIT 1').get(date)?.id ?? null;
}

// ---------------------------------------------------------------- week view

function weekView(start) {
  const s = getSettings();
  const slotIds = getWeekSlots(start);
  const n = numSlots(s.pattern);
  const slots = {};
  for (let i = 1; i <= n; i++) slots[i] = slotIds[i] ? getDish(slotIds[i]) : null;

  const end = addDays(start, 6);
  const rows = db.prepare('SELECT * FROM plan_days WHERE date >= ? AND date <= ?').all(start, end);
  const byDate = Object.fromEntries(rows.map((r) => [r.date, r]));
  const soupDates = new Set(db.prepare('SELECT date FROM soup_eaten WHERE date >= ? AND date <= ?').all(start, end).map((r) => r.date));

  const planned = new Set(patternDays(start, s.pattern).map((d) => d.date));
  const days = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(start, i);
    const r = byDate[date];
    const inPattern = planned.has(date);
    if (!inPattern && !r && !soupDates.has(date)) {
      days.push({ date, weekday: i + 1, inPattern: false, empty: true, soup: false });
      continue;
    }
    days.push({
      date,
      weekday: i + 1,
      inPattern,
      empty: !r,
      slot: r?.slot ?? (inPattern ? s.pattern[i + 1] : null),
      dish: r?.dish_id ? getDish(r.dish_id) : null,
      status: r?.status ?? 'planned',
      note: r?.note ?? '',
      soup: soupDates.has(date),
    });
  }
  return { start, today: today(), numSlots: n, slots, generated: Object.keys(slotIds).length > 0, days, soup: soupStatus() };
}

// ---------------------------------------------------------------- stats

function stats() {
  const t = today();
  const rows = db.prepare(`SELECT p.*, d.name AS dish_name FROM plan_days p LEFT JOIN dishes d ON d.id = p.dish_id
                           WHERE p.date <= ? AND p.dish_id IS NOT NULL ORDER BY p.date`).all(t);
  const totals = { eaten: 0, skipped: 0, pending: 0 };
  const weeks = {};
  const dishCount = {};
  for (const r of rows) {
    const key = r.status === 'eaten' ? 'eaten' : r.status === 'skipped' ? 'skipped' : 'pending';
    totals[key]++;
    const w = mondayOf(r.date);
    weeks[w] ??= { start: w, eaten: 0, skipped: 0, pending: 0, days: [] };
    weeks[w][key]++;
    weeks[w].days.push({ date: r.date, dish: r.dish_name, status: r.status, note: r.note });
    if (r.status === 'eaten') dishCount[r.dish_name] = (dishCount[r.dish_name] || 0) + 1;
  }
  const decided = totals.eaten + totals.skipped;
  const topDishes = Object.entries(dishCount).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name, count }));

  const batches = db.prepare(`SELECT b.*, (SELECT COUNT(*) FROM soup_eaten e WHERE e.batch_id = b.id) AS eaten
                              FROM soup_batches b ORDER BY made_on DESC, id DESC`).all();
  const soup30 = db.prepare('SELECT COUNT(*) AS n FROM soup_eaten WHERE date > ? AND date <= ?').get(addDays(t, -30), t).n;
  let avgGap = null;
  if (batches.length > 1) {
    const span = diffDays(batches[0].made_on, batches[batches.length - 1].made_on);
    avgGap = Math.round((span / (batches.length - 1)) * 10) / 10;
  }
  return {
    totals,
    adherence: decided ? Math.round((totals.eaten / decided) * 100) : null,
    weeks: Object.values(weeks).sort((a, b) => b.start.localeCompare(a.start)).slice(0, 26),
    topDishes,
    soup: { batches: batches.length, eatenLast30: soup30, avgDaysBetweenBatches: avgGap },
  };
}

// ---------------------------------------------------------------- routes

const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler });
};

// Pratos
route('GET', '/api/dishes', () => {
  const rows = db.prepare(`SELECT d.*,
      (SELECT COUNT(*) FROM plan_days p WHERE p.dish_id = d.id AND p.status = 'eaten') AS times_eaten,
      (SELECT MAX(date) FROM plan_days p WHERE p.dish_id = d.id AND p.status = 'eaten') AS last_eaten
    FROM dishes d ORDER BY d.name COLLATE NOCASE`).all();
  return rows.map((r) => ({ ...dishRow(r), timesEaten: r.times_eaten, lastEaten: r.last_eaten }));
});

route('POST', '/api/dishes', ({ body }) => {
  const name = str(body.name, 200).trim();
  if (!name) throw bad('O prato precisa de um nome');
  const r = db.prepare('INSERT INTO dishes(name, ingredients, recipe, active) VALUES (?, ?, ?, ?)')
    .run(name, str(body.ingredients), str(body.recipe), body.active === false ? 0 : 1);
  return getDish(Number(r.lastInsertRowid));
});

route('POST', '/api/dishes/bulk', ({ body }) => {
  const names = str(body.names, 50000).split('\n').map((s) => s.trim()).filter(Boolean);
  const ins = db.prepare('INSERT INTO dishes(name) VALUES (?)');
  tx(() => names.forEach((n) => ins.run(n.slice(0, 200))));
  return { added: names.length };
});

route('PUT', '/api/dishes/:id', ({ params, body }) => {
  const d = getDish(Number(params.id));
  if (!d) throw notFound();
  const name = body.name !== undefined ? str(body.name, 200).trim() : d.name;
  if (!name) throw bad('O prato precisa de um nome');
  db.prepare('UPDATE dishes SET name = ?, ingredients = ?, recipe = ?, active = ? WHERE id = ?').run(
    name,
    body.ingredients !== undefined ? str(body.ingredients) : d.ingredients,
    body.recipe !== undefined ? str(body.recipe) : d.recipe,
    body.active !== undefined ? (body.active ? 1 : 0) : (d.active ? 1 : 0),
    d.id,
  );
  return getDish(d.id);
});

route('DELETE', '/api/dishes/:id', ({ params }) => {
  db.prepare('DELETE FROM dishes WHERE id = ?').run(Number(params.id));
  return { ok: true };
});

// Semana
route('GET', '/api/week/:start', ({ params }) => {
  if (!isDate(params.start)) throw bad('Data inválida');
  return weekView(mondayOf(params.start));
});

// Gera (ou volta a gerar) a semana. body.locked = { slot: dishId } para manter pratos.
route('POST', '/api/week/:start/generate', ({ params, body }) => {
  if (!isDate(params.start)) throw bad('Data inválida');
  const start = mondayOf(params.start);
  const s = getSettings();
  const n = numSlots(s.pattern);
  const locked = body.locked || {};
  const slots = {};
  const keep = new Set();
  for (let i = 1; i <= n; i++) {
    const id = Number(locked[i]);
    if (id && getDish(id)) { slots[i] = id; keep.add(id); }
  }
  const free = [];
  for (let i = 1; i <= n; i++) if (!slots[i]) free.push(i);
  const picked = pickRandom(free.length, keep, recentDishIds(start, s.avoidWeeks));
  free.forEach((slot, idx) => { slots[slot] = picked[idx] ?? null; });
  tx(() => { setWeekSlots(start, slots); applySlotsToDays(start, slots); });
  return weekView(start);
});

// Muda um slot: body.dishId para escolher, ou body.random = true para sortear outro.
route('PUT', '/api/week/:start/slot/:slot', ({ params, body }) => {
  if (!isDate(params.start)) throw bad('Data inválida');
  const start = mondayOf(params.start);
  const slot = Number(params.slot);
  const s = getSettings();
  if (!(slot >= 1 && slot <= numSlots(s.pattern))) throw bad('Prato inválido');
  const slots = getWeekSlots(start);
  if (body.random) {
    const others = new Set(Object.entries(slots).filter(([k]) => Number(k) !== slot).map(([, v]) => v));
    if (slots[slot]) others.add(slots[slot]);
    slots[slot] = pickRandom(1, others, recentDishIds(start, s.avoidWeeks))[0] ?? null;
  } else {
    const id = body.dishId ? Number(body.dishId) : null;
    if (id && !getDish(id)) throw notFound('Prato não existe');
    slots[slot] = id;
  }
  tx(() => { setWeekSlots(start, slots); applySlotsToDays(start, slots, slot); });
  return weekView(start);
});

route('DELETE', '/api/week/:start', ({ params }) => {
  if (!isDate(params.start)) throw bad('Data inválida');
  const start = mondayOf(params.start);
  tx(() => {
    db.prepare('DELETE FROM weeks WHERE start = ?').run(start);
    db.prepare('DELETE FROM plan_days WHERE date >= ? AND date <= ?').run(start, addDays(start, 6));
  });
  return weekView(start);
});

route('GET', '/api/week/:start/shopping', ({ params }) => {
  if (!isDate(params.start)) throw bad('Data inválida');
  const start = mondayOf(params.start);
  const rows = db.prepare(`SELECT d.id, d.name, d.ingredients, COUNT(*) AS days FROM plan_days p JOIN dishes d ON d.id = p.dish_id
                           WHERE p.date >= ? AND p.date <= ? GROUP BY d.id ORDER BY MIN(p.date)`).all(start, addDays(start, 6));
  return rows.map((r) => ({
    id: r.id, name: r.name, days: r.days,
    ingredients: r.ingredients.split('\n').map((s) => s.trim()).filter(Boolean),
  }));
});

// Dia: alterar prato (dishId ou slot), estado (planned|eaten|skipped) e nota.
route('PUT', '/api/day/:date', ({ params, body }) => {
  const { date } = params;
  if (!isDate(date)) throw bad('Data inválida');
  const cur = db.prepare('SELECT * FROM plan_days WHERE date = ?').get(date) || { slot: null, dish_id: null, status: 'planned', note: '' };
  let { slot, dish_id: dishId, status, note } = cur;
  if (body.slot !== undefined) {
    slot = body.slot ? Number(body.slot) : null;
    if (slot) dishId = getWeekSlots(mondayOf(date))[slot] ?? null;
  }
  if (body.dishId !== undefined) {
    dishId = body.dishId ? Number(body.dishId) : null;
    if (dishId && !getDish(dishId)) throw notFound('Prato não existe');
    if (body.slot === undefined) slot = null;
  }
  if (body.status !== undefined) {
    if (!['planned', 'eaten', 'skipped'].includes(body.status)) throw bad('Estado inválido');
    status = body.status;
  }
  if (body.note !== undefined) note = str(body.note, 500);
  db.prepare(`INSERT INTO plan_days(date, slot, dish_id, status, note) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(date) DO UPDATE SET slot = excluded.slot, dish_id = excluded.dish_id, status = excluded.status, note = excluded.note`)
    .run(date, slot, dishId, status, note);
  return weekView(mondayOf(date));
});

route('DELETE', '/api/day/:date', ({ params }) => {
  if (!isDate(params.date)) throw bad('Data inválida');
  db.prepare('DELETE FROM plan_days WHERE date = ?').run(params.date);
  return weekView(mondayOf(params.date));
});

// Sopa
route('GET', '/api/soup', () => {
  const batches = db.prepare(`SELECT b.*, (SELECT COUNT(*) FROM soup_eaten e WHERE e.batch_id = b.id) AS eaten
                              FROM soup_batches b ORDER BY made_on DESC, id DESC LIMIT 50`).all();
  const log = db.prepare(`SELECT e.date, e.batch_id, b.name FROM soup_eaten e LEFT JOIN soup_batches b ON b.id = e.batch_id
                          ORDER BY e.date DESC LIMIT 60`).all();
  return { status: soupStatus(), batches, log, today: today() };
});

route('POST', '/api/soup/batches', ({ body }) => {
  const madeOn = isDate(body.madeOn) ? body.madeOn : today();
  const portions = body.portions === '' || body.portions == null ? null : Math.max(0, Number(body.portions) || 0) || null;
  const r = db.prepare('INSERT INTO soup_batches(name, made_on, portions, notes) VALUES (?, ?, ?, ?)')
    .run(str(body.name, 200).trim() || 'Sopa', madeOn, portions, str(body.notes, 1000));
  // Refeições de sopa a partir desta data passam a contar para esta panela.
  db.prepare('UPDATE soup_eaten SET batch_id = ? WHERE date >= ? AND (batch_id IS NULL OR batch_id IN (SELECT id FROM soup_batches WHERE made_on < ?))')
    .run(Number(r.lastInsertRowid), madeOn, madeOn);
  return soupStatus();
});

route('PUT', '/api/soup/batches/:id', ({ params, body }) => {
  const b = db.prepare('SELECT * FROM soup_batches WHERE id = ?').get(Number(params.id));
  if (!b) throw notFound();
  const portions = body.portions === undefined ? b.portions : (Number(body.portions) || null);
  db.prepare('UPDATE soup_batches SET name = ?, made_on = ?, portions = ?, notes = ? WHERE id = ?').run(
    body.name !== undefined ? (str(body.name, 200).trim() || 'Sopa') : b.name,
    isDate(body.madeOn) ? body.madeOn : b.made_on,
    portions,
    body.notes !== undefined ? str(body.notes, 1000) : b.notes,
    b.id,
  );
  return { ok: true };
});

route('DELETE', '/api/soup/batches/:id', ({ params }) => {
  db.prepare('DELETE FROM soup_batches WHERE id = ?').run(Number(params.id));
  return { ok: true };
});

route('POST', '/api/soup/eaten', ({ body }) => {
  const date = isDate(body.date) ? body.date : today();
  db.prepare('INSERT INTO soup_eaten(date, batch_id) VALUES (?, ?) ON CONFLICT(date) DO NOTHING').run(date, batchForDate(date));
  return soupStatus();
});

route('DELETE', '/api/soup/eaten/:date', ({ params }) => {
  db.prepare('DELETE FROM soup_eaten WHERE date = ?').run(params.date);
  return soupStatus();
});

// Histórico / definições / backup
route('GET', '/api/stats', () => stats());
route('GET', '/api/settings', () => getSettings());

route('PUT', '/api/settings', ({ body }) => {
  const patch = {};
  if (body.pattern && typeof body.pattern === 'object') {
    const p = {};
    for (const [wd, slot] of Object.entries(body.pattern)) {
      const w = Number(wd), sl = Number(slot);
      if (w >= 1 && w <= 7 && sl >= 1 && sl <= 7) p[w] = sl;
    }
    patch.pattern = p;
  }
  if (body.avoidWeeks !== undefined) patch.avoidWeeks = Math.max(0, Math.min(8, Number(body.avoidWeeks) || 0));
  if (body.soupEnabled !== undefined) patch.soupEnabled = !!body.soupEnabled;
  if (body.soupPortions !== undefined) patch.soupPortions = Math.max(1, Math.min(30, Number(body.soupPortions) || 5));
  if (body.soupMaxDays !== undefined) patch.soupMaxDays = Math.max(1, Math.min(30, Number(body.soupMaxDays) || 5));
  return saveSettings(patch);
});

const TABLES = ['dishes', 'weeks', 'plan_days', 'soup_batches', 'soup_eaten', 'settings'];

route('GET', '/api/export', () => {
  const out = { app: 'marmitas', version: 1, exportedAt: new Date().toISOString() };
  for (const t of TABLES) out[t] = db.prepare(`SELECT * FROM ${t}`).all();
  return out;
});

route('POST', '/api/import', ({ body }) => {
  if (body?.app !== 'marmitas') throw bad('Ficheiro de backup inválido');
  tx(() => {
    for (const t of [...TABLES].reverse()) db.exec(`DELETE FROM ${t}`);
    for (const t of TABLES) {
      for (const row of body[t] || []) {
        const cols = Object.keys(row);
        if (!cols.every((c) => /^\w+$/.test(c))) throw bad('Coluna inválida');
        db.prepare(`INSERT INTO ${t}(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => row[c]));
      }
    }
  });
  return { ok: true };
});

route('GET', '/api/health', () => ({ ok: true }));

// ---------------------------------------------------------------- http server

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};

function serveStatic(req, res, pathname) {
  let file = path.join(PUBLIC_DIR, path.normalize(pathname).replace(/^([/\\])+/, ''));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403).end(); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC_DIR, 'index.html');
  const ext = path.extname(file);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
  });
  fs.createReadStream(file).pipe(res);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 20 * 1024 * 1024) { reject(new HttpError(413, 'Pedido demasiado grande')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(bad('JSON inválido')); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const { pathname } = url;
  if (!pathname.startsWith('/api/')) return serveStatic(req, res, decodeURIComponent(pathname));

  const send = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  };
  try {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = pathname.match(r.re);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : {};
      return send(200, await r.handler({ params, body, query: url.searchParams }));
    }
    send(404, { error: 'Rota não encontrada' });
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    send(e.status || 500, { error: e.status ? e.message : 'Erro interno' });
  }
});

server.listen(PORT, () => console.log(`Marmitas a correr em http://localhost:${PORT}`));

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { server.close(); db.close(); process.exit(0); });
}
