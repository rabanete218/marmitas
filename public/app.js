// Marmitas — frontend (vanilla JS, sem build)

// ------------------------------------------------------------ utilitários
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const modal = $('#modal');
const modalBody = $('#modal-body');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Erro ${r.status}`);
  return data;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

const DOW = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
const DOW_SHORT = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const parseD = (d) => { const [y, m, x] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, x)); };
const fmtD = (dt) => dt.toISOString().slice(0, 10);
const addDays = (d, n) => { const dt = parseD(d); dt.setUTCDate(dt.getUTCDate() + n); return fmtD(dt); };
const isoWd = (d) => { const w = parseD(d).getUTCDay(); return w === 0 ? 7 : w; };
const mondayOf = (d) => addDays(d, 1 - isoWd(d));
const localToday = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; };
const dayNum = (d) => parseD(d).getUTCDate();
const shortDate = (d) => `${dayNum(d)} ${MONTHS[parseD(d).getUTCMonth()]}`;
const longDate = (d) => `${DOW[isoWd(d) - 1]}, ${shortDate(d)}`;
const rangeLabel = (start) => {
  const end = addDays(start, 6);
  const sameMonth = parseD(start).getUTCMonth() === parseD(end).getUTCMonth();
  return sameMonth ? `${dayNum(start)} – ${shortDate(end)}` : `${shortDate(start)} – ${shortDate(end)}`;
};
const daysAgo = (n) => (n === 0 ? 'hoje' : n === 1 ? 'ontem' : `há ${n} dias`);
const badge = (slot) => (slot ? `<span class="badge s${slot}">${slot}</span>` : '<span class="badge x">·</span>');

// ------------------------------------------------------------ modal
function openModal(html, onClick) {
  modalBody.innerHTML = html;
  modalBody.onclick = onClick || null;
  if (!modal.open) modal.showModal();
  const first = modalBody.querySelector('[autofocus]');
  if (first) first.focus();
}
function closeModal() { if (modal.open) modal.close(); }
modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

function confirmBox(title, text, okLabel = 'Confirmar', danger = false) {
  return new Promise((resolve) => {
    openModal(`
      <div class="modal-head"><h2>${esc(title)}</h2></div>
      <p class="muted">${esc(text)}</p>
      <div class="modal-foot">
        <button class="btn" data-a="no">Cancelar</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-a="yes" autofocus>${esc(okLabel)}</button>
      </div>`, (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      closeModal();
      resolve(a === 'yes');
    });
    modal.addEventListener('close', () => resolve(false), { once: true });
  });
}

// ------------------------------------------------------------ estado
const state = {
  weekStart: mondayOf(localToday()),
  week: null,
  locked: new Set(),     // slots fixos ao sortear
  dishes: [],
  settings: null,
};

async function loadDishes() { state.dishes = await api('GET', '/api/dishes'); return state.dishes; }
async function loadSettings() {
  state.settings = await api('GET', '/api/settings');
  $('#tab-sopa').hidden = !state.settings.soupEnabled;
  return state.settings;
}

// ------------------------------------------------------------ router
const routes = { semana: renderWeek, pratos: renderDishes, sopa: renderSoup, historico: renderHistory, definicoes: renderSettings };

async function router() {
  const tab = (location.hash.slice(1) || 'semana').split('/')[0];
  const fn = routes[tab] || renderWeek;
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === (routes[tab] ? tab : 'semana')));
  try { await fn(); } catch (e) { view.innerHTML = `<div class="empty-state"><span class="big">⚠️</span>${esc(e.message)}</div>`; }
}
window.addEventListener('hashchange', () => { closeModal(); router(); });

// ============================================================ SEMANA
async function renderWeek() {
  state.week = await api('GET', `/api/week/${state.weekStart}`);
  if (!state.dishes.length) await loadDishes();
  drawWeek();
}

function soupBanner(soup) {
  if (!soup?.enabled) return '';
  const c = soup.current;
  if (!c || c.finished) {
    return `<a class="soup-banner alert" href="#sopa"><span class="emoji">🥣</span><div><strong>${c ? 'A sopa acabou' : 'Ainda não há sopa registada'}</strong><span class="small muted">Toca para registar uma nova panela</span></div></a>`;
  }
  const left = c.remaining != null ? ` · ${c.remaining} ${c.remaining === 1 ? 'dose' : 'doses'}` : '';
  const warn = c.old ? ' — já tem uns dias, atenção' : '';
  return `<a class="soup-banner ${c.old ? 'alert' : ''}" href="#sopa"><span class="emoji">🥣</span><div><strong>${esc(c.name)}${left}</strong><span class="small muted">Feita ${daysAgo(c.ageDays)}${warn}</span></div></a>`;
}

function drawWeek() {
  const w = state.week;
  const isThisWeek = w.start === mondayOf(w.today);
  const title = isThisWeek ? 'Esta semana' : w.start === addDays(mondayOf(w.today), 7) ? 'Próxima semana' : w.start === addDays(mondayOf(w.today), -7) ? 'Semana passada' : 'Semana';
  const soupOn = w.soup?.enabled;

  let slotsHtml = '';
  for (let i = 1; i <= w.numSlots; i++) {
    const d = w.slots[i];
    const locked = state.locked.has(i);
    slotsHtml += `
      <div class="slot">
        ${badge(i)}
        <button class="slot-name ${d ? '' : 'empty'}" data-act="${d ? 'view-dish' : 'pick-slot'}" data-id="${d?.id ?? ''}" data-slot="${i}">${d ? esc(d.name) + (d.hasRecipe ? ' <span class="muted small">🧾</span>' : '') : 'por escolher'}</button>
        <div class="slot-tools">
          <button class="icon-btn ${locked ? 'on' : ''}" data-act="lock" data-slot="${i}" title="${locked ? 'Fixo (não muda ao sortear)' : 'Fixar este prato'}" aria-pressed="${locked}">${locked ? '🔒' : '🔓'}</button>
          <button class="icon-btn" data-act="reroll" data-slot="${i}" title="Sortear outro">🎲</button>
          <button class="icon-btn" data-act="pick-slot" data-slot="${i}" title="Escolher prato">✏️</button>
        </div>
      </div>`;
  }

  const noDishes = state.dishes.length === 0;
  const daysHtml = w.days.map((d) => dayCard(d, w.today, soupOn)).join('');

  view.innerHTML = `
    <div class="week-nav">
      <button class="icon-btn" data-act="prev" aria-label="Semana anterior">‹</button>
      <div class="title"><h1>${title}</h1><span>${rangeLabel(w.start)}</span>${isThisWeek ? '' : ' <button data-act="this-week">ir para hoje</button>'}</div>
      <button class="icon-btn" data-act="next" aria-label="Semana seguinte">›</button>
    </div>
    ${soupBanner(w.soup)}
    ${noDishes ? `<div class="card empty-state"><span class="big">🍽️</span>Ainda não tens pratos.<br><br><a class="btn primary" href="#pratos">Adicionar pratos</a></div>` : `
    <section class="card">
      <div class="card-head">
        <h2>Pratos da semana</h2>
        <button class="btn primary" data-act="generate">🎲 Sortear</button>
      </div>
      ${w.numSlots ? slotsHtml : '<p class="muted">Não tens dias configurados. Vai às Definições.</p>'}
      <div class="row-actions">
        <button class="btn" data-act="shopping">🛒 Lista de compras</button>
        ${w.generated ? '<button class="btn ghost danger" data-act="clear-week">Limpar semana</button>' : ''}
      </div>
    </section>`}
    <section class="days">${daysHtml}</section>`;
}

function dayCard(d, today, soupOn) {
  const isToday = d.date === today;
  const past = d.date <= today;
  const soupChip = soupOn && past ? `<button class="chip soup ${d.soup ? 'on' : ''}" data-act="soup" data-date="${d.date}" aria-pressed="${d.soup}">🥣 Sopa</button>` : '';

  if (d.empty && !d.inPattern) {
    return `
      <article class="day off ${isToday ? 'today' : ''}">
        <div class="day-date"><strong>${DOW_SHORT[d.weekday - 1]}</strong><span>${dayNum(d.date)}</span></div>
        <div class="day-main">
          <button class="chip" data-act="day-menu" data-date="${d.date}">+ planear</button>
          <div class="day-actions">${soupChip}</div>
        </div>
      </article>`;
  }

  const status = d.dish ? d.status : 'planned';
  const pending = past && d.dish && status === 'planned' && d.date < today;
  const statusChips = past && d.dish ? `
      <button class="chip ok ${status === 'eaten' ? 'on' : ''}" data-act="eaten" data-date="${d.date}" aria-pressed="${status === 'eaten'}">✓ Comi</button>
      <button class="chip no ${status === 'skipped' ? 'on' : ''}" data-act="skipped" data-date="${d.date}" aria-pressed="${status === 'skipped'}">✗ Não comi</button>` : '';
  const note = d.note ? `<div class="day-note">${status === 'skipped' ? 'Em vez disso: ' : ''}${esc(d.note)}</div>` : '';

  return `
    <article class="day ${isToday ? 'today' : ''} ${d.dish && status !== 'planned' ? status : ''}">
      <div class="day-date"><strong>${DOW_SHORT[d.weekday - 1]}</strong><span>${dayNum(d.date)}</span></div>
      <div class="day-main">
        <button class="day-dish" data-act="day-menu" data-date="${d.date}">
          ${badge(d.dish ? d.slot : null)}
          <span class="name ${d.dish ? '' : 'empty'}">${d.dish ? esc(d.dish.name) : 'nada planeado'}</span>
          ${pending ? '<span class="pending-tag">por confirmar</span>' : ''}
        </button>
        ${note}
        ${statusChips || soupChip ? `<div class="day-actions">${statusChips}${soupChip}</div>` : ''}
      </div>
    </article>`;
}

view.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || !view.contains(el)) return;
  const { act } = el.dataset;
  const slot = Number(el.dataset.slot);
  const date = el.dataset.date;
  const handler = weekActions[act] || dishActions[act] || soupActions[act];
  if (!handler) return;
  try { await handler({ el, slot, date, id: Number(el.dataset.id) }); } catch (err) { toast(err.message); }
});

const weekActions = {
  prev: async () => { state.weekStart = addDays(state.weekStart, -7); state.locked.clear(); await renderWeek(); },
  next: async () => { state.weekStart = addDays(state.weekStart, 7); state.locked.clear(); await renderWeek(); },
  'this-week': async () => { state.weekStart = mondayOf(localToday()); state.locked.clear(); await renderWeek(); },
  lock: async ({ slot }) => {
    if (state.locked.has(slot)) state.locked.delete(slot); else state.locked.add(slot);
    drawWeek();
  },
  generate: async () => {
    const hasStatus = state.week.days.some((d) => d.dish && d.status !== 'planned');
    if (hasStatus && !(await confirmBox('Sortear de novo?', 'Alguns dias já estão marcados. Os dias cujo prato mudar voltam a "planeado".', 'Sortear'))) return;
    const locked = {};
    for (const s of state.locked) if (state.week.slots[s]) locked[s] = state.week.slots[s].id;
    state.week = await api('POST', `/api/week/${state.weekStart}/generate`, { locked });
    drawWeek();
    toast('Semana sorteada 🎲');
  },
  reroll: async ({ slot }) => {
    state.week = await api('PUT', `/api/week/${state.weekStart}/slot/${slot}`, { random: true });
    drawWeek();
  },
  'pick-slot': async ({ slot }) => {
    const current = state.week.slots[slot]?.id;
    const id = await pickDish(`Prato ${slot} da semana`, current);
    if (id === undefined) return;
    state.week = await api('PUT', `/api/week/${state.weekStart}/slot/${slot}`, { dishId: id });
    drawWeek();
  },
  eaten: async ({ date }) => {
    const d = state.week.days.find((x) => x.date === date);
    const status = d.status === 'eaten' ? 'planned' : 'eaten';
    state.week = await api('PUT', `/api/day/${date}`, { status, note: '' });
    drawWeek();
  },
  skipped: async ({ date }) => {
    const d = state.week.days.find((x) => x.date === date);
    if (d.status === 'skipped') {
      state.week = await api('PUT', `/api/day/${date}`, { status: 'planned', note: '' });
      return drawWeek();
    }
    openModal(`
      <form id="skip-form">
        <div class="modal-head"><h2>Não comeste ${esc(d.dish.name)}</h2></div>
        <label class="field"><span>O que comeste em vez disso? (opcional)</span>
          <input type="text" name="note" maxlength="200" placeholder="ex.: almoço fora, pizza…" autofocus></label>
        <div class="modal-foot">
          <button type="button" class="btn" data-a="cancel">Cancelar</button>
          <button class="btn primary">Guardar</button>
        </div>
      </form>`, (ev) => { if (ev.target.closest('[data-a=cancel]')) closeModal(); });
    $('#skip-form').onsubmit = async (ev) => {
      ev.preventDefault();
      const note = new FormData(ev.target).get('note');
      state.week = await api('PUT', `/api/day/${date}`, { status: 'skipped', note });
      closeModal();
      drawWeek();
    };
  },
  soup: async ({ date }) => {
    const d = state.week.days.find((x) => x.date === date);
    if (d.soup) await api('DELETE', `/api/soup/eaten/${date}`);
    else await api('POST', '/api/soup/eaten', { date });
    await renderWeek();
  },
  'day-menu': async ({ date }) => dayMenu(date),
  shopping: async () => shoppingList(),
  'clear-week': async () => {
    if (!(await confirmBox('Limpar semana?', 'Apaga os pratos e as marcações desta semana (a sopa não é afetada).', 'Limpar', true))) return;
    state.week = await api('DELETE', `/api/week/${state.weekStart}`);
    state.locked.clear();
    drawWeek();
  },
};

function dayMenu(date) {
  const w = state.week;
  const d = w.days.find((x) => x.date === date);
  let slotOpts = '';
  for (let i = 1; i <= w.numSlots; i++) {
    const s = w.slots[i];
    if (!s) continue;
    const current = d.dish && d.slot === i;
    slotOpts += `<button class="option-btn ${current ? 'current' : ''}" data-a="slot" data-slot="${i}">${badge(i)}<span>${esc(s.name)}</span></button>`;
  }
  openModal(`
    <div class="modal-head"><div><h2>${longDate(date)}</h2>${d.dish ? `<p class="muted small">${esc(d.dish.name)}</p>` : ''}</div>
      <button class="icon-btn" data-a="close" aria-label="Fechar">✕</button></div>
    ${d.dish ? `<button class="btn block" data-a="view">🧾 Ver prato / receita</button>` : ''}
    ${slotOpts ? `<div class="section-label">Comer um dos pratos da semana</div>${slotOpts}` : ''}
    <div class="section-label">Ou outro prato</div>
    <button class="option-btn" data-a="other">✏️ <span>Escolher outro prato…</span></button>
    ${d.dish ? `<div class="modal-foot"><button class="btn danger" data-a="clear">Não planear este dia</button></div>` : ''}
  `, async (e) => {
    const a = e.target.closest('[data-a]');
    if (!a) return;
    try {
      switch (a.dataset.a) {
        case 'close': closeModal(); break;
        case 'view': showDish(d.dish.id); break;
        case 'slot':
          state.week = await api('PUT', `/api/day/${date}`, { slot: Number(a.dataset.slot) });
          closeModal(); drawWeek(); break;
        case 'other': {
          const id = await pickDish(longDate(date), d.dish?.id);
          if (id === undefined) return;
          state.week = await api('PUT', `/api/day/${date}`, { dishId: id });
          closeModal(); drawWeek(); break;
        }
        case 'clear':
          state.week = await api('DELETE', `/api/day/${date}`);
          closeModal(); drawWeek(); break;
      }
    } catch (err) { toast(err.message); }
  });
}

// Abre um seletor de pratos. Resolve com o id escolhido, null (sem prato) ou undefined (cancelado).
function pickDish(title, currentId) {
  return new Promise(async (resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; closeModal(); resolve(v); };
    const dishes = await loadDishes();
    const listHtml = (q) => {
      const f = q.trim().toLowerCase();
      const items = dishes.filter((d) => !f || d.name.toLowerCase().includes(f));
      return items.map((d) => `<button class="option-btn ${d.id === currentId ? 'current' : ''}" data-a="pick" data-id="${d.id}">
          <span style="flex:1">${esc(d.name)}</span>${d.active ? '' : '<span class="muted small">fora do sorteio</span>'}</button>`).join('')
        + (f ? `<button class="option-btn" data-a="new">➕ <span>Criar “${esc(q.trim())}”</span></button>` : '')
        + (!items.length && !f ? '<p class="muted">Sem pratos.</p>' : '');
    };
    openModal(`
      <div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" data-a="cancel" aria-label="Fechar">✕</button></div>
      <input type="search" id="pick-q" placeholder="Procurar ou criar prato…" autofocus>
      <div class="picker-list" id="pick-list">${listHtml('')}</div>`, async (e) => {
      const a = e.target.closest('[data-a]');
      if (!a) return;
      if (a.dataset.a === 'cancel') finish(undefined);
      if (a.dataset.a === 'pick') finish(Number(a.dataset.id));
      if (a.dataset.a === 'new') {
        try {
          const d = await api('POST', '/api/dishes', { name: $('#pick-q').value.trim() });
          await loadDishes();
          finish(d.id);
        } catch (err) { toast(err.message); }
      }
    });
    $('#pick-q').oninput = (e) => { $('#pick-list').innerHTML = listHtml(e.target.value); };
    modal.addEventListener('close', () => finish(undefined), { once: true });
  });
}

async function shoppingList() {
  const items = await api('GET', `/api/week/${state.weekStart}/shopping`);
  const key = `shop-${state.weekStart}`;
  let checked = new Set();
  try { checked = new Set(JSON.parse(localStorage.getItem(key) || '[]')); } catch { /* sem storage */ }

  const all = [];
  const seen = new Set();
  for (const d of items) for (const ing of d.ingredients) {
    const k = ing.toLowerCase();
    if (!seen.has(k)) { seen.add(k); all.push(ing); }
  }

  openModal(`
    <div class="modal-head"><div><h2>Lista de compras</h2><p class="muted small">${rangeLabel(state.weekStart)}</p></div>
      <button class="icon-btn" data-a="close" aria-label="Fechar">✕</button></div>
    ${!items.length ? '<p class="muted">Ainda não há pratos planeados nesta semana.</p>' : ''}
    ${all.map((ing) => `<label class="shop-item"><input type="checkbox" data-ing="${esc(ing.toLowerCase())}" ${checked.has(ing.toLowerCase()) ? 'checked' : ''}><span>${esc(ing)}</span></label>`).join('')}
    ${items.length ? `<div class="section-label">Pratos</div>
      <ul class="list">${items.map((d) => `<li><div class="grow"><div class="title">${esc(d.name)}</div><div class="muted small">${d.days}× na semana${d.ingredients.length ? '' : ' · sem ingredientes registados'}</div></div></li>`).join('')}</ul>` : ''}
    <div class="modal-foot"><button class="btn" data-a="copy">Copiar lista</button><button class="btn primary" data-a="close">Fechar</button></div>
  `, async (e) => {
    const a = e.target.closest('[data-a]');
    if (a?.dataset.a === 'close') closeModal();
    if (a?.dataset.a === 'copy') {
      const text = all.filter((i) => !checked.has(i.toLowerCase())).map((i) => `- ${i}`).join('\n') || items.map((d) => `- ${d.name}`).join('\n');
      try { await navigator.clipboard.writeText(text); toast('Lista copiada'); } catch { toast('Não foi possível copiar'); }
    }
  });
  modalBody.querySelectorAll('input[data-ing]').forEach((cb) => cb.addEventListener('change', () => {
    if (cb.checked) checked.add(cb.dataset.ing); else checked.delete(cb.dataset.ing);
    try { localStorage.setItem(key, JSON.stringify([...checked])); } catch { /* ignorar */ }
  }));
}

// ============================================================ PRATOS
let dishFilter = '';

async function renderDishes() {
  await loadDishes();
  drawDishes();
}

function drawDishes() {
  const f = dishFilter.trim().toLowerCase();
  const items = state.dishes.filter((d) => !f || d.name.toLowerCase().includes(f) || d.ingredients.toLowerCase().includes(f));
  const meta = (d) => {
    const ing = d.ingredients.split('\n').filter((s) => s.trim()).length;
    const parts = [];
    if (d.hasRecipe) parts.push('🧾 receita');
    if (ing) parts.push(`${ing} ingrediente${ing > 1 ? 's' : ''}`);
    if (d.timesEaten) parts.push(`comido ${d.timesEaten}×`);
    if (!d.active) parts.push('fora do sorteio');
    return parts.join(' · ');
  };
  view.innerHTML = `
    <div class="page-head"><h1>Pratos</h1><button class="btn primary" data-act="new-dish">+ Novo prato</button></div>
    ${state.dishes.length ? `<input type="search" id="dish-q" placeholder="Procurar por nome ou ingrediente…" value="${esc(dishFilter)}">` : ''}
    <section class="card" style="margin-top:12px">
      ${items.length ? `<ul class="list">${items.map((d) => `
        <li class="${d.active ? '' : 'inactive'}">
          <button class="rowlink" data-act="view-dish" data-id="${d.id}">
            <div class="title">${esc(d.name)}</div>
            <div class="muted small">${meta(d) || 'só o nome'}</div>
          </button>
          <button class="icon-btn" data-act="edit-dish" data-id="${d.id}" aria-label="Editar ${esc(d.name)}">✏️</button>
        </li>`).join('')}</ul>`
      : `<div class="empty-state"><span class="big">🍽️</span>${state.dishes.length ? 'Nada encontrado.' : 'Ainda não tens pratos. Basta o nome — ingredientes e receita são opcionais.'}</div>`}
    </section>
    <details class="card" style="margin-top:12px">
      <summary><strong>Adicionar vários de uma vez</strong></summary>
      <form id="bulk-form" class="stack" style="margin-top:10px">
        <textarea name="names" placeholder="Um prato por linha&#10;Bifinhos com cogumelos&#10;Arroz de pato&#10;Massa à bolonhesa"></textarea>
        <button class="btn primary">Adicionar</button>
      </form>
    </details>`;

  const q = $('#dish-q');
  if (q) q.oninput = (e) => {
    dishFilter = e.target.value;
    const pos = e.target.selectionStart;
    drawDishes();
    const nq = $('#dish-q'); nq.focus(); nq.setSelectionRange(pos, pos);
  };
  $('#bulk-form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api('POST', '/api/dishes/bulk', { names: new FormData(e.target).get('names') });
      toast(`${r.added} prato${r.added === 1 ? '' : 's'} adicionado${r.added === 1 ? '' : 's'}`);
      await renderDishes();
    } catch (err) { toast(err.message); }
  };
}

const dishActions = {
  'new-dish': async () => editDish(null),
  'edit-dish': async ({ id }) => editDish(id),
  'view-dish': async ({ id }) => showDish(id),
};

async function showDish(id) {
  await loadDishes();
  const d = state.dishes.find((x) => x.id === id);
  if (!d) return toast('Prato não encontrado');
  const ings = d.ingredients.split('\n').map((s) => s.trim()).filter(Boolean);
  openModal(`
    <div class="modal-head"><div><h2>${esc(d.name)}</h2>
      <p class="muted small">${d.timesEaten ? `Comido ${d.timesEaten}× · última vez ${shortDate(d.lastEaten)}` : 'Ainda não comido'}${d.active ? '' : ' · fora do sorteio'}</p></div>
      <button class="icon-btn" data-a="close" aria-label="Fechar">✕</button></div>
    ${ings.length ? `<div class="section-label">Ingredientes</div><ul class="ingredients">${ings.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
    ${d.hasRecipe ? `<div class="section-label">Receita</div><div class="recipe">${esc(d.recipe)}</div>` : ''}
    ${!ings.length && !d.hasRecipe ? '<p class="muted">Sem ingredientes nem receita. Podes adicionar quando quiseres.</p>' : ''}
    <div class="modal-foot"><button class="btn" data-a="edit">✏️ Editar</button><button class="btn primary" data-a="close">Fechar</button></div>
  `, (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'close') closeModal();
    if (a === 'edit') editDish(id);
  });
}

