import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marmitas-'));
let proc;

async function api(method, url, body) {
  const r = await fetch(BASE + url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json() };
}

before(async () => {
  proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/server.js'], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir },
    stdio: 'inherit',
  });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE + '/api/health')).ok) return; } catch { /* a arrancar */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('servidor não arrancou');
});

after(async () => {
  if (proc && proc.exitCode === null) {
    const exited = new Promise((r) => proc.once('exit', r));
    proc.kill();
    await exited;
  }
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 }); } catch { /* Windows pode manter o ficheiro aberto */ }
});

const MONDAY = '2026-11-23';

test('cria pratos, incluindo em lote', async () => {
  const { data: d } = await api('POST', '/api/dishes', { name: 'Bifinhos com cogumelos', ingredients: 'bifinhos\ncogumelos' });
  assert.equal(d.name, 'Bifinhos com cogumelos');
  const { data: bulk } = await api('POST', '/api/dishes/bulk', { names: 'Arroz de pato\nMassa à bolonhesa\n\nFrango assado\nBacalhau com natas' });
  assert.equal(bulk.added, 4);
  const { data: all } = await api('GET', '/api/dishes');
  assert.equal(all.length, 5);
  const { status } = await api('POST', '/api/dishes', { name: '  ' });
  assert.equal(status, 400);
});

test('sorteia 3 pratos distintos com o padrão 1,2,3,1,3', async () => {
  const { data: w } = await api('POST', `/api/week/${MONDAY}/generate`, {});
  assert.equal(w.numSlots, 3);
  const ids = [1, 2, 3].map((i) => w.slots[i].id);
  assert.equal(new Set(ids).size, 3);
  const planned = w.days.filter((d) => d.inPattern);
  assert.deepEqual(planned.map((d) => d.slot), [1, 2, 3, 1, 3]);
  assert.equal(planned[0].dish.id, planned[3].dish.id);
  assert.equal(planned[2].dish.id, planned[4].dish.id);
  assert.ok(w.days[5].empty && w.days[6].empty);
});

test('fixar um prato mantém-no ao sortear de novo', async () => {
  const { data: w0 } = await api('GET', `/api/week/${MONDAY}`);
  const keep = w0.slots[2].id;
  for (let i = 0; i < 5; i++) {
    const { data: w } = await api('POST', `/api/week/${MONDAY}/generate`, { locked: { 2: keep } });
    assert.equal(w.slots[2].id, keep);
    assert.ok(![w.slots[1].id, w.slots[3].id].includes(keep));
  }
});

test('marcar comi / não comi e trocar um slot', async () => {
  let { data: w } = await api('PUT', '/api/day/2026-11-23', { status: 'eaten' });
  assert.equal(w.days[0].status, 'eaten');
  ({ data: w } = await api('PUT', '/api/day/2026-11-24', { status: 'skipped', note: 'almoço fora' }));
  assert.equal(w.days[1].status, 'skipped');
  assert.equal(w.days[1].note, 'almoço fora');

  const oldSlot1 = w.slots[1].id;
  ({ data: w } = await api('PUT', `/api/week/${MONDAY}/slot/1`, { random: true }));
  assert.notEqual(w.slots[1].id, oldSlot1);
  assert.equal(w.days[0].dish.id, w.slots[1].id);
  assert.equal(w.days[3].dish.id, w.slots[1].id);
  assert.equal(w.days[0].status, 'planned', 'prato mudou → estado volta a planeado');
  assert.equal(w.days[1].status, 'skipped', 'outros slots mantêm o estado');
});

test('dia fora do padrão pode ser planeado', async () => {
  const { data: w } = await api('PUT', '/api/day/2026-11-28', { slot: 2 });
  assert.equal(w.days[5].dish.id, w.slots[2].id);
  assert.equal(w.days[5].inPattern, false);
});

test('lista de compras junta ingredientes da semana', async () => {
  const { data: dishes } = await api('GET', '/api/dishes');
  const bif = dishes.find((d) => d.name.startsWith('Bifinhos'));
  await api('PUT', `/api/week/${MONDAY}/slot/3`, { dishId: bif.id });
  const { data: shop } = await api('GET', `/api/week/${MONDAY}/shopping`);
  const item = shop.find((s) => s.id === bif.id);
  assert.deepEqual(item.ingredients, ['bifinhos', 'cogumelos']);
  assert.ok(item.days >= 2);
});

test('sopa: panela, doses comidas e restantes', async () => {
  await api('POST', '/api/soup/eaten', { date: '2026-11-20' }); // antes de haver panela
  await api('POST', '/api/soup/batches', { name: 'Sopa de legumes', madeOn: '2026-11-22', portions: 4 });
  await api('POST', '/api/soup/eaten', { date: '2026-11-23' });
  let { data: s } = await api('POST', '/api/soup/eaten', { date: '2026-11-24' });
  assert.equal(s.current.name, 'Sopa de legumes');
  assert.equal(s.current.eaten, 2);
  assert.equal(s.current.remaining, 2);
  ({ data: s } = await api('DELETE', '/api/soup/eaten/2026-11-24'));
  assert.equal(s.current.eaten, 1);
  const { data: w } = await api('GET', `/api/week/${MONDAY}`);
  assert.equal(w.days[0].soup, true);
});

test('definições: mudar padrão para 2 pratos', async () => {
  const { data: s } = await api('PUT', '/api/settings', { pattern: { 1: 1, 2: 2, 3: 1, 4: 2 }, avoidWeeks: 0 });
  assert.deepEqual(s.pattern, { 1: 1, 2: 2, 3: 1, 4: 2 });
  const { data: w } = await api('POST', '/api/week/2026-11-30/generate', {});
  assert.equal(w.numSlots, 2);
  assert.equal(w.days.filter((d) => d.inPattern).length, 4);
  await api('PUT', '/api/settings', { pattern: { 1: 1, 2: 2, 3: 3, 4: 1, 5: 3 }, avoidWeeks: 1 });
});

test('estatísticas e exportar/importar', async () => {
  const { data: st } = await api('GET', '/api/stats');
  assert.ok(st.totals.eaten >= 0);
  const { data: dump } = await api('GET', '/api/export');
  assert.equal(dump.app, 'marmitas');
  const n = dump.dishes.length;
  await api('DELETE', `/api/dishes/${dump.dishes[0].id}`);
  await api('POST', '/api/import', dump);
  const { data: after } = await api('GET', '/api/dishes');
  assert.equal(after.length, n);
});

test('serve o frontend', async () => {
  const r = await fetch(BASE + '/');
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Marmitas/);
  const r2 = await fetch(BASE + '/../server/db.js');
  assert.ok(!(await r2.text()).includes('DatabaseSync'));
});
