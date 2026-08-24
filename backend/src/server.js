import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db, withTransaction } from './db.js';
import { ah } from './asyncHandler.js';
import { managersRouter } from './routes/managers.js';
import { invitesPublicRouter } from './routes/invites.js';
import { employeesRouter } from './routes/employees.js';
import { projectsRouter } from './routes/projects.js';
import { tasksRouter } from './routes/tasks.js';
import { timeEntriesRouter } from './routes/timeEntries.js';
import { categoryRulesRouter } from './routes/categoryRules.js';
import { liveStatusRouter } from './routes/liveStatus.js';
import { attendanceRouter } from './routes/attendance.js';
import { leaveRequestsRouter } from './routes/leaveRequests.js';
import { billingRouter } from './routes/billing.js';
import { authRouter } from './routes/auth.js';
import { superadminRouter } from './routes/superadmin.js';
import { requireAuth, isSelfOrOwnEmployee } from './auth.js';
import { buildOverrideMaps, computeProductivity } from './productivity.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

async function authUser(req, res, next) {
  try {
    const key = req.header('x-agent-key');
    if (!key) return res.status(401).json({ error: 'missing x-agent-key header' });
    const user = await db.prepare('SELECT * FROM users WHERE agent_key = ?').get(key);
    if (!user) return res.status(401).json({ error: 'unknown agent key' });
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

// Agent enrolls itself the first time it runs. If it carries an invite token,
// it's automatically attached to whichever manager issued that link.
app.post('/api/enroll', ah(async (req, res) => {
  const { name, inviteToken } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });

  let managerId = null;
  if (inviteToken) {
    const invite = await db.prepare('SELECT * FROM invite_links WHERE token = ? AND revoked = 0').get(inviteToken);
    if (!invite) return res.status(400).json({ error: 'invalid or revoked invite token' });
    managerId = invite.manager_id;
    await db.prepare('UPDATE invite_links SET use_count = use_count + 1 WHERE id = ?').run(invite.id);
  }

  const agentKey = crypto.randomBytes(16).toString('hex');
  const trimmedName = name.trim();

  // Re-enrolling under the same manager with the same name (e.g. after
  // wiping a local config to fix a connection issue) resumes the existing
  // employee record instead of forking a duplicate with empty history.
  const existing = managerId
    ? await db.prepare("SELECT * FROM users WHERE role = 'employee' AND manager_id = ? AND LOWER(name) = LOWER(?)")
        .get(managerId, trimmedName)
    : null;

  let userId;
  if (existing) {
    await db.prepare('UPDATE users SET agent_key = ? WHERE id = ?').run(agentKey, existing.id);
    userId = existing.id;
  } else {
    const info = await db.prepare(`
      INSERT INTO users (name, agent_key, role, manager_id) VALUES (?, ?, 'employee', ?) RETURNING id
    `).run(trimmedName, agentKey, managerId);
    userId = info.lastInsertRowid;
  }

  const manager = managerId ? await db.prepare('SELECT name FROM users WHERE id = ?').get(managerId) : null;
  res.json({
    userId,
    agentKey,
    managerId,
    managerName: manager?.name ?? null,
  });
}));

// Batched activity events from the agent.
app.post('/api/ingest/activity', authUser, ah(async (req, res) => {
  const { events } = req.body;
  if (!Array.isArray(events)) return res.status(400).json({ error: 'events array required' });

  await withTransaction(async (tx) => {
    const insert = tx.prepare(`
      INSERT INTO activity_events
        (user_id, client_event_id, app_name, window_title, domain, started_at, ended_at, input_count, is_idle)
      VALUES (@user_id, @client_event_id, @app_name, @window_title, @domain, @started_at, @ended_at, @input_count, @is_idle)
      ON CONFLICT (user_id, client_event_id) DO NOTHING
    `);
    for (const e of events) {
      await insert.run({
        user_id: req.user.id,
        client_event_id: e.clientEventId,
        app_name: e.appName ?? null,
        window_title: e.windowTitle ?? null,
        domain: e.domain ?? null,
        started_at: e.startedAt,
        ended_at: e.endedAt,
        input_count: e.inputCount ?? 0,
        is_idle: e.isIdle ? 1 : 0,
      });
    }
  });
  res.json({ accepted: events.length });
}));

