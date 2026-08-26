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
    mobile: u.mobile,
    department: u.department,
    jobRole: u.job_role,
    managerId: u.manager_id,
    managerName: manager?.name ?? null,
    agentKey: u.agent_key,
    passwordResetRequested: !!u.password_reset_requested_at,
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
  if (!['manager', 'superadmin'].includes(role)) {
    return res.status(400).json({ error: "role must be 'manager' or 'superadmin'" });
  }
  // A super admin logs in with just a username (no email, by explicit
  // request) — everyone else (managers) needs a real email.
  const email = role === 'superadmin' ? null : normalizeEmail(req.body.email);
  if (!name?.trim() || (role === 'manager' && !email) || !password || password.length < 8) {
    return res.status(400).json({ error: `name${role === 'manager' ? ', email,' : ','} and a password of at least 8 characters are required` });
  }
  // Only ever one super admin, by explicit request — everyone else must be a
  // manager. Unlike manager self-registration, this isn't reopenable via the
  // UI; someone has to remove the existing super admin first.
  if (role === 'superadmin') {
    // Already the only account of this role once created, so there's
    // nothing else to check for a name collision against.
    const hasSuperAdmin = await db.prepare("SELECT 1 FROM users WHERE role = 'superadmin'").get();
    if (hasSuperAdmin) return res.status(409).json({ error: 'a super admin account already exists' });
  } else {
    const existing = await db.prepare('SELECT 1 FROM users WHERE email = ?').get(email);
    if (existing) return res.status(409).json({ error: 'that email is already registered' });
  }

  // Profile fields only make sense for a manager (a real employee/contact
  // record) — the super admin has none of this, by the same "no email"
  // reasoning as above.
  const mobile = role === 'manager' ? (req.body.mobile ?? '').trim() || null : null;
  const department = role === 'manager' ? (req.body.department ?? '').trim() || null : null;
  const jobRole = role === 'manager' ? (req.body.jobRole ?? '').trim() || null : null;

  const agentKey = crypto.randomBytes(16).toString('hex');
  const info = await db.prepare(`
    INSERT INTO users (name, email, agent_key, role, manager_id, password_hash, mobile, department, job_role)
    VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?) RETURNING id
  `).run(name.trim(), email, agentKey, role, hashPassword(password), mobile, department, jobRole);
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.json({ token: await createSession(user.id), user: await publicUser(user) });
}));

// An employee or manager who forgot their password flags their own account
// from the login screen — no email required, since there's no email sending
// set up. A manager sees the request in Employee Management and sets a new
// password directly; a super admin sees a manager's request the same way in
// Manage Admins. Always responds the same way regardless of whether the
// email matched anything, so this can't be used to probe which emails exist.
authRouter.post('/forgot-password', ah(async (req, res) => {
  const email = normalizeEmail(req.body.email);
  if (email) {
    const user = await db.prepare("SELECT id FROM users WHERE email = ? AND role IN ('employee', 'manager')").get(email);
    if (user) {
      await db.prepare("UPDATE users SET password_reset_requested_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') WHERE id = ?").run(user.id);
    }
  }
  res.json({ ok: true });
}));

// Managers/employees log in by email; the super admin has no email and logs
// in by username instead (there's only ever one, so no collision risk).
// Accepts either in the same "email" field and figures out which applies.
authRouter.post('/login', ah(async (req, res) => {
  const { password } = req.body;
  const identifier = (req.body.email ?? '').trim();
  // Employees and managers also type their name on the login screen, so it is
  // verified here when sent. Optional on purpose — the web dashboard and any
  // older installed app only send email+password, and must keep working.
  const name = (req.body.name ?? '').trim();
  if (!identifier || !password) return res.status(400).json({ error: 'email/username and password required' });

  const user = await db.prepare(
    "SELECT * FROM users WHERE email = ? OR (role = 'superadmin' AND LOWER(name) = LOWER(?))"
  ).get(normalizeEmail(identifier), identifier);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'invalid email/username or password' });
  }
  // Deliberately the same message as a wrong password — a distinct "wrong
  // name" would confirm the email/password pair itself is valid.
  if (name && name.toLowerCase() !== (user.name ?? '').toLowerCase()) {
    return res.status(401).json({ error: 'invalid email/username or password' });
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
// only connects the background tracking agent, not dashboard access. Also
// doubles as the fix for an account created before email-based login existed
// (needsEmail tells the page whether to ask for one).
authRouter.get('/claim/:token', ah(async (req, res) => {
  const user = await db.prepare('SELECT id, name, email FROM users WHERE claim_token = ?').get(req.params.token);
  if (!user) return res.status(404).json({ error: 'invalid or already-used link' });
  res.json({ name: user.name, needsEmail: !user.email });
}));

authRouter.post('/claim/:token', ah(async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'a password of at least 8 characters is required' });
  }
  const user = await db.prepare('SELECT * FROM users WHERE claim_token = ?').get(req.params.token);
  if (!user) return res.status(404).json({ error: 'invalid or already-used link' });

  const email = normalizeEmail(req.body.email);
  if (!user.email) {
    if (!email) return res.status(400).json({ error: 'email required' });
    const emailTaken = await db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(email, user.id);
    if (emailTaken) return res.status(409).json({ error: 'that email is already registered' });
  }
  const finalEmail = user.email || email;

  await db.prepare('UPDATE users SET password_hash = ?, email = ?, claim_token = NULL WHERE id = ?').run(hashPassword(password), finalEmail, user.id);
  const updated = await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  res.json({ token: await createSession(updated.id), user: await publicUser(updated) });
}));
