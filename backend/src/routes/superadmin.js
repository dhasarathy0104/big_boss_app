import { Router } from 'express';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { requireSuperAdmin, hashPassword } from '../auth.js';
import { buildOverrideMaps, computeProductivity } from '../productivity.js';
import { isValidHHMMOrEmpty } from '../trackingWindow.js';
import { ah } from '../asyncHandler.js';
import { deleteEmployeeCascade } from '../deleteEmployee.js';

export const superadminRouter = Router();

function normalizeEmail(raw) {
  return (raw ?? '').trim().toLowerCase();
}

// Creates a manager account directly — the super admin sets the password
// themselves and passes it along, no invite link or self-registration needed.
superadminRouter.post('/create-admin', requireSuperAdmin, ah(async (req, res) => {
  const { name, password } = req.body;
  const email = normalizeEmail(req.body.email);
  if (!name?.trim() || !email || !password || password.length < 8) {
    return res.status(400).json({ error: 'name, email, and a password of at least 8 characters are required' });
  }
  const existing = await db.prepare('SELECT 1 FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'that email is already registered' });

  const agentKey = crypto.randomBytes(16).toString('hex');
  const info = await db.prepare(`
    INSERT INTO users (name, email, agent_key, role, manager_id, password_hash) VALUES (?, ?, ?, 'manager', NULL, ?) RETURNING id
  `).run(name.trim(), email, agentKey, hashPassword(password));
  const user = await db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.json(user);
}));

// A manager locked out of their account — the super admin sets a new
// password directly and relays it, same idea as the employee claim-link but
// immediate since there's no separate "manager forgot password" email flow.
// Also accepts email, since accounts created before email-based login
// existed have none set and can't log in at all until one is attached.
superadminRouter.post('/managers/:id/change-password', requireSuperAdmin, ah(async (req, res) => {
  const { password } = req.body;
  const email = req.body.email ? normalizeEmail(req.body.email) : null;
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'a password of at least 8 characters is required' });
  }
  const manager = await db.prepare("SELECT * FROM users WHERE id = ? AND role = 'manager'").get(req.params.id);
  if (!manager) return res.status(404).json({ error: 'manager not found' });

  if (email) {
    const emailTaken = await db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(email, manager.id);
    if (emailTaken) return res.status(409).json({ error: 'that email is already registered' });
    await db.prepare('UPDATE users SET password_hash = ?, email = ?, password_reset_requested_at = NULL WHERE id = ?').run(hashPassword(password), email, manager.id);
  } else {
    await db.prepare('UPDATE users SET password_hash = ?, password_reset_requested_at = NULL WHERE id = ?').run(hashPassword(password), manager.id);
  }
  res.json({ ok: true });
}));

// Full profile edit for one manager — the "click the pencil" form on the
// Manage Admins list. Password is optional; leave blank to keep it as-is.
superadminRouter.patch('/managers/:id', requireSuperAdmin, ah(async (req, res) => {
  const manager = await db.prepare("SELECT * FROM users WHERE id = ? AND role = 'manager'").get(req.params.id);
  if (!manager) return res.status(404).json({ error: 'manager not found' });

  const { name, mobile, department, jobRole, password } = req.body;
  const email = req.body.email !== undefined ? normalizeEmail(req.body.email) : undefined;
  if (name !== undefined && !name.trim()) return res.status(400).json({ error: 'name cannot be blank' });
  if (password !== undefined && password !== '' && password.length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  }
  if (email) {
    const emailTaken = await db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(email, manager.id);
    if (emailTaken) return res.status(409).json({ error: 'that email is already registered' });
  }

  const updates = [];
  const values = [];
  if (name !== undefined) { updates.push('name = ?'); values.push(name.trim()); }
  if (email !== undefined) { updates.push('email = ?'); values.push(email || null); }
  if (mobile !== undefined) { updates.push('mobile = ?'); values.push(mobile.trim() || null); }
  if (department !== undefined) { updates.push('department = ?'); values.push(department.trim() || null); }
  if (jobRole !== undefined) { updates.push('job_role = ?'); values.push(jobRole.trim() || null); }
  if (password) { updates.push('password_hash = ?', 'password_reset_requested_at = NULL'); values.push(hashPassword(password)); }
  if (updates.length === 0) return res.status(400).json({ error: 'nothing to update' });

  values.push(manager.id);
  await db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  const updated = await db.prepare(`
    SELECT id, name, email, mobile, department, job_role AS "jobRole", created_at,
      (password_reset_requested_at IS NOT NULL) AS "passwordResetRequested"
    FROM users WHERE id = ?
  `).get(manager.id);
  res.json(updated);
}));