// Screenshot upload (base64 PNG/JPEG in JSON body — fine at prototype volume).
app.post('/api/ingest/screenshot', authUser, ah(async (req, res) => {
  const { capturedAt, appName, windowTitle, imageBase64, ext } = req.body;
  if (!imageBase64) return res.status(400).json({ error: 'imageBase64 required' });

  const fileExt = ext === 'png' ? 'png' : 'jpg';
  const fileName = `${req.user.id}_${Date.now()}.${fileExt}`;

  await db.prepare(`
    INSERT INTO screenshots (user_id, captured_at, file_path, app_name, window_title, image_data)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.user.id, capturedAt ?? new Date().toISOString(), fileName, appName ?? null, windowTitle ?? null, imageBase64);

  res.json({ ok: true });
}));

// Agent checks this periodically so a manager's interval change takes effect
// without the employee needing to restart their agent.
app.get('/api/agent-settings', authUser, ah(async (req, res) => {
  const managerId = req.user.manager_id;
  const manager = managerId
    ? await db.prepare('SELECT screenshot_interval_minutes FROM users WHERE id = ?').get(managerId)
    : null;
  res.json({ screenshotIntervalMinutes: manager?.screenshot_interval_minutes ?? 5 });
}));

// --- Dashboard read endpoints ---
// All scoped to: the user viewing their own data, or the manager who owns them.

async function requireSelfOrOwnEmployee(req, res, next) {
  try {
    if (!(await isSelfOrOwnEmployee(req.authUser, Number(req.params.id)))) {
      return res.status(403).json({ error: 'not authorized for this user' });
    }
    next();
  } catch (err) {
    next(err);
  }
}

app.get('/api/users/:id/timeline', requireAuth, requireSelfOrOwnEmployee, ah(async (req, res) => {
  const { date } = req.query; // YYYY-MM-DD
  const day = date || new Date().toISOString().slice(0, 10);
  const events = await db.prepare(`
    SELECT * FROM activity_events
    WHERE user_id = ? AND started_at >= ? AND started_at < ?
    ORDER BY started_at
  `).all(req.params.id, `${day}T00:00:00.000Z`, `${day}T23:59:59.999Z`);
  res.json(events);
}));

app.get('/api/users/:id/productivity', requireAuth, requireSelfOrOwnEmployee, ah(async (req, res) => {
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'user not found' });

  const { date } = req.query;
  const day = date || new Date().toISOString().slice(0, 10);
  const events = await db.prepare(`
    SELECT * FROM activity_events
    WHERE user_id = ? AND started_at >= ? AND started_at < ?
    ORDER BY started_at
  `).all(req.params.id, `${day}T00:00:00.000Z`, `${day}T23:59:59.999Z`);

  const rules = user.manager_id
    ? await db.prepare('SELECT * FROM category_rules WHERE manager_id = ?').all(user.manager_id)
    : [];
  const overrides = buildOverrideMaps(rules);

  res.json(computeProductivity(events, overrides));
}));

app.get('/api/users/:id/screenshots', requireAuth, requireSelfOrOwnEmployee, ah(async (req, res) => {
  const { date } = req.query;
  const day = date || new Date().toISOString().slice(0, 10);
  // image_data excluded here on purpose — this list can be dozens of rows,
  // and each one's base64 image would make the response huge for no reason.
  // The gallery fetches the actual image per-shot via /api/screenshots/:filename.
  const shots = await db.prepare(`
    SELECT id, user_id, captured_at, file_path, app_name, window_title FROM screenshots
    WHERE user_id = ? AND captured_at >= ? AND captured_at < ?
    ORDER BY captured_at DESC
  `).all(req.params.id, `${day}T00:00:00.000Z`, `${day}T23:59:59.999Z`);
  res.json(shots);
}));

// Screenshot images themselves — was a blanket express.static mount with zero
// auth (anyone who guessed/knew a filename could view anyone's screen
// captures). Now resolved through the DB so the same ownership check applies,
// with a ?token= fallback since <img src> can't set an Authorization header.
app.get('/api/screenshots/:filename', requireAuth, ah(async (req, res) => {
  const shot = await db.prepare('SELECT * FROM screenshots WHERE file_path = ?').get(req.params.filename);
  if (!shot) return res.status(404).end();
  if (!(await isSelfOrOwnEmployee(req.authUser, shot.user_id))) return res.status(403).end();
  if (!shot.image_data) return res.status(404).end();
  const contentType = shot.file_path.endsWith('.png') ? 'image/png' : 'image/jpeg';
  res.set('Content-Type', contentType);
  res.send(Buffer.from(shot.image_data, 'base64'));
}));

app.use('/api/auth', authRouter);
app.use('/api/superadmin', superadminRouter);
app.use('/api/managers', managersRouter);
app.use('/api/invites', invitesPublicRouter);
app.use('/api/employees', employeesRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/time-entries', timeEntriesRouter);
app.use('/api/category-rules', categoryRulesRouter);
app.use('/api/managers', liveStatusRouter);
app.use('/api/attendance', attendanceRouter);
app.use('/api/leave-requests', leaveRequestsRouter);
app.use('/api', billingRouter);

// Serve the built dashboard from the same origin as the API — no separate dev
// server needed, and no CORS/proxy juggling for the desktop app wrapper.
const dashboardDist = path.join(__dirname, '..', '..', 'dashboard', 'dist');
if (fs.existsSync(dashboardDist)) {
  app.use(express.static(dashboardDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/screenshots')) return next();
    res.sendFile(path.join(dashboardDist, 'index.html'));
  });
}

// Screenshots older than this are deleted automatically, on a timer rather
// than a real cron job since this only needs to be "eventually tidy," not
// punctual -- and a free Render instance that's spun down from inactivity
// just catches up whenever it next wakes up.
const SCREENSHOT_RETENTION_HOURS = 48;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
async function cleanupOldScreenshots() {
  try {
    const result = await db.prepare(
      `DELETE FROM screenshots WHERE captured_at::timestamptz < now() - interval '${SCREENSHOT_RETENTION_HOURS} hours'`
    ).run();
    if (result.changes) console.log(`Deleted ${result.changes} screenshot(s) older than ${SCREENSHOT_RETENTION_HOURS}h`);
  } catch (err) {
    console.error('Screenshot cleanup failed:', err.message);
  }
}
cleanupOldScreenshots();
setInterval(cleanupOldScreenshots, CLEANUP_INTERVAL_MS);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`desklog backend listening on http://localhost:${PORT}`));