async function editDish(id) {
  await loadDishes();
  const d = id ? state.dishes.find((x) => x.id === id) : { name: '', ingredients: '', recipe: '', active: true };
  openModal(`
    <form id="dish-form" class="stack">
      <div class="modal-head"><h2>${id ? 'Editar prato' : 'Novo prato'}</h2><button type="button" class="icon-btn" data-a="close" aria-label="Fechar">✕</button></div>
      <label class="field"><span>Nome</span><input type="text" name="name" required maxlength="200" value="${esc(d.name)}" placeholder="ex.: Bifinhos com cogumelos" autofocus></label>
      <label class="field"><span>Ingredientes <span class="muted">(opcional)</span></span>
        <textarea name="ingredients" placeholder="Um por linha&#10;bifinhos&#10;cogumelos">${esc(d.ingredients)}</textarea>
        <small>Aparecem na lista de compras da semana.</small></label>
      <label class="field"><span>Receita <span class="muted">(opcional)</span></span>
        <textarea name="recipe" style="min-height:160px" placeholder="Passos, tempos, notas…">${esc(d.recipe)}</textarea></label>
      <label class="check"><input type="checkbox" name="active" ${d.active ? 'checked' : ''}> Incluir no sorteio</label>
      <div class="modal-foot">
        ${id ? '<button type="button" class="btn danger" data-a="delete">Apagar</button><span class="spacer"></span>' : ''}
        <button type="button" class="btn" data-a="close">Cancelar</button>
        <button class="btn primary">Guardar</button>
      </div>
    </form>`, async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'close') closeModal();
    if (a === 'delete') {
      if (!(await confirmBox('Apagar prato?', `"${d.name}" vai ser apagado. Os dias em que estava planeado ficam sem prato.`, 'Apagar', true))) return;
      await api('DELETE', `/api/dishes/${id}`);
      toast('Prato apagado');
      await router();
    }
  });
  $('#dish-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = { name: fd.get('name'), ingredients: fd.get('ingredients'), recipe: fd.get('recipe'), active: fd.get('active') === 'on' };
    try {
      if (id) await api('PUT', `/api/dishes/${id}`, body);
      else await api('POST', '/api/dishes', body);
      closeModal();
      toast('Guardado');
      await router();
    } catch (err) { toast(err.message); }
  };
}

