import { Router } from 'express';
import crypto from 'node:crypto';
import { db, randomToken } from '../db.js';
import { requireManager, requireManagerSelf, hashPassword } from '../auth.js';
import { isValidHHMMOrEmpty } from '../trackingWindow.js';
import { ah } from '../asyncHandler.js';
import { deleteEmployeeCascade } from '../deleteUser.js';
import { getDescendantIds } from '../hierarchy.js';

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
    INSERT INTO users (name, email, agent_key, role, parent_id, claim_token) VALUES (?, ?, ?, 'manager', NULL, ?) RETURNING id
  `).run(name.trim(), email, agentKey, claimToken);
  res.json({ id: info.lastInsertRowid, name: name.trim(), claimToken });
}));

// Every employee anywhere below this manager — via AM then TL, the fixed
// two extra levels the hierarchy rework inserted between Manager and
// Employee — not just direct reports (a manager has none directly anymore;
// every employee's real parent is a TL). tlName/amName resolve via a
// straight two-hop join since that shape is fixed; a legacy employee whose
// parent_id still points straight at a manager (pre-dating AM/TL) shows
// both as "—" rather than being excluded.
managersRouter.get('/:id/team', requireManagerSelf, ah(async (req, res) => {
  const descendantIds = await getDescendantIds(Number(req.params.id));
  if (descendantIds.length === 0) return res.json([]);
  const team = await db.prepare(`
    SELECT e.id, e.name, e.email, e.mobile, e.department, e.job_role AS "jobRole", e.created_at,
      (e.claim_token IS NOT NULL) AS "hasPendingClaim", (e.password_hash IS NOT NULL) AS "hasDashboardLogin",
      (e.password_reset_requested_at IS NOT NULL) AS "passwordResetRequested",
      tl.id AS "tlId", tl.name AS "tlName", am.id AS "amId", am.name AS "amName"
    FROM users e
    LEFT JOIN users tl ON tl.id = e.parent_id AND tl.role = 'tl'
    LEFT JOIN users am ON am.id = tl.parent_id AND am.role = 'am'
    WHERE e.id = ANY(?) AND e.role = 'employee' ORDER BY e.name
  `).all(descendantIds);
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
  const descendantIds = await getDescendantIds(Number(req.params.id));
  const employee = descendantIds.includes(Number(req.params.employeeId))
    ? await db.prepare("SELECT * FROM users WHERE id = ? AND role = 'employee'").get(req.params.employeeId)
    : null;
  if (!employee) return res.status(404).json({ error: 'employee not found on your team' });

  await db.prepare('UPDATE users SET password_hash = ?, password_reset_requested_at = NULL WHERE id = ?')
    .run(hashPassword(password), employee.id);
  res.json({ ok: true });
}));

// Edits an employee's own profile fields, and optionally their password in
// the same request — the "click the pencil, edit everything, Save" flow
// replaces the old separate set-password/claim-link buttons for this view.
managersRouter.patch('/:id/team/:employeeId', requireManagerSelf, ah(async (req, res) => {
  const descendantIds = await getDescendantIds(Number(req.params.id));
  const employee = descendantIds.includes(Number(req.params.employeeId))
    ? await db.prepare("SELECT * FROM users WHERE id = ? AND role = 'employee'").get(req.params.employeeId)
    : null;
  if (!employee) return res.status(404).json({ error: 'employee not found on your team' });

  const { name, email, mobile, department, jobRole, password } = req.body;
  if (name !== undefined && !name.trim()) return res.status(400).json({ error: 'name cannot be blank' });
  if (password !== undefined && password !== '' && password.length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  }

  const updates = [];
  const values = [];
  if (name !== undefined) { updates.push('name = ?'); values.push(name.trim()); }
  if (email !== undefined) { updates.push('email = ?'); values.push(email.trim() || null); }
  if (mobile !== undefined) { updates.push('mobile = ?'); values.push(mobile.trim() || null); }
  if (department !== undefined) { updates.push('department = ?'); values.push(department.trim() || null); }
  if (jobRole !== undefined) { updates.push('job_role = ?'); values.push(jobRole.trim() || null); }
  if (password) { updates.push('password_hash = ?', 'password_reset_requested_at = NULL'); values.push(hashPassword(password)); }
  if (updates.length === 0) return res.status(400).json({ error: 'nothing to update' });

  values.push(employee.id);
  await db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  const updated = await db.prepare(`
    SELECT id, name, email, mobile, department, job_role AS "jobRole", created_at,
      (claim_token IS NOT NULL) AS "hasPendingClaim", (password_hash IS NOT NULL) AS "hasDashboardLogin",
      (password_reset_requested_at IS NOT NULL) AS "passwordResetRequested"
    FROM users WHERE id = ?
  `).get(employee.id);
  res.json(updated);
}));

// Permanently removes an employee and all their tracked data (activity,
// screenshots, timesheets, attendance, leave). Irreversible — the UI should
// confirm before calling this.
managersRouter.delete('/:id/team/:employeeId', requireManagerSelf, ah(async (req, res) => {
  const descendantIds = await getDescendantIds(Number(req.params.id));
  const employee = descendantIds.includes(Number(req.params.employeeId))
    ? await db.prepare("SELECT * FROM users WHERE id = ? AND role = 'employee'").get(req.params.employeeId)
    : null;
  if (!employee) return res.status(404).json({ error: 'employee not found on your team' });

  await deleteEmployeeCascade(employee.id);
  res.json({ ok: true });
}));

managersRouter.get('/:id/settings', requireManagerSelf, ah(async (req, res) => {
  const manager = await db.prepare(
    'SELECT screenshot_interval_minutes, tracking_start_time, tracking_end_time FROM users WHERE id = ?'
  ).get(req.params.id);
  res.json({
    screenshotIntervalMinutes: manager.screenshot_interval_minutes,
    trackingStartTime: manager.tracking_start_time,
    trackingEndTime: manager.tracking_end_time,
  });
}));

// Tracking hours are enforced server-side only (see /api/ingest/* in
// server.js) — an already-installed agent needs no update or restart for a
// change here to take effect; it just stops seeing its own uploads stored
// outside the window. Send an empty string for either time to clear it
// back to "no restriction, track around the clock."
managersRouter.patch('/:id/settings', requireManagerSelf, ah(async (req, res) => {
  const updates = [];
  const values = [];

  if ('screenshotIntervalMinutes' in req.body) {
    const minutes = Number(req.body.screenshotIntervalMinutes);
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 240) {
      return res.status(400).json({ error: 'screenshotIntervalMinutes must be an integer between 0 (off) and 240' });
    }
    updates.push('screenshot_interval_minutes = ?');
    values.push(minutes);
  }
  if ('trackingStartTime' in req.body || 'trackingEndTime' in req.body) {
    const start = req.body.trackingStartTime ?? null;
    const end = req.body.trackingEndTime ?? null;
    if (!isValidHHMMOrEmpty(start) || !isValidHHMMOrEmpty(end)) {
      return res.status(400).json({ error: 'tracking hours must be in HH:MM (24-hour) format, or blank' });
    }
    if ((start && !end) || (!start && end)) {
      return res.status(400).json({ error: 'set both a start and end time, or leave both blank' });
    }
    updates.push('tracking_start_time = ?', 'tracking_end_time = ?');
    values.push(start || null, end || null);
  }
  if (updates.length === 0) return res.status(400).json({ error: 'nothing to update' });

  values.push(req.params.id);
  await db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const manager = await db.prepare(
    'SELECT screenshot_interval_minutes, tracking_start_time, tracking_end_time FROM users WHERE id = ?'
  ).get(req.params.id);
  res.json({
    screenshotIntervalMinutes: manager.screenshot_interval_minutes,
    trackingStartTime: manager.tracking_start_time,
    trackingEndTime: manager.tracking_end_time,
  });
}));

// Generates (or regenerates) a one-time link an employee uses to set their own
// dashboard password — separate from the invite link, which only connects the
// background tracking agent. Manager hands this to that specific employee.
managersRouter.post('/:id/team/:employeeId/claim-link', requireManagerSelf, ah(async (req, res) => {
  const descendantIds = await getDescendantIds(Number(req.params.id));
  const employee = descendantIds.includes(Number(req.params.employeeId))
    ? await db.prepare("SELECT * FROM users WHERE id = ? AND role = 'employee'").get(req.params.employeeId)
    : null;
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
// screenshots, attendance, leave) moves with them — parent_id is the one
// source of truth for "whose team is this employee on", there's no
// before/after split. The old manager loses access immediately; the new
// manager gains full access immediately, including past data.
//
// Only ever valid for a legacy employee whose parent_id still points
// straight at a manager (pre-dating AM/TL) — pointing a properly-nested
// employee's parent_id at a manager directly would skip AM/TL entirely and
// break the fixed-level hierarchy (see hierarchy.js's ROLE_ORDER). Moving
// one of those is what the TL's own peer-transfer (SupervisorTeamView) or
// the Assistant Manager/Team Lead picker in the employee's own Employee
// Management edit form (EmployeeManagementTable) are for instead.
managersRouter.post('/:id/team/:employeeId/transfer', requireManagerSelf, ah(async (req, res) => {
  const { targetManagerId } = req.body;
  if (!targetManagerId) return res.status(400).json({ error: 'targetManagerId required' });
  if (Number(targetManagerId) === Number(req.params.id)) {
    return res.status(400).json({ error: 'employee is already on your team' });
  }

  const descendantIds = await getDescendantIds(Number(req.params.id));
  const employee = descendantIds.includes(Number(req.params.employeeId))
    ? await db.prepare("SELECT * FROM users WHERE id = ? AND role = 'employee'").get(req.params.employeeId)
    : null;
  if (!employee) return res.status(404).json({ error: 'employee not found on your team' });
  if (employee.parent_id !== Number(req.params.id)) {
    return res.status(400).json({
      error: "this employee reports through an AM/TL — use their TL's Team & Invite tab, or the Assistant Manager/Team Lead picker in their Employee Management edit form, to move them instead",
    });
  }

  const targetManager = await db.prepare("SELECT * FROM users WHERE id = ? AND role = 'manager'").get(targetManagerId);
  if (!targetManager) return res.status(404).json({ error: 'target manager not found' });

  await db.prepare('UPDATE users SET parent_id = ? WHERE id = ?').run(targetManager.id, employee.id);
  res.json({ ok: true, employeeId: employee.id, newManagerId: targetManager.id, newManagerName: targetManager.name });
}));
