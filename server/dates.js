// Datas sempre como strings 'YYYY-MM-DD'. Aritmética feita em UTC para evitar problemas de DST.

export function parse(d) {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

export function fmt(dt) {
  return dt.toISOString().slice(0, 10);
}

export function addDays(d, n) {
  const dt = parse(d);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fmt(dt);
}

export function isoWeekday(d) {
  const wd = parse(d).getUTCDay();
  return wd === 0 ? 7 : wd;
}

export function mondayOf(d) {
  return addDays(d, 1 - isoWeekday(d));
}

export function diffDays(a, b) {
  return Math.round((parse(a) - parse(b)) / 86400000);
}

// Data de hoje no fuso local do servidor (definido pela variável TZ).
export function today() {
  const now = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function isDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parse(s).getTime());
}
