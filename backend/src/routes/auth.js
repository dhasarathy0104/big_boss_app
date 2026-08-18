import { Router } from 'express';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { hashPassword, verifyPassword, createSession, requireAuth } from '../auth.js';

export const authRouter = Router();

function publicUser(u) {
  return { id: u.id, name: u.name, role: u.role, managerId: u.manager_id };
}

// Tells the login screen whether to show "create account" (fresh install) or
// "set a password" (an existing manager row from before real auth existed)
// or a normal login form.
authRouter.get('/bootstrap', (req, res) => {
  const unclaimed = db.prepare("SELECT id, name FROM users WHERE role = 'manager' AND password_hash IS NULL LIMIT 1").get();
  if (unclaimed) return res.json({ state: 'claim-manager', managerName: unclaimed.name });
  const hasManager = db.prepare("SELECT 1 FROM users WHERE role = 'manager' AND password_hash IS NOT NULL LIMIT 1").get();
  res.json({ state: hasManager ? 'login' : 'register' });
});

// Fresh install: no manager account exists at all yet.
authRouter.post('/register', (req, res) => {
  const { name, password } = req.body;
  if (!name?.trim() || !password || password.length < 8) {
    return res.status(400).json({ error: 'name and a password of at least 8 characters are required' });
  }
  const existing = db.prepare("SELECT 1 FROM users WHERE role = 'manager'").get();
  if (existing) return res.status(409).json({ error: 'a manager account already exists' });

  const agentKey = crypto.randomBytes(16).toString('hex');
  const info = db.prepare(`
    INSERT INTO users (name, agent_key, role, manager_id, password_hash) VALUES (?, ?, 'manager', NULL, ?)
  `).run(name.trim(), agentKey, hashPassword(password));
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.json({ token: createSession(user.id), user: publicUser(user) });
});

// Upgrade path: a manager row created before real auth existed (password_hash
// IS NULL) sets its password for the first time instead of creating a duplicate.
authRouter.post('/claim-manager', (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'a password of at least 8 characters is required' });
  }
  const unclaimed = db.prepare("SELECT * FROM users WHERE role = 'manager' AND password_hash IS NULL LIMIT 1").get();
  if (!unclaimed) return res.status(409).json({ error: 'no unclaimed manager account' });

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), unclaimed.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(unclaimed.id);
  res.json({ token: createSession(user.id), user: publicUser(user) });
});

authRouter.post('/login', (req, res) => {
  const { name, password } = req.body;
  if (!name?.trim() || !password) return res.status(400).json({ error: 'name and password required' });

  const user = db.prepare('SELECT * FROM users WHERE name = ? COLLATE NOCASE').get(name.trim());
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'invalid name or password' });
  }
  res.json({ token: createSession(user.id), user: publicUser(user) });
});

authRouter.post('/logout', requireAuth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.header('authorization')?.slice(7) ?? '');
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json(publicUser(req.authUser));
});

// An employee visits /claim/:token (handed to them by their manager) to set a
// dashboard password for the first time — separate from the invite link, which
// only connects the background tracking agent, not dashboard access.
authRouter.get('/claim/:token', (req, res) => {
  const user = db.prepare('SELECT id, name FROM users WHERE claim_token = ?').get(req.params.token);
  if (!user) return res.status(404).json({ error: 'invalid or already-used link' });
  res.json({ name: user.name });
});

authRouter.post('/claim/:token', (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'a password of at least 8 characters is required' });
  }
  const user = db.prepare('SELECT * FROM users WHERE claim_token = ?').get(req.params.token);
  if (!user) return res.status(404).json({ error: 'invalid or already-used link' });

  db.prepare('UPDATE users SET password_hash = ?, claim_token = NULL WHERE id = ?').run(hashPassword(password), user.id);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  res.json({ token: createSession(updated.id), user: publicUser(updated) });
});
