import { Router } from 'express';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { hashPassword, verifyPassword, createSession, requireAuth } from '../auth.js';
import { ah } from '../asyncHandler.js';

export const authRouter = Router();

async function publicUser(u) {
  const manager = u.manager_id ? await db.prepare('SELECT name FROM users WHERE id = ?').get(u.manager_id) : null;
  // agentKey/managerName let the native app start background tracking right
  // from a login response — same identity the /api/enroll invite-link flow
  // would have produced, no separate enrollment step needed for an employee
  // who already has a dashboard account.
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    managerId: u.manager_id,
    managerName: manager?.name ?? null,
    agentKey: u.agent_key,
  };
}

function normalizeEmail(raw) {
  return (raw ?? '').trim().toLowerCase();
}

// Tells the login screen whether to show "create account" (fresh install) or
// "set a password" (an existing manager row from before real auth existed)
// or a normal login form.
authRouter.get('/bootstrap', ah(async (req, res) => {
  const unclaimed = await db.prepare("SELECT id, name FROM users WHERE role = 'manager' AND password_hash IS NULL LIMIT 1").get();
  if (unclaimed) return res.json({ state: 'claim-manager', managerName: unclaimed.name });
  const hasManager = await db.prepare("SELECT 1 FROM users WHERE role = 'manager' AND password_hash IS NOT NULL LIMIT 1").get();
  res.json({ state: hasManager ? 'login' : 'register' });
}));

// Fresh install: no manager account exists at all yet.
authRouter.post('/register', ah(async (req, res) => {
  const { name, password } = req.body;
  const email = normalizeEmail(req.body.email);
  if (!name?.trim() || !email || !password || password.length < 8) {
    return res.status(400).json({ error: 'name, email, and a password of at least 8 characters are required' });
  }
  const existing = await db.prepare("SELECT 1 FROM users WHERE role = 'manager'").get();
  if (existing) return res.status(409).json({ error: 'a manager account already exists' });
  const emailTaken = await db.prepare('SELECT 1 FROM users WHERE email = ?').get(email);
  if (emailTaken) return res.status(409).json({ error: 'that email is already registered' });

  const agentKey = crypto.randomBytes(16).toString('hex');
  const info = await db.prepare(`
    INSERT INTO users (name, email, agent_key, role, manager_id, password_hash) VALUES (?, ?, ?, 'manager', NULL, ?) RETURNING id
  `).run(name.trim(), email, agentKey, hashPassword(password));
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.json({ token: await createSession(user.id), user: await publicUser(user) });
}));

// Upgrade path: a manager row created before real auth existed (password_hash
// IS NULL) sets its password for the first time instead of creating a duplicate.
authRouter.post('/claim-manager', ah(async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'a password of at least 8 characters is required' });
  }
  const unclaimed = await db.prepare("SELECT * FROM users WHERE role = 'manager' AND password_hash IS NULL LIMIT 1").get();
  if (!unclaimed) return res.status(409).json({ error: 'no unclaimed manager account' });

  await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), unclaimed.id);
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(unclaimed.id);
  res.json({ token: await createSession(user.id), user: await publicUser(user) });
}));

// Open self-service signup for manager/superadmin accounts — no invite link
// or existing-manager approval required, by explicit request. Anyone who can
// reach this server can create themselves privileged access this way.
authRouter.post('/register-admin', ah(async (req, res) => {
  const { name, password, role } = req.body;
  const email = normalizeEmail(req.body.email);
  if (!name?.trim() || !email || !password || password.length < 8) {
    return res.status(400).json({ error: 'name, email, and a password of at least 8 characters are required' });
  }
  if (!['manager', 'superadmin'].includes(role)) {
    return res.status(400).json({ error: "role must be 'manager' or 'superadmin'" });
  }
  // Only ever one super admin, by explicit request — everyone else must be a
  // manager. Unlike manager self-registration, this isn't reopenable via the
  // UI; someone has to remove the existing super admin first.
  if (role === 'superadmin') {
    const hasSuperAdmin = await db.prepare("SELECT 1 FROM users WHERE role = 'superadmin'").get();
    if (hasSuperAdmin) return res.status(409).json({ error: 'a super admin account already exists' });
  }
  const existing = await db.prepare('SELECT 1 FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'that email is already registered' });

  const agentKey = crypto.randomBytes(16).toString('hex');
  const info = await db.prepare(`
    INSERT INTO users (name, email, agent_key, role, manager_id, password_hash) VALUES (?, ?, ?, ?, NULL, ?) RETURNING id
  `).run(name.trim(), email, agentKey, role, hashPassword(password));
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.json({ token: await createSession(user.id), user: await publicUser(user) });
}));

authRouter.post('/login', ah(async (req, res) => {
  const { password } = req.body;
  const email = normalizeEmail(req.body.email);
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'invalid email or password' });
  }
  res.json({ token: await createSession(user.id), user: await publicUser(user) });
}));

authRouter.post('/logout', requireAuth, ah(async (req, res) => {
  await db.prepare('DELETE FROM sessions WHERE token = ?').run(req.header('authorization')?.slice(7) ?? '');
  res.json({ ok: true });
}));

authRouter.get('/me', requireAuth, ah(async (req, res) => {
  res.json(await publicUser(req.authUser));
}));

// An employee visits /claim/:token (handed to them by their manager) to set a
// dashboard password for the first time — separate from the invite link, which
// only connects the background tracking agent, not dashboard access.
authRouter.get('/claim/:token', ah(async (req, res) => {
  const user = await db.prepare('SELECT id, name FROM users WHERE claim_token = ?').get(req.params.token);
  if (!user) return res.status(404).json({ error: 'invalid or already-used link' });
  res.json({ name: user.name });
}));

authRouter.post('/claim/:token', ah(async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'a password of at least 8 characters is required' });
  }
  const user = await db.prepare('SELECT * FROM users WHERE claim_token = ?').get(req.params.token);
  if (!user) return res.status(404).json({ error: 'invalid or already-used link' });

  await db.prepare('UPDATE users SET password_hash = ?, claim_token = NULL WHERE id = ?').run(hashPassword(password), user.id);
  const updated = await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  res.json({ token: await createSession(updated.id), user: await publicUser(updated) });
}));