// ============================================================ SOPA
async function renderSoup() {
  const [data] = await Promise.all([api('GET', '/api/soup'), state.settings ? null : loadSettings()]);
  const s = data.status.current;
  const t = data.today;
  const ateToday = data.log.some((l) => l.date === t);

  let statusCard;
  if (!s) {
    statusCard = `<div class="empty-state"><span class="big">🥣</span>Ainda não registaste nenhuma sopa.</div>`;
  } else {
    const dots = s.portions ? Array.from({ length: s.portions }, (_, i) => `<i class="${i < s.eaten ? 'used' : ''}"></i>`).join('') : '';
    const warns = [];
    if (s.finished) warns.push('A panela acabou — hora de fazer sopa!');
    else if (s.old) warns.push(`Feita há ${s.ageDays} dias. Confirma se ainda está boa.`);
    statusCard = `
      <p class="muted small">Panela atual</p>
      <h2 style="font-size:1.3rem;margin-top:2px">${esc(s.name)}</h2>
      <p class="muted">Feita ${daysAgo(s.ageDays)} (${shortDate(s.made_on)}) · ${s.eaten} comida${s.eaten === 1 ? '' : 's'}${s.portions ? ` de ${s.portions}` : ''}</p>
      ${dots ? `<div class="portions" aria-label="${s.eaten} de ${s.portions} doses comidas">${dots}</div>` : ''}
      ${warns.map((w) => `<p style="margin-top:10px;color:var(--warn);font-weight:600">${esc(w)}</p>`).join('')}`;
  }

  view.innerHTML = `
    <div class="page-head"><h1>Sopa</h1></div>
    <section class="card">${statusCard}
      <div class="row-actions">
        <button class="btn ${ateToday ? '' : 'primary'}" data-act="soup-today">${ateToday ? '✓ Já comi sopa hoje (desfazer)' : '🥣 Comi sopa hoje'}</button>
        <button class="btn" data-act="soup-made">🍲 Fiz sopa</button>
      </div>
      <details style="margin-top:10px"><summary class="small muted">Marcar sopa noutro dia</summary>
        <form id="soup-other" style="display:flex;gap:8px;margin-top:8px">
          <input type="date" name="date" max="${t}" value="${addDays(t, -1)}" required>
          <button class="btn">Marcar</button>
        </form>
      </details>
    </section>

    <section class="card" style="margin-top:12px">
      <h2>Panelas</h2>
      ${data.batches.length ? `<ul class="list" style="margin-top:6px">${data.batches.map((b) => `
        <li><div class="grow"><div class="title">${esc(b.name)}</div>
          <div class="muted small">${shortDate(b.made_on)} · ${b.eaten}${b.portions ? `/${b.portions}` : ''} doses comidas</div></div>
          <button class="icon-btn" data-act="soup-batch-del" data-id="${b.id}" aria-label="Apagar panela">🗑️</button></li>`).join('')}</ul>`
        : '<p class="muted" style="margin-top:6px">Nenhuma ainda.</p>'}
    </section>

    <section class="card" style="margin-top:12px">
      <h2>Dias em que comi sopa</h2>
      ${data.log.length ? `<ul class="list" style="margin-top:6px">${data.log.map((l) => `
        <li><div class="grow"><div class="title">${longDate(l.date)}</div><div class="muted small">${esc(l.name || 'sem panela associada')}</div></div>
          <button class="icon-btn" data-act="soup-eaten-del" data-date="${l.date}" aria-label="Remover">✕</button></li>`).join('')}</ul>`
        : '<p class="muted" style="margin-top:6px">Ainda nada.</p>'}
    </section>`;

  $('#soup-other').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('POST', '/api/soup/eaten', { date: new FormData(e.target).get('date') });
      toast('Marcado'); renderSoup();
    } catch (err) { toast(err.message); }
  };
}

