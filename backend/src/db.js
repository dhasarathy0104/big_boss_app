import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(path.join(dataDir, 'screenshots'), { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, 'dev.db'));
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  agent_key TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'employee',
  manager_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invite_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT UNIQUE NOT NULL,
  manager_id INTEGER NOT NULL REFERENCES users(id),
  revoked INTEGER NOT NULL DEFAULT 0,
  use_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_invite_links_manager ON invite_links(manager_id);

CREATE TABLE IF NOT EXISTS activity_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  client_event_id TEXT NOT NULL,
  app_name TEXT,
  window_title TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  input_count INTEGER NOT NULL DEFAULT 0,
  is_idle INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, client_event_id)
);
CREATE INDEX IF NOT EXISTS idx_activity_user_time ON activity_events(user_id, started_at);

CREATE TABLE IF NOT EXISTS screenshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  captured_at TEXT NOT NULL,
  file_path TEXT NOT NULL,
  app_name TEXT,
  window_title TEXT
);
CREATE INDEX IF NOT EXISTS idx_screenshots_user_time ON screenshots(user_id, captured_at);
`);

export function randomToken(bytes = 12) {
  return crypto.randomBytes(bytes).toString('hex');
}