// Full profile edit for one employee, org-wide (any manager's team) —
// mirrors the manager's own PATCH .../team/:employeeId but without the
// same-team restriction, since the super admin can edit anyone.
superadminRouter.patch('/employees/:id', requireSuperAdmin, ah(async (req, res) => {
  const employee = await db.prepare("SELECT * FROM users WHERE id = ? AND role = 'employee'").get(req.params.id);
  if (!employee) return res.status(404).json({ error: 'employee not found' });

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
    SELECT id, name, email, mobile, department, job_role AS "jobRole"
    FROM users WHERE id = ?
  `).get(employee.id);
  res.json(updated);
}));

// Permanently removes an employee org-wide, along with all their tracked
// data — same cascade the manager's own delete uses.
superadminRouter.delete('/employees/:id', requireSuperAdmin, ah(async (req, res) => {
  const employee = await db.prepare("SELECT * FROM users WHERE id = ? AND role = 'employee'").get(req.params.id);
  if (!employee) return res.status(404).json({ error: 'employee not found' });

  await deleteEmployeeCascade(employee.id);
  res.json({ ok: true });
}));

// Super admin can view/set any manager's tracking hours directly — same
// server-side-only enforcement as a manager setting it for themselves
// (see /api/ingest/* in server.js), just not limited to your own team.
superadminRouter.get('/managers/:id/settings', requireSuperAdmin, ah(async (req, res) => {
  const manager = await db.prepare(
    "SELECT screenshot_interval_minutes, tracking_start_time, tracking_end_time FROM users WHERE id = ? AND role = 'manager'"
  ).get(req.params.id);
  if (!manager) return res.status(404).json({ error: 'manager not found' });
  res.json({
    screenshotIntervalMinutes: manager.screenshot_interval_minutes,
    trackingStartTime: manager.tracking_start_time,
    trackingEndTime: manager.tracking_end_time,
  });
}));

superadminRouter.patch('/managers/:id/settings', requireSuperAdmin, ah(async (req, res) => {
  const manager = await db.prepare("SELECT id FROM users WHERE id = ? AND role = 'manager'").get(req.params.id);
  if (!manager) return res.status(404).json({ error: 'manager not found' });

  const start = req.body.trackingStartTime ?? null;
  const end = req.body.trackingEndTime ?? null;
  if (!isValidHHMMOrEmpty(start) || !isValidHHMMOrEmpty(end)) {
    return res.status(400).json({ error: 'tracking hours must be in HH:MM (24-hour) format, or blank' });
  }
  if ((start && !end) || (!start && end)) {
    return res.status(400).json({ error: 'set both a start and end time, or leave both blank' });
  }
  await db.prepare('UPDATE users SET tracking_start_time = ?, tracking_end_time = ? WHERE id = ?')
    .run(start || null, end || null, manager.id);

  const updated = await db.prepare(
    'SELECT screenshot_interval_minutes, tracking_start_time, tracking_end_time FROM users WHERE id = ?'
  ).get(manager.id);
  res.json({
    screenshotIntervalMinutes: updated.screenshot_interval_minutes,
    trackingStartTime: updated.tracking_start_time,
    trackingEndTime: updated.tracking_end_time,
  });
}));

// Org-wide employee transfer — unlike a manager's own team-transfer route,
// the super admin can move any employee to any manager, not just within
// their own team.
superadminRouter.post('/employees/:id/transfer', requireSuperAdmin, ah(async (req, res) => {
  const { targetManagerId } = req.body;
  if (!targetManagerId) return res.status(400).json({ error: 'targetManagerId required' });

  const employee = await db.prepare("SELECT * FROM users WHERE id = ? AND role = 'employee'").get(req.params.id);
  if (!employee) return res.status(404).json({ error: 'employee not found' });

  const targetManager = await db.prepare("SELECT * FROM users WHERE id = ? AND role = 'manager'").get(targetManagerId);
  if (!targetManager) return res.status(404).json({ error: 'target manager not found' });

  await db.prepare('UPDATE users SET manager_id = ? WHERE id = ?').run(targetManager.id, employee.id);
  res.json({ ok: true, employeeId: employee.id, newManagerId: targetManager.id, newManagerName: targetManager.name });
}));

// Org structure: how many admins, how many employees, and who reports to
// whom. No screenshot/activity data here — that's an employee-monitoring
// concept, not something extended to overseeing admins themselves.
superadminRouter.get('/overview', requireSuperAdmin, ah(async (req, res) => {
  const managers = await db.prepare(`
    SELECT id, name, email, mobile, department, job_role AS "jobRole", created_at,
      (password_reset_requested_at IS NOT NULL) AS "passwordResetRequested"
    FROM users WHERE role = 'manager' ORDER BY name
  `).all();
  const admins = await Promise.all(managers.map(async (m) => {
    const employees = await db.prepare(`
      SELECT id, name, email, mobile, department, job_role AS "jobRole"
      FROM users WHERE role = 'employee' AND manager_id = ? ORDER BY name
    `).all(m.id);
    return {
      id: m.id, name: m.name, email: m.email, mobile: m.mobile, department: m.department, jobRole: m.jobRole,
      passwordResetRequested: m.passwordResetRequested, createdAt: m.created_at, employeeCount: employees.length, employees,
    };
  }));
  const totalEmployees = admins.reduce((sum, a) => sum + a.employeeCount, 0);
  res.json({ totalAdmins: admins.length, totalEmployees, admins });
}));

// Same shape as a manager's live-status, just across every manager's team at
// once, with managerName attached so the dashboard can show who's who.
const FRESH_WINDOW_MS = 90_000;
function statusFor(latestEvent) {
  if (!latestEvent) return 'offline';
  const ageMs = Date.now() - new Date(latestEvent.ended_at).getTime();
  if (ageMs > FRESH_WINDOW_MS) return 'offline';
  return latestEvent.is_idle ? 'idle' : 'active';
}

superadminRouter.get('/live-status', requireSuperAdmin, ah(async (req, res) => {
  const employees = await db.prepare(`
    SELECT e.id, e.name, e.email, e.mobile, e.department, e.job_role AS "jobRole",
      e.manager_id AS "managerId", m.name AS "managerName", m.email AS "managerEmail",
      m.mobile AS "managerMobile", m.department AS "managerDepartment", m.job_role AS "managerJobRole"
    FROM users e JOIN users m ON m.id = e.manager_id
    WHERE e.role = 'employee'
    ORDER BY m.name, e.name
  `).all();

  if (employees.length === 0) return res.json([]);

  const ids = employees.map((e) => e.id);
  const managerIds = [...new Set(employees.map((e) => e.managerId))];
  const today = new Date().toISOString().slice(0, 10);

  // Same batching as the manager's own /live-status: a handful of queries
  // for the whole org instead of several per employee, which used to fire
  // hundreds of small round trips per poll at real org sizes.
  const [allRules, latestEvents, todaysEvents] = await Promise.all([
    db.prepare('SELECT * FROM category_rules WHERE manager_id = ANY(?)').all(managerIds),
    db.prepare(`
      SELECT DISTINCT ON (user_id) * FROM activity_events
      WHERE user_id = ANY(?) ORDER BY user_id, ended_at DESC
    `).all(ids),
    db.prepare(`
      SELECT * FROM activity_events
      WHERE user_id = ANY(?) AND started_at >= ? AND started_at < ?
      ORDER BY user_id, started_at
    `).all(ids, `${today}T00:00:00.000Z`, `${today}T23:59:59.999Z`),
  ]);

  const rulesByManager = new Map();
  for (const managerId of managerIds) {
    rulesByManager.set(managerId, buildOverrideMaps(allRules.filter((r) => r.manager_id === managerId)));
  }
  const latestByUser = new Map(latestEvents.map((e) => [e.user_id, e]));
  const eventsByUser = new Map();
  for (const e of todaysEvents) {
    if (!eventsByUser.has(e.user_id)) eventsByUser.set(e.user_id, []);
    eventsByUser.get(e.user_id).push(e);
  }

  const result = [];
  for (const emp of employees) {
    const latestEvent = latestByUser.get(emp.id);
    const overrides = rulesByManager.get(emp.managerId);
    const productivity = computeProductivity(eventsByUser.get(emp.id) ?? [], overrides);

    result.push({
      id: emp.id,
      name: emp.name,
      email: emp.email,
      mobile: emp.mobile,
      department: emp.department,
      jobRole: emp.jobRole,
      managerId: emp.managerId,
      managerName: emp.managerName,
      managerEmail: emp.managerEmail,
      managerMobile: emp.managerMobile,
      managerDepartment: emp.managerDepartment,
      managerJobRole: emp.managerJobRole,
      status: statusFor(latestEvent),
      currentApp: latestEvent?.app_name ?? null,
      currentDomain: latestEvent?.domain ?? null,
      lastSeenAt: latestEvent?.ended_at ?? null,
      todayScore: productivity.score,
      todayActiveMinutes: Math.round(productivity.totals.productive + productivity.totals.neutral + productivity.totals.unproductive + productivity.totals.engaged),
    });
  }

  res.json(result);
}));

// Delete a single screenshot, any employee, org-wide — the super admin can
// see everything, so they can also clean up anything.
superadminRouter.delete('/screenshots/:id', requireSuperAdmin, ah(async (req, res) => {
  const result = await db.prepare('DELETE FROM screenshots WHERE id = ?').run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'screenshot not found' });
  res.json({ ok: true });
}));