const soupActions = {
  'soup-today': async () => {
    const t = localToday();
    const data = await api('GET', '/api/soup');
    if (data.log.some((l) => l.date === data.today)) await api('DELETE', `/api/soup/eaten/${data.today}`);
    else await api('POST', '/api/soup/eaten', { date: data.today || t });
    renderSoup();
  },
  'soup-made': async () => {
    const s = state.settings || await loadSettings();
    const t = localToday();
    openModal(`
      <form id="batch-form" class="stack">
        <div class="modal-head"><h2>Fiz sopa 🍲</h2><button type="button" class="icon-btn" data-a="close" aria-label="Fechar">✕</button></div>
        <label class="field"><span>Que sopa?</span><input type="text" name="name" maxlength="200" placeholder="ex.: Sopa de legumes" autofocus></label>
        <label class="field"><span>Quando</span><input type="date" name="madeOn" value="${t}" max="${t}"></label>
        <label class="field"><span>Doses</span><input type="number" name="portions" min="1" max="30" value="${s.soupPortions}"></label>
        <div class="modal-foot"><button type="button" class="btn" data-a="close">Cancelar</button><button class="btn primary">Guardar</button></div>
      </form>`, (e) => { if (e.target.closest('[data-a=close]')) closeModal(); });
    $('#batch-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api('POST', '/api/soup/batches', { name: fd.get('name'), madeOn: fd.get('madeOn'), portions: fd.get('portions') });
        closeModal(); toast('Sopa registada 🥣'); renderSoup();
      } catch (err) { toast(err.message); }
    };
  },
  'soup-batch-del': async ({ id }) => {
    if (!(await confirmBox('Apagar panela?', 'Os dias em que comeste sopa ficam registados, mas sem panela associada.', 'Apagar', true))) return;
    await api('DELETE', `/api/soup/batches/${id}`);
    renderSoup();
  },
  'soup-eaten-del': async ({ date }) => {
    await api('DELETE', `/api/soup/eaten/${date}`);
    renderSoup();
  },
};

