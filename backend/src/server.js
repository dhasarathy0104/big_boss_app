import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { managersRouter } from './routes/managers.js';
import { invitesPublicRouter } from './routes/invites.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const screenshotsDir = path.join(__dirname, '..', 'data', 'screenshots');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

function authUser(req, res, next) {
  const key = req.header('x-agent-key');
  if (!key) return res.status(401).json({ error: 'missing x-agent-key header' });
  const user = db.prepare('SELECT * FROM users WHERE agent_key = ?').get(key);
  if (!user) return res.status(401).json({ error: 'unknown agent key' });
  req.user = user;
  next();
}

// Agent enrolls itself the first time it runs. If it carries an invite token,
// it's automatically attached to whichever manager issued that link.
app.post('/api/enroll', (req, res) => {
  const { name, inviteToken } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });

  let managerId = null;
  if (inviteToken) {
    const invite = db.prepare('SELECT * FROM invite_links WHERE token = ? AND revoked = 0').get(inviteToken);
    if (!invite) return res.status(400).json({ error: 'invalid or revoked invite token' });
    managerId = invite.manager_id;
    db.prepare('UPDATE invite_links SET use_count = use_count + 1 WHERE id = ?').run(invite.id);
  }

  const agentKey = crypto.randomBytes(16).toString('hex');
  const info = db.prepare(`
    INSERT INTO users (name, agent_key, role, manager_id) VALUES (?, ?, 'employee', ?)
  `).run(name.trim(), agentKey, managerId);

  const manager = managerId ? db.prepare('SELECT name FROM users WHERE id = ?').get(managerId) : null;
  res.json({
    userId: info.lastInsertRowid,
    agentKey,
    managerId,
    managerName: manager?.name ?? null,
  });
});

// Batched activity events from the agent.
app.post('/api/ingest/activity', authUser, (req, res) => {
  const { events } = req.body;
  if (!Array.isArray(events)) return res.status(400).json({ error: 'events array required' });

  const insert = db.prepare(`
    INSERT OR IGNORE INTO activity_events
      (user_id, client_event_id, app_name, window_title, started_at, ended_at, input_count, is_idle)
    VALUES (@user_id, @client_event_id, @app_name, @window_title, @started_at, @ended_at, @input_count, @is_idle)
  `);
  db.exec('BEGIN');
  try {
    for (const e of events) {
      insert.run({
        user_id: req.user.id,
        client_event_id: e.clientEventId,
        app_name: e.appName ?? null,
        window_title: e.windowTitle ?? null,
        started_at: e.startedAt,
        ended_at: e.endedAt,
        input_count: e.inputCount ?? 0,
        is_idle: e.isIdle ? 1 : 0,
      });
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  res.json({ accepted: events.length });
});

// Screenshot upload (base64 PNG/JPEG in JSON body — fine at prototype volume).
app.post('/api/ingest/screenshot', authUser, (req, res) => {
  const { capturedAt, appName, windowTitle, imageBase64, ext } = req.body;
  if (!imageBase64) return res.status(400).json({ error: 'imageBase64 required' });

  const fileExt = ext === 'png' ? 'png' : 'jpg';
  const fileName = `${req.user.id}_${Date.now()}.${fileExt}`;
  const filePath = path.join(screenshotsDir, fileName);
  fs.writeFileSync(filePath, Buffer.from(imageBase64, 'base64'));

  db.prepare(`
    INSERT INTO screenshots (user_id, captured_at, file_path, app_name, window_title)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.user.id, capturedAt ?? new Date().toISOString(), fileName, appName ?? null, windowTitle ?? null);

  res.json({ ok: true });
});

// --- Dashboard read endpoints ---

app.get('/api/users/:id/timeline', (req, res) => {
  const { date } = req.query; // YYYY-MM-DD
  const day = date || new Date().toISOString().slice(0, 10);
  const events = db.prepare(`
    SELECT * FROM activity_events
    WHERE user_id = ? AND started_at >= ? AND started_at < ?
    ORDER BY started_at
  `).all(req.params.id, `${day}T00:00:00.000Z`, `${day}T23:59:59.999Z`);
  res.json(events);
});

app.get('/api/users/:id/screenshots', (req, res) => {
  const { date } = req.query;
  const day = date || new Date().toISOString().slice(0, 10);
  const shots = db.prepare(`
    SELECT * FROM screenshots
    WHERE user_id = ? AND captured_at >= ? AND captured_at < ?
    ORDER BY captured_at DESC
  `).all(req.params.id, `${day}T00:00:00.000Z`, `${day}T23:59:59.999Z`);
  res.json(shots);
});

app.use('/screenshots', express.static(screenshotsDir));
app.use('/api/managers', managersRouter);
app.use('/api/invites', invitesPublicRouter);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`desklog backend listening on http://localhost:${PORT}`));
