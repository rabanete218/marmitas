import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'marmitas.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS dishes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    ingredients TEXT NOT NULL DEFAULT '',
    recipe      TEXT NOT NULL DEFAULT '',
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- One row per planned week (keyed by the Monday). slots = {"1": dishId, "2": dishId, ...}
  CREATE TABLE IF NOT EXISTS weeks (
    start TEXT PRIMARY KEY,
    slots TEXT NOT NULL DEFAULT '{}'
  );

  -- One row per planned day.
  CREATE TABLE IF NOT EXISTS plan_days (
    date    TEXT PRIMARY KEY,
    slot    INTEGER,
    dish_id INTEGER REFERENCES dishes(id) ON DELETE SET NULL,
    status  TEXT NOT NULL DEFAULT 'planned', -- planned | eaten | skipped
    note    TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS soup_batches (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT NOT NULL DEFAULT 'Sopa',
    made_on  TEXT NOT NULL,
    portions INTEGER,
    notes    TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS soup_eaten (
    date     TEXT PRIMARY KEY,
    batch_id INTEGER REFERENCES soup_batches(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

export const DEFAULT_SETTINGS = {
  // ISO weekday (1 = segunda ... 7 = domingo) -> prato (1..N). Dias ausentes não são planeados.
  pattern: { 1: 1, 2: 2, 3: 3, 4: 1, 5: 3 },
  avoidWeeks: 1,          // evitar repetir pratos das últimas N semanas no aleatório
  soupEnabled: true,
  soupPortions: 5,        // doses por panela (por defeito)
  soupMaxDays: 5,         // avisar quando a sopa tem mais de N dias
};

export function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = structuredClone(DEFAULT_SETTINGS);
  for (const r of rows) {
    try { s[r.key] = JSON.parse(r.value); } catch { /* ignore bad row */ }
  }
  return s;
}

export function saveSettings(patch) {
  const allowed = Object.keys(DEFAULT_SETTINGS);
  const up = db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [k, v] of Object.entries(patch)) {
    if (allowed.includes(k)) up.run(k, JSON.stringify(v));
  }
  return getSettings();
}

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