// ============================================================ HISTÓRICO
async function renderHistory() {
  const s = await api('GET', '/api/stats');
  const t = s.totals;
  const tile = (v, label) => `<div class="tile"><b>${v}</b><span>${label}</span></div>`;
  const weekRow = (w) => {
    const total = w.eaten + w.skipped + w.pending;
    const pct = (n) => (total ? (n / total) * 100 : 0);
    return `<li><div class="grow">
        <div style="display:flex;justify-content:space-between;gap:8px"><span class="title">${rangeLabel(w.start)}</span>
          <span class="muted small">${w.eaten}/${total} comidos</span></div>
        <div class="bar"><div class="e" style="width:${pct(w.eaten)}%"></div><div class="s" style="width:${pct(w.skipped)}%"></div><div class="p" style="width:${pct(w.pending)}%"></div></div>
        ${w.days.filter((d) => d.status === 'skipped' && d.note).map((d) => `<div class="muted small" style="margin-top:4px">${DOW_SHORT[isoWd(d.date) - 1]}: em vez de ${esc(d.dish)} → ${esc(d.note)}</div>`).join('')}
      </div></li>`;
  };
  view.innerHTML = `
    <div class="page-head"><h1>Histórico</h1></div>
    <div class="tiles">
      ${tile(s.adherence == null ? '—' : s.adherence + '%', 'cumpri o plano')}
      ${tile(t.eaten, 'refeições comidas')}
      ${tile(t.skipped, 'não comidas')}
      ${tile(t.pending, 'por confirmar')}
    </div>
    <section class="card" style="margin-top:12px">
      <h2>Por semana</h2>
      <p class="muted small" style="margin-top:2px"><span style="color:var(--ok)">■</span> comi · <span style="color:var(--no)">■</span> não comi · <span style="color:var(--warn)">■</span> por confirmar</p>
      ${s.weeks.length ? `<ul class="list" style="margin-top:6px">${s.weeks.map(weekRow).join('')}</ul>` : '<p class="muted" style="margin-top:8px">Ainda não há semanas passadas.</p>'}
    </section>
    ${s.topDishes.length ? `<section class="card" style="margin-top:12px"><h2>Pratos mais comidos</h2>
      <ul class="list" style="margin-top:6px">${s.topDishes.map((d) => `<li><div class="grow title">${esc(d.name)}</div><span class="muted">${d.count}×</span></li>`).join('')}</ul></section>` : ''}
    <section class="card" style="margin-top:12px"><h2>Sopa</h2>
      <div class="tiles" style="margin-top:8px">
        ${tile(s.soup.batches, 'panelas feitas')}
        ${tile(s.soup.eatenLast30, 'sopas nos últimos 30 dias')}
        ${tile(s.soup.avgDaysBetweenBatches ?? '—', 'dias entre panelas (média)')}
      </div>
    </section>`;
}

