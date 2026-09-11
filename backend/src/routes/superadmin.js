import { Router } from 'express';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { requireSuperAdmin, hashPassword } from '../auth.js';
import { buildOverrideMaps, computeProductivity } from '../productivity.js';
import { isValidHHMMOrEmpty } from '../trackingWindow.js';
import { ah } from '../asyncHandler.js';
import { deleteEmployeeCascade, deleteManagerCascade } from '../deleteUser.js';
import { getAncestorIdWithRole, getDescendantIds, roleAbove, buildDepartment, buildUnassignedDepartments, listTlsWithManagerInfo } from '../hierarchy.js';

export const superadminRouter = Router();

function normalizeEmail(raw) {
  return (raw ?? '').trim().toLowerCase();
}

// Creates a manager account directly — the super admin sets the password
// themselves and passes it along, no invite link or self-registration
// needed. Parent is the one Assistant General Manager, same as a
// self-registered manager (see auth.js's register-admin) — there's only
// ever one AGM, so this isn't a choice, just an automatic link.
superadminRouter.post('/create-admin', requireSuperAdmin, ah(async (req, res) => {
  const { name, password } = req.body;
  const email = normalizeEmail(req.body.email);
  if (!name?.trim() || !email || !password || password.length < 8) {
    return res.status(400).json({ error: 'name, email, and a password of at least 8 characters are required' });
  }
  const existing = await db.prepare('SELECT 1 FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'that email is already registered' });
  const agm = await db.prepare("SELECT id FROM users WHERE role = 'agm'").get();

  const agentKey = crypto.randomBytes(16).toString('hex');
  const info = await db.prepare(`
    INSERT INTO users (name, email, agent_key, role, parent_id, password_hash) VALUES (?, ?, ?, 'manager', ?, ?) RETURNING id
  `).run(name.trim(), email, agentKey, agm?.id ?? null, hashPassword(password));
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

// Every GM/AGM/Manager/AM/TL account org-wide, for the expanded Manage
// Admins list — previously that list only ever showed Manager rows.
superadminRouter.get('/admins', requireSuperAdmin, ah(async (req, res) => {
  const rows = await db.prepare(`
    SELECT id, name, email, mobile, role, department, job_role AS "jobRole", parent_id AS "parentId"
    FROM users WHERE role IN ('gm', 'agm', 'manager', 'am', 'tl')
    ORDER BY CASE role WHEN 'gm' THEN 1 WHEN 'agm' THEN 2 WHEN 'manager' THEN 3 WHEN 'am' THEN 4 ELSE 5 END, name
  `).all();
  res.json(rows);
}));

// Full profile edit for any GM/AGM/AM/TL — the generalized version of the
// manager-only PATCH /managers/:id below, for the four roles that don't have
// their own Projects/Billing/tracking-hours settings to also manage here.
// Password is optional; leave blank to keep it as-is.
superadminRouter.patch('/admins/:id', requireSuperAdmin, ah(async (req, res) => {
  const admin = await db.prepare("SELECT * FROM users WHERE id = ? AND role IN ('gm', 'agm', 'am', 'tl')").get(req.params.id);
  if (!admin) return res.status(404).json({ error: 'account not found' });

  const { name, mobile, department, jobRole, password } = req.body;
  const email = req.body.email !== undefined ? normalizeEmail(req.body.email) : undefined;
  if (name !== undefined && !name.trim()) return res.status(400).json({ error: 'name cannot be blank' });
  if (password !== undefined && password !== '' && password.length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  }
  if (email) {
    const emailTaken = await db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(email, admin.id);
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

  values.push(admin.id);
  await db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  const updated = await db.prepare(`
    SELECT id, name, email, mobile, role, department, job_role AS "jobRole" FROM users WHERE id = ?
  `).get(admin.id);
  res.json(updated);
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

  // This used to count only direct employee children (parent_id = manager.id
  // AND role = 'employee'), which no employee has matched since Stage 2's
  // TL-invite rework — the guard never actually blocked anything, so
  // deleteManagerCascade's own DELETE FROM users would hit a foreign-key
  // violation the moment the manager still had a real AM underneath (that
  // AM's own parent_id would go dangling), surfacing to the user as a raw
  // "something went wrong". Walking the whole subtree instead of one
  // direct-role count catches AM/TL/employees at any depth.
  const descendantIds = await getDescendantIds(manager.id);
  if (descendantIds.length > 0) {
    return res.status(400).json({
      error: `This admin still has ${descendantIds.length} ${descendantIds.length === 1 ? 'person' : 'people'} in their department — transfer or remove them first.`,
    });
  }

  await deleteManagerCascade(manager.id);
  res.json({ ok: true });
}));

// Removes an Assistant Manager or Team Lead — the same "no one left under
// them" guard as the manager delete above, just checking the one role
// directly below instead of always 'employee'. deleteManagerCascade is
// generic enough for these two roles too (see its own comment): an AM/TL has
// no projects/category_rules of their own, so those deletes just no-op, but
// they can have invite_links (a TL's own employee-invite link) and a
// session, both of which it does clean up. GM/AGM are deliberately not
// offered here — capped-at-one roles, removed only by direct DB access if
// ever truly needed, not a casual row-delete.
superadminRouter.delete('/admins/:id', requireSuperAdmin, ah(async (req, res) => {
  const admin = await db.prepare("SELECT * FROM users WHERE id = ? AND role IN ('am', 'tl')").get(req.params.id);
  if (!admin) return res.status(404).json({ error: 'account not found' });

  const childRole = admin.role === 'am' ? 'tl' : 'employee';
  const childLabel = admin.role === 'am' ? 'team lead' : 'employee';
  const { count } = await db.prepare('SELECT COUNT(*)::int AS count FROM users WHERE parent_id = ? AND role = ?').get(admin.id, childRole);
  if (count > 0) {
    return res.status(400).json({ error: `This admin still has ${count} ${childLabel}${count === 1 ? '' : 's'} — transfer or remove them first.` });
  }

  await deleteManagerCascade(admin.id);
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

// Same shape as the manager-settings pair above, but for the one super
// admin row itself — the fallback GET /api/agent-settings uses when an
// employee's chain doesn't reach a real Manager at all (a detached TL/AM,
// or no Manager exists yet), so there's a real, settable value controlling
// what such an employee's agent actually does instead of a bare hardcoded
// constant. No :id param since there's only ever one super admin.
superadminRouter.get('/org-defaults', requireSuperAdmin, ah(async (req, res) => {
  const sa = await db.prepare(
    "SELECT screenshot_interval_minutes, tracking_start_time, tracking_end_time FROM users WHERE role = 'superadmin'"
  ).get();
  res.json({
    screenshotIntervalMinutes: sa?.screenshot_interval_minutes ?? 5,
    trackingStartTime: sa?.tracking_start_time ?? null,
    trackingEndTime: sa?.tracking_end_time ?? null,
  });
}));

superadminRouter.patch('/org-defaults', requireSuperAdmin, ah(async (req, res) => {
  const sa = await db.prepare("SELECT id FROM users WHERE role = 'superadmin'").get();

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

  values.push(sa.id);
  await db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const updated = await db.prepare(
    'SELECT screenshot_interval_minutes, tracking_start_time, tracking_end_time FROM users WHERE id = ?'
  ).get(sa.id);
  res.json({
    screenshotIntervalMinutes: updated.screenshot_interval_minutes,
    trackingStartTime: updated.tracking_start_time,
    trackingEndTime: updated.tracking_end_time,
  });
}));

// Org-wide employee transfer — unlike a manager's own team-transfer route,
// the super admin can move any employee to any manager, not just within
// their own team. Same restriction as the manager-only version though: only
// valid for a legacy employee whose parent_id already points straight at a
// manager — a properly-nested one should move via the Assistant Manager/Team
// Lead picker in their Employee Management edit form instead (see /tls and
// /users/:id/reassign below), which enforces the fixed-level chain.
superadminRouter.post('/employees/:id/transfer', requireSuperAdmin, ah(async (req, res) => {
  const { targetManagerId } = req.body;
  if (!targetManagerId) return res.status(400).json({ error: 'targetManagerId required' });

  const employee = await db.prepare("SELECT * FROM users WHERE id = ? AND role = 'employee'").get(req.params.id);
  if (!employee) return res.status(404).json({ error: 'employee not found' });
  const currentParent = await db.prepare('SELECT role FROM users WHERE id = ?').get(employee.parent_id);
  if (currentParent?.role !== 'manager') {
    return res.status(400).json({ error: 'this employee reports through an AM/TL — use the Assistant Manager/Team Lead picker in their Employee Management edit form to move them instead' });
  }

  const targetManager = await db.prepare("SELECT * FROM users WHERE id = ? AND role = 'manager'").get(targetManagerId);
  if (!targetManager) return res.status(404).json({ error: 'target manager not found' });

  await db.prepare('UPDATE users SET parent_id = ? WHERE id = ?').run(targetManager.id, employee.id);
  res.json({ ok: true, employeeId: employee.id, newManagerId: targetManager.id, newManagerName: targetManager.name });
}));

// Every employee org-wide, with their TL/AM resolved via the fixed two-hop
// chain above them (and Manager via getAncestorIdWithRole, since it needs
// to keep working for a legacy employee whose parent_id points straight at
// a manager, skipping AM/TL entirely) — used by the super admin's own
// "Employee Management" tab, which otherwise has no way to see anyone
// nested below AM/TL (see the /overview KNOWN LIMITATION above it).
superadminRouter.get('/employees-full', requireSuperAdmin, ah(async (req, res) => {
  const employees = await db.prepare(`
    SELECT e.id, e.name, e.email, e.mobile, e.department, e.job_role AS "jobRole", e.created_at,
      (e.password_reset_requested_at IS NOT NULL) AS "passwordResetRequested",
      tl.id AS "tlId", tl.name AS "tlName", am.id AS "amId", am.name AS "amName"
    FROM users e
    LEFT JOIN users tl ON tl.id = e.parent_id AND tl.role = 'tl'
    LEFT JOIN users am ON am.id = tl.parent_id AND am.role = 'am'
    WHERE e.role = 'employee'
    ORDER BY e.name
  `).all();
  const withManagers = await Promise.all(employees.map(async (e) => {
    const managerId = await getAncestorIdWithRole(e.id, 'manager');
    const manager = managerId ? await db.prepare('SELECT name FROM users WHERE id = ?').get(managerId) : null;
    return { ...e, managerId, managerName: manager?.name ?? null };
  }));
  res.json(withManagers);
}));

// Every TL in the org, with their AM's name attached — the option list for
// the Employee Management edit form's Assistant Manager/Team Lead
// reassignment picker. The actual move reuses the general /users/:id/reassign
// below (newParentId = the chosen TL's id), which already enforces the
// fixed-level chain and cycle safety for any role, not just employees.
superadminRouter.get('/tls', requireSuperAdmin, ah(async (req, res) => {
  res.json(await listTlsWithManagerInfo());
}));

// Reassigns any one person (and their whole subtree, which moves with them —
// see the manager-only transfer route above for the same reasoning) to a
// new parent anywhere else in the org, as long as the new parent's role is
// exactly the one role above this person's — the fixed-level invariant the
// whole hierarchy depends on (see hierarchy.js's ROLE_ORDER) still has to
// hold after an arbitrary-level move, not just at invite time. One
// deliberate exception: a Team Lead's "one role above" is normally an
// Assistant Manager, but a TL can also be moved straight under a Manager
// with no AM in between — the same shape adoptOrphansIntoDepartment creates
// automatically, needed because a real department can exist with TLs/
// employees but no AM at all (see the Admins-panel TL transfer form).
superadminRouter.post('/users/:id/reassign', requireSuperAdmin, ah(async (req, res) => {
  if (!('newParentId' in req.body)) return res.status(400).json({ error: 'newParentId required' });
  const { newParentId } = req.body;

  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'user not found' });
  if (user.role === 'superadmin') return res.status(400).json({ error: "can't reassign the super admin" });

  // Explicit null detaches entirely (parent_id -> NULL), matching the
  // "no manager"/"no assistant manager" option the Admins panel's edit
  // form offers for AM/TL — the only two roles that can ever be created
  // without a superior in the first place (see register-admin), so
  // they're the only ones this generic endpoint allows detaching. Manager
  // always auto-reports to the one AGM (never a picker, never optional)
  // and GM/AGM/employee aren't reassignable through this route at all
  // from any caller today, so leaving them out here too avoids ever
  // creating an orphan this app has no UI to reattach.
  if (newParentId === null) {
    if (!['am', 'tl'].includes(user.role)) {
      return res.status(400).json({ error: `a ${user.role} can't be detached this way` });
    }
    if (user.parent_id === null) return res.status(400).json({ error: 'already has no manager' });
    await db.prepare('UPDATE users SET parent_id = NULL WHERE id = ?').run(user.id);
    return res.json({ ok: true, userId: user.id, newParentId: null, newParentName: null });
  }
  if (!newParentId) return res.status(400).json({ error: 'newParentId required' });
  if (Number(newParentId) === user.parent_id) return res.status(400).json({ error: 'already reports there' });

  const newParent = await db.prepare('SELECT * FROM users WHERE id = ?').get(newParentId);
  if (!newParent) return res.status(404).json({ error: 'new parent not found' });
  const parentRoleOk = user.role === 'tl'
    ? ['am', 'manager'].includes(newParent.role)
    : newParent.role === roleAbove(user.role);
  if (!parentRoleOk) {
    const expected = user.role === 'tl' ? 'am or manager' : roleAbove(user.role);
    return res.status(400).json({ error: `new parent must be a ${expected}` });
  }
  const descendantIds = await getDescendantIds(user.id);
  if (newParent.id === user.id || descendantIds.includes(newParent.id)) {
    return res.status(400).json({ error: "can't reassign someone under their own report" });
  }

  await db.prepare('UPDATE users SET parent_id = ? WHERE id = ?').run(newParent.id, user.id);
  res.json({ ok: true, userId: user.id, newParentId: newParent.id, newParentName: newParent.name });
}));

// Every department org-wide (one per Manager), each with their AMs and each
// AM's TLs nested — the org-wide version of buildDepartment (see
// hierarchy.js), replacing the old "pick an admin by name" first level of
// the Overview tab (which only ever showed a Manager's *direct* employees —
// invisible to anything nested under AM/TL, see the /overview endpoint
// below's own KNOWN LIMITATION note).
superadminRouter.get('/departments', requireSuperAdmin, ah(async (req, res) => {
  const managers = await db.prepare(
    "SELECT id, name, email, mobile, department, job_role AS \"jobRole\" FROM users WHERE role = 'manager' ORDER BY name"
  ).all();
  const departments = await Promise.all(managers.map(buildDepartment));
  departments.push(...(await buildUnassignedDepartments()));
  res.json(departments);
}));

// Every account created org-wide, any role, newest first — the super
// admin's visibility into every self-registration (see auth.js's
// register-admin) at any level, GM down through TL. An employee's own TL
// sees their new employee too, but that's just the existing team/employee
// list picking them up automatically, not a separate notification.
superadminRouter.get('/recent-registrations', requireSuperAdmin, ah(async (req, res) => {
  const rows = await db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.department, u.created_at, p.name AS "reportsTo"
    FROM users u LEFT JOIN users p ON p.id = u.parent_id
    WHERE u.role != 'superadmin'
    ORDER BY u.created_at DESC LIMIT 50
  `).all();
  res.json(rows);
}));

// Every pending "Forgot password?" request in the org, any role — by
// design, the super admin is always one of the people notified regardless
// of who clicked it (a GM/AGM/Manager/AM/TL's own supervisor already sees
// their request in their own Team & Invite tab; an employee's TL likewise
// sees theirs there — this is what makes the super admin see all of them
// too, as a backstop, rather than only the two-level slice /overview shows).
superadminRouter.get('/password-reset-requests', requireSuperAdmin, ah(async (req, res) => {
  const rows = await db.prepare(`
    SELECT u.id, u.name, u.email, u.role, p.name AS "reportsTo"
    FROM users u LEFT JOIN users p ON p.id = u.parent_id
    WHERE u.role != 'superadmin' AND u.password_reset_requested_at IS NOT NULL
    ORDER BY u.role, u.name
  `).all();
  res.json(rows);
}));

// Sets a new password for any one account in the org, any role — the super
// admin's fulfillment side of the request list above, generalizing the
// manager-only /managers/:id/change-password to work for GM/AGM/AM/TL and
// employee accounts too.
superadminRouter.post('/users/:id/set-password', requireSuperAdmin, ah(async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'a password of at least 8 characters is required' });
  }
  const user = await db.prepare("SELECT * FROM users WHERE id = ? AND role != 'superadmin'").get(req.params.id);
  if (!user) return res.status(404).json({ error: 'user not found' });

  await db.prepare('UPDATE users SET password_hash = ?, password_reset_requested_at = NULL WHERE id = ?')
    .run(hashPassword(password), user.id);
  res.json({ ok: true });
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
  // A manager's employees are never direct children in the current
  // hierarchy (every employee joins through a TL, which reports to an AM,
  // which reports to the manager) — this used to filter on
  // parent_id = manager.id directly, which no real employee has ever
  // matched since Stage 2's TL-invite rework, silently making every
  // consumer of admins[].employees (this Transfer section, the
  // Timeline/Screenshots employee picker, project task-assignee names)
  // show nothing. Walking the fixed TL->AM->manager chain instead is the
  // same two-hop join already used by /employees-full.
  const employeesByManager = await db.prepare(`
    SELECT e.id, e.name, e.email, e.mobile, e.department, e.job_role AS "jobRole", mgr.id AS "managerId"
    FROM users e
    JOIN users tl ON tl.id = e.parent_id AND tl.role = 'tl'
    JOIN users am ON am.id = tl.parent_id AND am.role = 'am'
    JOIN users mgr ON mgr.id = am.parent_id AND mgr.role = 'manager'
    WHERE e.role = 'employee'
    ORDER BY e.name
  `).all();
  const admins = managers.map((m) => {
    const employees = employeesByManager.filter((e) => e.managerId === m.id).map(({ managerId, ...rest }) => rest);
    return {
      id: m.id, name: m.name, email: m.email, mobile: m.mobile, department: m.department, jobRole: m.jobRole,
      passwordResetRequested: m.passwordResetRequested, createdAt: m.created_at, employeeCount: employees.length, employees,
    };
  });
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
