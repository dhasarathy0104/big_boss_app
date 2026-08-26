import { Router } from 'express';
import crypto from 'node:crypto';
import { db, randomToken } from '../db.js';
import { requireManager, requireManagerSelf, hashPassword } from '../auth.js';
import { ah } from '../asyncHandler.js';

export const managersRouter = Router();

function normalizeEmail(raw) {
  return (raw ?? '').trim().toLowerCase();
}

// Any logged-in manager can create another manager account (a peer, e.g. for
// team-transfer scenarios) — not open public self-registration, which was
// intentionally locked to the very first manager account only. Reuses the
// same claim-link flow employees use to set their own password, since the
// claim mechanism doesn't care about role.
// Note: creating a super admin this way was removed — that role is now
// capped at exactly one account, created only via the super admin's own
// dashboard (see routes/superadmin.js's create-admin, despite the name that
// one makes managers; there's no create-superadmin anywhere anymore).
managersRouter.post('/create-peer', requireManager, ah(async (req, res) => {
  const { name } = req.body;
  const email = normalizeEmail(req.body.email);
  if (!name?.trim() || !email) return res.status(400).json({ error: 'name and email required' });
  const existing = await db.prepare('SELECT 1 FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'that email is already registered' });

  const agentKey = crypto.randomBytes(16).toString('hex');
  const claimToken = randomToken(16);
  const info = await db.prepare(`
    INSERT INTO users (name, email, agent_key, role, manager_id, claim_token) VALUES (?, ?, ?, 'manager', NULL, ?) RETURNING id
  `).run(name.trim(), email, agentKey, claimToken);
  res.json({ id: info.lastInsertRowid, name: name.trim(), claimToken });
}));

managersRouter.get('/:id/team', requireManagerSelf, ah(async (req, res) => {
  const team = await db.prepare(`
    SELECT id, name, email, mobile, department, job_role AS "jobRole", created_at,
      (claim_token IS NOT NULL) AS "hasPendingClaim", (password_hash IS NOT NULL) AS "hasDashboardLogin",
      (password_reset_requested_at IS NOT NULL) AS "passwordResetRequested"
    FROM users WHERE manager_id = ? AND role = 'employee' ORDER BY name
  `).all(req.params.id);
  res.json(team);
}));

// Manager sets a new password directly for one of their own employees — the
// "forgot password" fix once an employee has flagged their account via
// /api/auth/forgot-password (see Employee Management tab), same idea as a
// super admin resetting a manager's password.
managersRouter.post('/:id/team/:employeeId/set-password', requireManagerSelf, ah(async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'a password of at least 8 characters is required' });
  }
  const employee = await db.prepare("SELECT * FROM users WHERE id = ? AND manager_id = ? AND role = 'employee'")
    .get(req.params.employeeId, req.params.id);
  if (!employee) return res.status(404).json({ error: 'employee not found on your team' });

  await db.prepare('UPDATE users SET password_hash = ?, password_reset_requested_at = NULL WHERE id = ?')
    .run(hashPassword(password), employee.id);
  res.json({ ok: true });
}));

managersRouter.get('/:id/invites', requireManagerSelf, ah(async (req, res) => {
  const invites = await db.prepare(`
    SELECT * FROM invite_links WHERE manager_id = ? AND revoked = 0 ORDER BY created_at DESC
  `).all(req.params.id);
  res.json(invites);
}));

managersRouter.post('/:id/invites', requireManagerSelf, ah(async (req, res) => {
  const token = randomToken(12);
  await db.prepare('INSERT INTO invite_links (token, manager_id) VALUES (?, ?)').run(token, req.params.id);
  res.json(await db.prepare('SELECT * FROM invite_links WHERE token = ?').get(token));
}));

managersRouter.post('/:id/invites/:inviteId/revoke', requireManagerSelf, ah(async (req, res) => {
  await db.prepare('UPDATE invite_links SET revoked = 1 WHERE id = ? AND manager_id = ?').run(req.params.inviteId, req.params.id);
  res.json({ ok: true });
}));

managersRouter.get('/:id/settings', requireManagerSelf, ah(async (req, res) => {
  const manager = await db.prepare('SELECT screenshot_interval_minutes FROM users WHERE id = ?').get(req.params.id);
  res.json({ screenshotIntervalMinutes: manager.screenshot_interval_minutes });
}));

managersRouter.patch('/:id/settings', requireManagerSelf, ah(async (req, res) => {
  const { screenshotIntervalMinutes } = req.body;
  const minutes = Number(screenshotIntervalMinutes);
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 240) {
    return res.status(400).json({ error: 'screenshotIntervalMinutes must be an integer between 0 (off) and 240' });
  }
  await db.prepare('UPDATE users SET screenshot_interval_minutes = ? WHERE id = ?').run(minutes, req.params.id);
  res.json({ screenshotIntervalMinutes: minutes });
}));

// Generates (or regenerates) a one-time link an employee uses to set their own
// dashboard password — separate from the invite link, which only connects the
// background tracking agent. Manager hands this to that specific employee.
managersRouter.post('/:id/team/:employeeId/claim-link', requireManagerSelf, ah(async (req, res) => {
  const employee = await db.prepare("SELECT * FROM users WHERE id = ? AND manager_id = ? AND role = 'employee'")
    .get(req.params.employeeId, req.params.id);
  if (!employee) return res.status(404).json({ error: 'employee not found on your team' });

  const claimToken = randomToken(16);
  await db.prepare('UPDATE users SET claim_token = ? WHERE id = ?').run(claimToken, employee.id);
  res.json({ claimToken });
}));

// Other manager accounts, to pick a transfer destination from.
managersRouter.get('/:id/other-managers', requireManagerSelf, ah(async (req, res) => {
  const others = await db.prepare("SELECT id, name FROM users WHERE role = 'manager' AND id != ? ORDER BY name")
    .all(req.params.id);
  res.json(others);
}));

// Moves an employee to a different manager. Their whole record (history,
// screenshots, attendance, leave) moves with them — manager_id is the one
// source of truth for "whose team is this employee on", there's no
// before/after split. The old manager loses access immediately; the new
// manager gains full access immediately, including past data.
managersRouter.post('/:id/team/:employeeId/transfer', requireManagerSelf, ah(async (req, res) => {
  const { targetManagerId } = req.body;
  if (!targetManagerId) return res.status(400).json({ error: 'targetManagerId required' });
  if (Number(targetManagerId) === Number(req.params.id)) {
    return res.status(400).json({ error: 'employee is already on your team' });
  }

  const employee = await db.prepare("SELECT * FROM users WHERE id = ? AND manager_id = ? AND role = 'employee'")
    .get(req.params.employeeId, req.params.id);
  if (!employee) return res.status(404).json({ error: 'employee not found on your team' });

  const targetManager = await db.prepare("SELECT * FROM users WHERE id = ? AND role = 'manager'").get(targetManagerId);
  if (!targetManager) return res.status(404).json({ error: 'target manager not found' });

  await db.prepare('UPDATE users SET manager_id = ? WHERE id = ?').run(targetManager.id, employee.id);
  res.json({ ok: true, employeeId: employee.id, newManagerId: targetManager.id, newManagerName: targetManager.name });
}));
