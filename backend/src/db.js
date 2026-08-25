import pg from 'pg';
import crypto from 'node:crypto';

const { Pool } = pg;

export const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT) || 5432,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
});

// Every call site was written against node:sqlite's synchronous db.prepare(sql).get/all/run()
// API, using either `?` positional placeholders or `@name` placeholders matched against a
// single params object. This turns each of those into pg's `$1, $2, ...` style so the rest of
// the codebase doesn't have to change its SQL, only add `await`.
function toPgQuery(sql, args) {
  if (args.length === 1 && args[0] !== null && typeof args[0] === 'object' && !Array.isArray(args[0])) {
    const obj = args[0];
    const values = [];
    const text = sql.replace(/@(\w+)/g, (_, key) => {
      values.push(obj[key]);
      return `$${values.length}`;
    });
    return { text, values };
  }
  let i = 0;
  const text = sql.replace(/\?/g, () => `$${++i}`);
  return { text, values: args };
}

function statements(queryFn) {
  return {
    prepare(sql) {
      return {
        async get(...args) {
          const { text, values } = toPgQuery(sql, args);
          const res = await queryFn(text, values);
          return res.rows[0];
        },
        async all(...args) {
          const { text, values } = toPgQuery(sql, args);
          const res = await queryFn(text, values);
          return res.rows;
        },
        // Matches node:sqlite's RunResult shape (lastInsertRowid/changes) so
        // call sites don't change. lastInsertRowid only comes through on
        // INSERTs whose SQL explicitly ends in `RETURNING id`.
        async run(...args) {
          const { text, values } = toPgQuery(sql, args);
          const res = await queryFn(text, values);
          return { lastInsertRowid: res.rows[0]?.id, changes: res.rowCount };
        },
      };
    },
  };
}

export const db = statements((text, values) => pool.query(text, values));

// Runs several statements as one all-or-nothing transaction on a single
// checked-out connection (a plain Pool round-robins connections per query,
// so BEGIN/COMMIT on the pool directly would not reliably land on the same
// connection as the statements in between).
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(statements((text, values) => client.query(text, values)));
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

await pool.query(`
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  agent_key TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'employee',
  manager_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS invite_links (
  id SERIAL PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  manager_id INTEGER NOT NULL REFERENCES users(id),
  revoked INTEGER NOT NULL DEFAULT 0,
  use_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS idx_invite_links_manager ON invite_links(manager_id);

CREATE TABLE IF NOT EXISTS activity_events (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  client_event_id TEXT NOT NULL,
  app_name TEXT,
  window_title TEXT,
  domain TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  input_count INTEGER NOT NULL DEFAULT 0,
  is_idle INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, client_event_id)
);
CREATE INDEX IF NOT EXISTS idx_activity_user_time ON activity_events(user_id, started_at);

CREATE TABLE IF NOT EXISTS screenshots (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  captured_at TEXT NOT NULL,
  file_path TEXT NOT NULL,
  app_name TEXT,
  window_title TEXT
);
CREATE INDEX IF NOT EXISTS idx_screenshots_user_time ON screenshots(user_id, captured_at);

CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  manager_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  client_name TEXT,
  is_billable INTEGER NOT NULL DEFAULT 0,
  hourly_rate DOUBLE PRECISION,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS idx_projects_manager ON projects(manager_id);

CREATE TABLE IF NOT EXISTS project_members (
  project_id INTEGER NOT NULL REFERENCES projects(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo',
  assignee_user_id INTEGER REFERENCES users(id),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);

CREATE TABLE IF NOT EXISTS time_entries (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  task_id INTEGER REFERENCES tasks(id),
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  reviewed_at TEXT,
  reviewed_by INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_time_entries_user ON time_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_project ON time_entries(project_id);

-- Per-manager overrides on top of the built-in default classification (see productivity.js).
CREATE TABLE IF NOT EXISTS category_rules (
  id SERIAL PRIMARY KEY,
  manager_id INTEGER NOT NULL REFERENCES users(id),
  app_pattern TEXT NOT NULL,
  category TEXT NOT NULL,
  is_engaged_app INTEGER NOT NULL DEFAULT 0,
  rule_type TEXT NOT NULL DEFAULT 'app',
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  UNIQUE(manager_id, app_pattern)
);

CREATE TABLE IF NOT EXISTS attendance_records (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  clock_in TEXT NOT NULL,
  clock_out TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS idx_attendance_user ON attendance_records(user_id, clock_in);

CREATE TABLE IF NOT EXISTS leave_requests (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  leave_type TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  reviewed_at TEXT,
  reviewed_by INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_leave_user ON leave_requests(user_id);

-- Real login sessions (see auth.js) — replaces the old "pick any name from a
-- dropdown" prototype identity switcher.
CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);
`);

async function ensureColumn(table, column, ddl) {
  const res = await pool.query(
    'SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2',
    [table, column]
  );
  if (res.rowCount === 0) {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}
await ensureColumn('activity_events', 'domain', 'domain TEXT');
await ensureColumn('category_rules', 'rule_type', "rule_type TEXT NOT NULL DEFAULT 'app'");
await ensureColumn('users', 'screenshot_interval_minutes', 'screenshot_interval_minutes INTEGER NOT NULL DEFAULT 5');
await ensureColumn('users', 'password_hash', 'password_hash TEXT');
await ensureColumn('users', 'claim_token', 'claim_token TEXT');
// Login identifier for every role now (replaces name-based login). Stored
// always-lowercased by the application, so a plain unique index is enough —
// no need for a case-insensitive index type.
await ensureColumn('users', 'email', 'email TEXT');
await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL');
// Screenshots are stored in the row itself (base64), not on local disk —
// Render's free web services wipe local files on every restart/spin-down,
// so a filesystem path would silently lose images.
await ensureColumn('screenshots', 'image_data', 'image_data TEXT');

export function randomToken(bytes = 12) {
  return crypto.randomBytes(bytes).toString('hex');
}
