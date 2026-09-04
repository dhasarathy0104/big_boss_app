import { Router } from 'express';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { hashPassword, verifyPassword, createSession, requireAuth } from '../auth.js';
import { roleBelow } from '../hierarchy.js';
import { ah } from '../asyncHandler.js';

export const authRouter = Router();

async function publicUser(u) {
  const manager = u.parent_id ? await db.prepare('SELECT name FROM users WHERE id = ?').get(u.parent_id) : null;
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
    managerId: u.parent_id,
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
    INSERT INTO users (name, email, agent_key, role, parent_id, password_hash) VALUES (?, ?, ?, 'manager', NULL, ?) RETURNING id
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

// Public — the open self-registration form's "who do you report to" pickers
// (see register-admin below). Minimal fields only, reachable before login.
// AM options carry their own manager's name/department too, since the TL
// registration form derives Manager read-only from whichever AM is picked
// rather than letting TL set it independently (see register-admin's tl
// branch for why).
authRouter.get('/accounts', ah(async (req, res) => {
  const { role } = req.query;
  if (!['gm', 'agm', 'manager', 'am'].includes(role)) {
    return res.status(400).json({ error: 'role must be one of gm, agm, manager, am' });
  }
  if (role === 'am') {
    const rows = await db.prepare(`
      SELECT am.id, am.name, mgr.name AS "managerName", mgr.department AS "department"
      FROM users am
      LEFT JOIN users mgr ON mgr.id = am.parent_id AND mgr.role = 'manager'
      WHERE am.role = 'am' ORDER BY am.name
    `).all();
    return res.json(rows);
  }
  const rows = await db.prepare('SELECT id, name, department FROM users WHERE role = ? ORDER BY name').all(role);
  res.json(rows);
}));

// Open self-service signup for every non-employee role — no invite link or
// existing-supervisor approval required, by the same explicit-request
// precedent as the original manager/superadmin version below. Extended to
// cover the whole chain (gm/agm/manager/am/tl) so each level declares their
// own place in the org by picking their real superior from /accounts above,
// instead of requiring an invite from that superior.
authRouter.post('/register-admin', ah(async (req, res) => {
  const { name, password, role } = req.body;
  const VALID_ROLES = ['gm', 'agm', 'manager', 'am', 'tl', 'superadmin'];
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of ${VALID_ROLES.join(', ')}` });
  }
  // A super admin logs in with just a username (no email, by explicit
  // request) — everyone else needs a real email.
  const email = role === 'superadmin' ? null : normalizeEmail(req.body.email);
  if (!name?.trim() || (role !== 'superadmin' && !email) || !password || password.length < 8) {
    return res.status(400).json({ error: `name${role === 'superadmin' ? ',' : ', email,'} and a password of at least 8 characters are required` });
  }
  // Only ever one super admin, by explicit request. Unlike everyone else's
  // self-registration, this isn't reopenable via the UI; someone has to
  // remove the existing super admin first.
  if (role === 'superadmin') {
    const hasSuperAdmin = await db.prepare("SELECT 1 FROM users WHERE role = 'superadmin'").get();
    if (hasSuperAdmin) return res.status(409).json({ error: 'a super admin account already exists' });
  } else {
    const existing = await db.prepare('SELECT 1 FROM users WHERE email = ?').get(email);
    if (existing) return res.status(409).json({ error: 'that email is already registered' });
  }

  // Resolve parent_id from whichever superior this role declared, never
  // trusting the client's claim about it without checking the row actually
  // holds the expected role — this is what keeps a self-declared hierarchy
  // link from pointing at a made-up or wrong-tier id.
  let parentId = null;
  if (role === 'gm') {
    const superadmin = await db.prepare("SELECT id FROM users WHERE role = 'superadmin'").get();
    if (!superadmin) return res.status(400).json({ error: 'no super admin exists yet for a General Manager to report to' });
    parentId = superadmin.id;
  } else if (role === 'agm') {
    const gm = await db.prepare("SELECT id FROM users WHERE id = ? AND role = 'gm'").get(req.body.gmId);
    if (!gm) return res.status(400).json({ error: 'select a valid General Manager' });
    parentId = gm.id;
  } else if (role === 'manager') {
    const agm = await db.prepare("SELECT id FROM users WHERE id = ? AND role = 'agm'").get(req.body.agmId);
    if (!agm) return res.status(400).json({ error: 'select a valid Assistant General Manager' });
    parentId = agm.id;
  } else if (role === 'am') {
    const manager = await db.prepare("SELECT id FROM users WHERE id = ? AND role = 'manager'").get(req.body.managerId);
    if (!manager) return res.status(400).json({ error: 'select a valid Manager' });
    parentId = manager.id;
  } else if (role === 'tl') {
    // Manager is deliberately derived from the picked AM's own chain, not a
    // second independent field — see RegisterAdminForm's tl branch for why.
    const am = await db.prepare("SELECT id FROM users WHERE id = ? AND role = 'am'").get(req.body.amId);
    if (!am) return res.status(400).json({ error: 'select a valid Assistant Manager' });
    parentId = am.id;
  }

  // Profile fields make sense for any real account except the super admin,
  // who has none of this, by the same "no email" reasoning as above.
  const mobile = role === 'superadmin' ? null : (req.body.mobile ?? '').trim() || null;
  const department = role === 'superadmin' ? null : (req.body.department ?? '').trim() || null;
  const jobRole = role === 'superadmin' ? null : (req.body.jobRole ?? '').trim() || null;

  const agentKey = crypto.randomBytes(16).toString('hex');
  const info = await db.prepare(`
    INSERT INTO users (name, email, agent_key, role, parent_id, password_hash, mobile, department, job_role)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
  `).run(name.trim(), email, agentKey, role, parentId, hashPassword(password), mobile, department, jobRole);
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.json({ token: await createSession(user.id), user: await publicUser(user) });
}));

// Anyone who forgot their password flags their own account from the login
// screen — no email sending set up, so whoever is directly above them in
// the reporting chain sees the request (see SupervisorTeamView's team list)
// and sets a new password directly. Every role has someone above them
// except Super Admin, which has no email at all and genuinely no recovery
// path, by design. Always responds the same way regardless of whether the
// email matched anything, so this can't be used to probe which emails exist.
authRouter.post('/forgot-password', ah(async (req, res) => {
  const email = normalizeEmail(req.body.email);
  if (email) {
    const user = await db.prepare("SELECT id FROM users WHERE email = ? AND role != 'superadmin'").get(email);
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

// The generalized invite-link claim for any supervisor tier (GM, AGM,
// Manager, AM, TL) — the recipient fills in their own details and the
// account is created right then, unlike /claim/:token above (which only
// sets a password on a row someone else already pre-created). This is the
// web /join/:token page's flow. Employees are deliberately excluded here —
// they're created via the native app's agent-enrollment flow (/api/enroll)
// instead, since that's the one that also connects the tracking agent; a
// TL's invite link creating a dashboard-only, untracked account here would
// silently skip that.
authRouter.post('/claim-invite/:token', ah(async (req, res) => {
  const { name, password } = req.body;
  const email = normalizeEmail(req.body.email);
  if (!name?.trim() || !email || !password || password.length < 8) {
    return res.status(400).json({ error: 'name, email, and a password of at least 8 characters are required' });
  }

  const invite = await db.prepare('SELECT * FROM invite_links WHERE token = ? AND revoked = 0').get(req.params.token);
  if (!invite) return res.status(404).json({ error: 'invalid or revoked invite link' });

  const inviter = await db.prepare('SELECT id, role FROM users WHERE id = ?').get(invite.inviter_id);
  const role = roleBelow(inviter?.role);
  if (!role || role === 'employee') return res.status(400).json({ error: 'this invite link cannot be used here' });

  const emailTaken = await db.prepare('SELECT 1 FROM users WHERE email = ?').get(email);
  if (emailTaken) return res.status(409).json({ error: 'that email is already registered' });

  const mobile = (req.body.mobile ?? '').trim() || null;
  const department = (req.body.department ?? '').trim() || null;
  const jobRole = (req.body.jobRole ?? '').trim() || null;

  const agentKey = crypto.randomBytes(16).toString('hex');
  const info = await db.prepare(`
    INSERT INTO users (name, email, agent_key, role, parent_id, password_hash, mobile, department, job_role)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
  `).run(name.trim(), email, agentKey, role, inviter.id, hashPassword(password), mobile, department, jobRole);
  await db.prepare('UPDATE invite_links SET use_count = use_count + 1 WHERE id = ?').run(invite.id);

  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.json({ token: await createSession(user.id), user: await publicUser(user) });
}));
