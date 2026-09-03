import { Router } from 'express';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { requireSuperAdmin, hashPassword } from '../auth.js';
import { buildOverrideMaps, computeProductivity } from '../productivity.js';
import { isValidHHMMOrEmpty } from '../trackingWindow.js';
import { ah } from '../asyncHandler.js';
import { deleteEmployeeCascade, deleteManagerCascade } from '../deleteUser.js';
import { getAncestorIdWithRole, getDescendantIds, roleAbove } from '../hierarchy.js';

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
    INSERT INTO users (name, email, agent_key, role, parent_id, password_hash) VALUES (?, ?, ?, 'manager', NULL, ?) RETURNING id
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

// Removes a manager account entirely — refuses while they still have
// employees attached (transfer or remove those first) so nobody is left
// pointing at a manager_id that no longer exists.
superadminRouter.delete('/managers/:id', requireSuperAdmin, ah(async (req, res) => {
  const manager = await db.prepare("SELECT * FROM users WHERE id = ? AND role = 'manager'").get(req.params.id);
  if (!manager) return res.status(404).json({ error: 'manager not found' });

  const { count } = await db.prepare("SELECT COUNT(*)::int AS count FROM users WHERE parent_id = ? AND role = 'employee'").get(manager.id);
  if (count > 0) {
    return res.status(400).json({ error: `This admin still has ${count} employee${count === 1 ? '' : 's'} — transfer or remove them first.` });
  }

  await deleteManagerCascade(manager.id);
  res.json({ ok: true });
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

  values.push(manager.id);
  await db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);

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

  await db.prepare('UPDATE users SET parent_id = ? WHERE id = ?').run(targetManager.id, employee.id);
  res.json({ ok: true, employeeId: employee.id, newManagerId: targetManager.id, newManagerName: targetManager.name });
}));

// Every account in the org except the super admin themselves, flat — the
// super admin has no per-level view of everyone yet (see the /overview
// KNOWN LIMITATION below), so a general "reassign anyone" picker needs its
// own full listing rather than reusing that route.
superadminRouter.get('/users', requireSuperAdmin, ah(async (req, res) => {
  const users = await db.prepare(
    "SELECT id, name, email, role, department FROM users WHERE role != 'superadmin' ORDER BY role, name"
  ).all();
  res.json(users);
}));

// Valid new-parent candidates for reassigning this one person to anywhere
// else in the org: whoever holds the role directly above them, minus their
// current parent (already there) and anyone already in their own subtree
// (which would create a cycle — you can't become your own descendant's
// report).
superadminRouter.get('/users/:id/reassign-candidates', requireSuperAdmin, ah(async (req, res) => {
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'user not found' });
  const parentRole = roleAbove(user.role);
  if (!parentRole) return res.json([]); // superadmin has nobody above it

  const excludeIds = new Set([user.id, user.parent_id, ...(await getDescendantIds(user.id))]);
  const candidates = await db.prepare('SELECT id, name FROM users WHERE role = ? ORDER BY name').all(parentRole);
  res.json(candidates.filter((c) => !excludeIds.has(c.id)));
}));

// Reassigns any one person (and their whole subtree, which moves with them —
// see the manager-only transfer route above for the same reasoning) to a
// new parent anywhere else in the org, as long as the new parent's role is
// exactly the one role above this person's — the fixed-level invariant the
// whole hierarchy depends on (see hierarchy.js's ROLE_ORDER) still has to
// hold after an arbitrary-level move, not just at invite time.
superadminRouter.post('/users/:id/reassign', requireSuperAdmin, ah(async (req, res) => {
  const { newParentId } = req.body;
  if (!newParentId) return res.status(400).json({ error: 'newParentId required' });

  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'user not found' });
  if (user.role === 'superadmin') return res.status(400).json({ error: "can't reassign the super admin" });
  if (Number(newParentId) === user.parent_id) return res.status(400).json({ error: 'already reports there' });

  const newParent = await db.prepare('SELECT * FROM users WHERE id = ?').get(newParentId);
  if (!newParent) return res.status(404).json({ error: 'new parent not found' });
  if (newParent.role !== roleAbove(user.role)) {
    return res.status(400).json({ error: `new parent must be a ${roleAbove(user.role)}` });
  }
  const descendantIds = await getDescendantIds(user.id);
  if (newParent.id === user.id || descendantIds.includes(newParent.id)) {
    return res.status(400).json({ error: "can't reassign someone under their own report" });
  }

  await db.prepare('UPDATE users SET parent_id = ? WHERE id = ?').run(newParent.id, user.id);
  res.json({ ok: true, userId: user.id, newParentId: newParent.id, newParentName: newParent.name });
}));

// Org structure: how many admins, how many employees, and who reports to
// whom. No screenshot/activity data here — that's an employee-monitoring
// concept, not something extended to overseeing admins themselves.
//
// KNOWN LIMITATION (tracked for the dashboard rework): this still only
// surfaces Manager-role accounts and their direct employees, the same
// two-level shape as before the hierarchy rework. GM/AGM/AM/TL accounts and
// employees more than one level below a Manager exist and are fully
// functional (see hierarchy.js), but won't show up in this particular
// overview until the "Manage Admins"-equivalent view is redesigned to walk
// the whole tree instead of one fixed level.
superadminRouter.get('/overview', requireSuperAdmin, ah(async (req, res) => {
  const managers = await db.prepare(`
    SELECT id, name, email, mobile, department, job_role AS "jobRole", created_at,
      (password_reset_requested_at IS NOT NULL) AS "passwordResetRequested"
    FROM users WHERE role = 'manager' ORDER BY name
  `).all();
  const admins = await Promise.all(managers.map(async (m) => {
    const employees = await db.prepare(`
      SELECT id, name, email, mobile, department, job_role AS "jobRole"
      FROM users WHERE role = 'employee' AND parent_id = ? ORDER BY name
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
      e.parent_id AS "managerId", m.name AS "managerName", m.email AS "managerEmail",
      m.mobile AS "managerMobile", m.department AS "managerDepartment", m.job_role AS "managerJobRole"
    FROM users e JOIN users m ON m.id = e.parent_id
    WHERE e.role = 'employee'
    ORDER BY m.name, e.name
  `).all();

  if (employees.length === 0) return res.json([]);

  const ids = employees.map((e) => e.id);
  const today = new Date().toISOString().slice(0, 10);

  // Category rules belong to the department Manager specifically — an
  // employee's direct parent (shown above as managerId/managerName) could
  // now be a TL or AM instead, several levels below the Manager who
  // actually owns the rules, so each employee's owning Manager is resolved
  // individually rather than assumed to be their direct parent.
  const owningManagerByEmployee = new Map();
  for (const emp of employees) {
    owningManagerByEmployee.set(emp.id, await getAncestorIdWithRole(emp.id, 'manager'));
  }
  const managerIds = [...new Set([...owningManagerByEmployee.values()].filter(Boolean))];

  // Same batching as the manager's own /live-status: a handful of queries
  // for the whole org instead of several per employee, which used to fire
  // hundreds of small round trips per poll at real org sizes.
  const [allRules, latestEvents, todaysEvents] = await Promise.all([
    managerIds.length === 0 ? [] : db.prepare('SELECT * FROM category_rules WHERE manager_id = ANY(?)').all(managerIds),
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
    const overrides = rulesByManager.get(owningManagerByEmployee.get(emp.id));
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
