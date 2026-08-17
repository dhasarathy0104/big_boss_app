import { Router } from 'express';
import crypto from 'node:crypto';
import { db, randomToken } from '../db.js';

export const managersRouter = Router();

managersRouter.get('/', (req, res) => {
  const managers = db.prepare("SELECT id, name, created_at FROM users WHERE role = 'manager' ORDER BY name").all();
  res.json(managers);
});

managersRouter.post('/', (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  const agentKey = crypto.randomBytes(16).toString('hex');
  const info = db.prepare(`
    INSERT INTO users (name, agent_key, role, manager_id) VALUES (?, ?, 'manager', NULL)
  `).run(name.trim(), agentKey);
  res.json(db.prepare('SELECT id, name, created_at FROM users WHERE id = ?').get(info.lastInsertRowid));
});

managersRouter.get('/:id/team', (req, res) => {
  const manager = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'manager'").get(req.params.id);
  if (!manager) return res.status(404).json({ error: 'manager not found' });
  const team = db.prepare(`
    SELECT id, name, created_at FROM users WHERE manager_id = ? AND role = 'employee' ORDER BY name
  `).all(req.params.id);
  res.json(team);
});

managersRouter.get('/:id/invites', (req, res) => {
  const invites = db.prepare(`
    SELECT * FROM invite_links WHERE manager_id = ? AND revoked = 0 ORDER BY created_at DESC
  `).all(req.params.id);
  res.json(invites);
});

managersRouter.post('/:id/invites', (req, res) => {
  const manager = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'manager'").get(req.params.id);
  if (!manager) return res.status(404).json({ error: 'manager not found' });
  const token = randomToken(12);
  db.prepare('INSERT INTO invite_links (token, manager_id) VALUES (?, ?)').run(token, req.params.id);
  res.json(db.prepare('SELECT * FROM invite_links WHERE token = ?').get(token));
});

managersRouter.post('/invites/:inviteId/revoke', (req, res) => {
  db.prepare('UPDATE invite_links SET revoked = 1 WHERE id = ?').run(req.params.inviteId);
  res.json({ ok: true });
});