// ============================================================ DEFINIÇÕES
async function renderSettings() {
  const s = await loadSettings();
  const pattern = { ...s.pattern };
  const draw = () => {
    const maxSlot = Math.max(3, ...Object.values(pattern).map(Number)) + 1;
    const n = Math.min(5, maxSlot);
    const rows = DOW.map((name, i) => {
      const wd = i + 1;
      const v = Number(pattern[wd] || 0);
      const btns = [0, ...Array.from({ length: n }, (_, k) => k + 1)]
        .map((x) => `<button type="button" class="${v === x ? 'on' : ''}" data-v="${x}" data-wd="${wd}" aria-pressed="${v === x}">${x || '—'}</button>`).join('');
      return `<div class="pattern-row"><span>${name}</span><div class="seg">${btns}</div></div>`;
    }).join('');
    $('#pattern').innerHTML = rows;
    const used = new Set(Object.values(pattern).map(Number));
    const nDishes = used.size;
    const order = DOW_SHORT.map((d, i) => (pattern[i + 1] ? `${d} ${pattern[i + 1]}` : null)).filter(Boolean).join(' · ');
    $('#pattern-summary').textContent = nDishes ? `${nDishes} prato${nDishes > 1 ? 's' : ''} por semana — ${order}` : 'Nenhum dia planeado.';
  };

  view.innerHTML = `
    <div class="page-head"><h1>Definições</h1></div>
    <form id="settings-form" class="stack">
      <section class="card stack">
        <div><h2>Dias e pratos</h2>
        <p class="muted small" style="margin-top:4px">Escolhe que prato (1, 2, 3…) comes em cada dia. Cozinhas cada prato uma vez e repetes. “—” = dia não planeado.</p></div>
        <div class="pattern" id="pattern"></div>
        <p class="small" id="pattern-summary"></p>
        <label class="field"><span>Evitar repetir pratos das últimas</span>
          <select name="avoidWeeks">${[0, 1, 2, 3, 4].map((n) => `<option value="${n}" ${s.avoidWeeks === n ? 'selected' : ''}>${n === 0 ? 'não evitar' : `${n} semana${n > 1 ? 's' : ''}`}</option>`).join('')}</select>
          <small>No sorteio, prefere pratos que não comeste recentemente.</small></label>
      </section>

      <section class="card stack">
        <h2>Sopa</h2>
        <label class="check"><input type="checkbox" name="soupEnabled" ${s.soupEnabled ? 'checked' : ''}> Registar sopa</label>
        <label class="field"><span>Doses por panela (por defeito)</span><input type="number" name="soupPortions" min="1" max="30" value="${s.soupPortions}"></label>
        <label class="field"><span>Avisar quando a sopa tem mais de (dias)</span><input type="number" name="soupMaxDays" min="1" max="30" value="${s.soupMaxDays}"></label>
      </section>

      <button class="btn primary block">Guardar definições</button>
    </form>

    <section class="card stack" style="margin-top:12px">
      <h2>Cópia de segurança</h2>
      <p class="muted small">Os dados ficam no teu servidor. Podes exportar tudo para um ficheiro e importar mais tarde.</p>
      <div class="row-actions">
        <a class="btn" href="/api/export" download="marmitas-backup.json">⬇️ Exportar</a>
        <label class="btn" style="flex:1">⬆️ Importar<input type="file" id="import-file" accept="application/json,.json" hidden></label>
      </div>
    </section>
    <p class="muted small" style="text-align:center;margin-top:16px">Marmitas</p>`;

  draw();
  $('#pattern').onclick = (e) => {
    const b = e.target.closest('button[data-wd]');
    if (!b) return;
    const wd = Number(b.dataset.wd), v = Number(b.dataset.v);
    if (v) pattern[wd] = v; else delete pattern[wd];
    draw();
  };
  $('#settings-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      state.settings = await api('PUT', '/api/settings', {
        pattern,
        avoidWeeks: Number(fd.get('avoidWeeks')),
        soupEnabled: fd.get('soupEnabled') === 'on',
        soupPortions: Number(fd.get('soupPortions')),
        soupMaxDays: Number(fd.get('soupMaxDays')),
      });
      $('#tab-sopa').hidden = !state.settings.soupEnabled;
      toast('Definições guardadas');
    } catch (err) { toast(err.message); }
  };
  $('#import-file').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!(await confirmBox('Importar cópia?', 'Isto substitui TODOS os dados atuais pelos do ficheiro.', 'Importar', true))) { e.target.value = ''; return; }
    try {
      await api('POST', '/api/import', JSON.parse(await file.text()));
      toast('Dados importados');
      state.dishes = [];
      await renderSettings();
    } catch (err) { toast(err.message || 'Ficheiro inválido'); }
  };
}

// ------------------------------------------------------------ arranque
loadSettings().catch(() => {}).finally(router);
