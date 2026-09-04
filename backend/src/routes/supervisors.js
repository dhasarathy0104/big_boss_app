import { Router } from 'express';
import { db, randomToken } from '../db.js';
import { requireSupervisorSelf, hashPassword } from '../auth.js';
import { getDescendantIds, getAncestorIdWithRole, roleBelow, buildDepartment } from '../hierarchy.js';
import { isValidHHMMOrEmpty } from '../trackingWindow.js';
import { deleteEmployeeCascade } from '../deleteUser.js';
import { ah } from '../asyncHandler.js';

// Generalized invite management for any level above Employee (GM, AGM,
// Manager, AM, TL) — the same idea as the original manager-only invite
// links in routes/managers.js, just not restricted to one specific role.
// One rule everywhere: you can only invite the role directly below you
// (see hierarchy.js's roleBelow) — which role that actually is gets
// resolved when the link is used (see invites.js's public preview and
// auth.js's claim-invite), not stored on the link itself.
export const supervisorsRouter = Router();

supervisorsRouter.get('/:id/invites', requireSupervisorSelf, ah(async (req, res) => {
  const invites = await db.prepare(`
    SELECT * FROM invite_links WHERE inviter_id = ? AND revoked = 0 ORDER BY created_at DESC
  `).all(req.params.id);
  res.json(invites);
}));

supervisorsRouter.post('/:id/invites', requireSupervisorSelf, ah(async (req, res) => {
  const token = randomToken(12);
  await db.prepare('INSERT INTO invite_links (token, inviter_id) VALUES (?, ?)').run(token, req.params.id);
  res.json(await db.prepare('SELECT * FROM invite_links WHERE token = ?').get(token));
}));

supervisorsRouter.post('/:id/invites/:inviteId/revoke', requireSupervisorSelf, ah(async (req, res) => {
  await db.prepare('UPDATE invite_links SET revoked = 1 WHERE id = ? AND inviter_id = ?').run(req.params.inviteId, req.params.id);
  res.json({ ok: true });
}));

// Direct reports only — whoever this person invited (or was assigned)
// directly, one level down. Could be any role: a Manager's direct reports
// are typically AMs, a TL's are Employees, and so on depending on how deep
// the org actually uses each level.
supervisorsRouter.get('/:id/team', requireSupervisorSelf, ah(async (req, res) => {
  const team = await db.prepare(`
    SELECT id, name, email, role, mobile, department, job_role AS "jobRole", created_at,
      (password_reset_requested_at IS NOT NULL) AS "passwordResetRequested"
    FROM users WHERE parent_id = ? ORDER BY name
  `).all(req.params.id);
  res.json(team);
}));

// Sets a new password for one direct report, any role — the fulfillment
// side of the generalized forgot-password flow (see routes/auth.js): once
// someone below you flags a reset request, this is what clears it. The
// generalized version of routes/managers.js's employee-only set-password
// and superadmin.js's manager-only change-password.
supervisorsRouter.post('/:id/team/:memberId/set-password', requireSupervisorSelf, ah(async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'a password of at least 8 characters is required' });
  }
  const member = await db.prepare('SELECT * FROM users WHERE id = ? AND parent_id = ?')
    .get(req.params.memberId, req.params.id);
  if (!member) return res.status(404).json({ error: 'not found in your team' });

  await db.prepare('UPDATE users SET password_hash = ?, password_reset_requested_at = NULL WHERE id = ?')
    .run(hashPassword(password), member.id);
  res.json({ ok: true });
}));

// Every Employee anywhere below this person, no matter how many levels
// down — this is the list Timeline/Screenshots pick from, which is a
// different question from "my direct reports" above (an AGM's direct
// reports are Managers, not the Employees several levels further down who
// are the ones actually being monitored).
supervisorsRouter.get('/:id/employees', requireSupervisorSelf, ah(async (req, res) => {
  const descendantIds = await getDescendantIds(Number(req.params.id));
  if (descendantIds.length === 0) return res.json([]);
  const employees = await db.prepare(`
    SELECT id, name, email, mobile, department, job_role AS "jobRole"
    FROM users WHERE id = ANY(?) AND role = 'employee' ORDER BY name
  `).all(descendantIds);
  res.json(employees);
}));

// Every employee anywhere below this supervisor, with full profile detail —
// the generalized version of routes/managers.js's employee-management team
// listing, now available to GM/AGM/Manager/AM/TL, not just Manager. TL/AM
// resolve via a fixed two-hop join (an employee's parent is always a TL,
// whose parent is always an AM, per hierarchy.js's ROLE_ORDER) — the same
// shape managers.js already uses, valid for any supervisor's subtree
// regardless of how deep they sit above it.
supervisorsRouter.get('/:id/employees-full', requireSupervisorSelf, ah(async (req, res) => {
  const descendantIds = await getDescendantIds(Number(req.params.id));
  if (descendantIds.length === 0) return res.json([]);
  const employees = await db.prepare(`
    SELECT e.id, e.name, e.email, e.mobile, e.department, e.job_role AS "jobRole", e.created_at,
      (e.claim_token IS NOT NULL) AS "hasPendingClaim", (e.password_hash IS NOT NULL) AS "hasDashboardLogin",
      (e.password_reset_requested_at IS NOT NULL) AS "passwordResetRequested",
      tl.id AS "tlId", tl.name AS "tlName", am.id AS "amId", am.name AS "amName"
    FROM users e
    LEFT JOIN users tl ON tl.id = e.parent_id AND tl.role = 'tl'
    LEFT JOIN users am ON am.id = tl.parent_id AND am.role = 'am'
    WHERE e.id = ANY(?) AND e.role = 'employee' ORDER BY e.name
  `).all(descendantIds);
  const withManagers = await Promise.all(employees.map(async (e) => {
    const managerId = await getAncestorIdWithRole(e.id, 'manager');
    const manager = managerId ? await db.prepare('SELECT name FROM users WHERE id = ?').get(managerId) : null;
    return { ...e, managerId, managerName: manager?.name ?? null };
  }));
  res.json(withManagers);
}));

// Edits one employee's profile (and optionally password) anywhere in this
// supervisor's subtree — the generalized version of routes/managers.js's
// PATCH .../team/:employeeId. Scoped by getDescendantIds instead of direct
// parent_id, since a GM/AGM/AM/TL's employees are rarely their direct
// reports.
supervisorsRouter.patch('/:id/employees/:employeeId', requireSupervisorSelf, ah(async (req, res) => {
  const descendantIds = await getDescendantIds(Number(req.params.id));
  const employee = descendantIds.includes(Number(req.params.employeeId))
    ? await db.prepare("SELECT * FROM users WHERE id = ? AND role = 'employee'").get(req.params.employeeId)
    : null;
  if (!employee) return res.status(404).json({ error: 'employee not found in your team' });

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

// Permanently removes an employee anywhere in this supervisor's subtree and
// all their tracked data — the generalized version of routes/managers.js's
// DELETE .../team/:employeeId, reusing the same cascade helper.
supervisorsRouter.delete('/:id/employees/:employeeId', requireSupervisorSelf, ah(async (req, res) => {
  const descendantIds = await getDescendantIds(Number(req.params.id));
  const employee = descendantIds.includes(Number(req.params.employeeId))
    ? await db.prepare("SELECT * FROM users WHERE id = ? AND role = 'employee'").get(req.params.employeeId)
    : null;
  if (!employee) return res.status(404).json({ error: 'employee not found in your team' });

  await deleteEmployeeCascade(employee.id);
  res.json({ ok: true });
}));

// Screenshot interval / tracking hours — the generalized version of
// routes/managers.js's settings endpoints, usable by any supervisor tier
// for the people directly below them (see server.js's agent-settings/
// ingest routes, which read whichever direct parent's row this affects).
supervisorsRouter.get('/:id/settings', requireSupervisorSelf, ah(async (req, res) => {
  const user = await db.prepare(
    'SELECT screenshot_interval_minutes, tracking_start_time, tracking_end_time FROM users WHERE id = ?'
  ).get(req.params.id);
  res.json({
    screenshotIntervalMinutes: user.screenshot_interval_minutes,
    trackingStartTime: user.tracking_start_time,
    trackingEndTime: user.tracking_end_time,
  });
}));

supervisorsRouter.patch('/:id/settings', requireSupervisorSelf, ah(async (req, res) => {
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

  const updated = await db.prepare(
    'SELECT screenshot_interval_minutes, tracking_start_time, tracking_end_time FROM users WHERE id = ?'
  ).get(req.params.id);
  res.json({
    screenshotIntervalMinutes: updated.screenshot_interval_minutes,
    trackingStartTime: updated.tracking_start_time,
    trackingEndTime: updated.tracking_end_time,
  });
}));

// What role this person is allowed to invite, so the dashboard can label
// the invite link correctly ("Invite an AM") without hardcoding the chain
// client-side.
supervisorsRouter.get('/:id/invite-role', requireSupervisorSelf, ah(async (req, res) => {
  const user = await db.prepare('SELECT role FROM users WHERE id = ?').get(req.params.id);
  res.json({ role: roleBelow(user?.role) });
}));

// Which Manager-owned department(s) this supervisor can reach, for wiring
// up the existing Manager-scoped views (ProjectsView/CategoriesView/
// BillingView all take a single managerId) without a second copy of them.
// AM/TL only ever have one department (their own ancestor Manager); GM/AGM
// can span several, so the frontend shows a picker built from this list —
// never a client-guessed id, since every managerId it returns is already
// confirmed to be in this supervisor's own subtree.
supervisorsRouter.get('/:id/managers-in-scope', requireSupervisorSelf, ah(async (req, res) => {
  const user = await db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(req.params.id);
  if (user.role === 'manager') {
    return res.json([{ id: user.id, name: user.name }]);
  }
  if (user.role === 'am' || user.role === 'tl') {
    const managerId = await getAncestorIdWithRole(user.id, 'manager');
    if (!managerId) return res.json([]);
    const manager = await db.prepare('SELECT id, name FROM users WHERE id = ?').get(managerId);
    return res.json(manager ? [manager] : []);
  }
  // gm / agm: every Manager anywhere in their subtree.
  const descendantIds = await getDescendantIds(user.id);
  if (descendantIds.length === 0) return res.json([]);
  const managers = await db.prepare("SELECT id, name FROM users WHERE id = ANY(?) AND role = 'manager' ORDER BY name").all(descendantIds);
  res.json(managers);
}));

// Other accounts at this same level, to pick a transfer destination from —
// the generalized version of routes/managers.js's manager-only
// /other-managers, usable at any tier (a TL sees other TLs, a GM sees other
// GMs, and so on).
supervisorsRouter.get('/:id/peers', requireSupervisorSelf, ah(async (req, res) => {
  const user = await db.prepare('SELECT role FROM users WHERE id = ?').get(req.params.id);
  const peers = await db.prepare('SELECT id, name FROM users WHERE role = ? AND id != ? ORDER BY name')
    .all(user.role, req.params.id);
  res.json(peers);
}));

// Moves one direct report to a different same-tier peer — the generalized
// version of routes/managers.js's employee-only team transfer, usable by any
// supervisor for whoever reports directly to them. Their whole subtree moves
// with them, same reasoning as the manager-only version: parent_id is the
// one source of truth for whose team someone's on.
supervisorsRouter.post('/:id/team/:memberId/transfer', requireSupervisorSelf, ah(async (req, res) => {
  const { targetParentId } = req.body;
  if (!targetParentId) return res.status(400).json({ error: 'targetParentId required' });
  if (Number(targetParentId) === Number(req.params.id)) {
    return res.status(400).json({ error: 'already on your team' });
  }

  const me = await db.prepare('SELECT role FROM users WHERE id = ?').get(req.params.id);
  const member = await db.prepare('SELECT * FROM users WHERE id = ? AND parent_id = ?')
    .get(req.params.memberId, req.params.id);
  if (!member) return res.status(404).json({ error: 'not found in your team' });

  const targetParent = await db.prepare('SELECT * FROM users WHERE id = ? AND role = ?')
    .get(targetParentId, me.role);
  if (!targetParent) return res.status(404).json({ error: 'target not found at your level' });

  await db.prepare('UPDATE users SET parent_id = ? WHERE id = ?').run(targetParent.id, member.id);
  res.json({ ok: true, memberId: member.id, newParentId: targetParent.id, newParentName: targetParent.name });
}));

// Every department within this supervisor's own subtree (one per Manager
// below them) — the GM/AGM read-only dashboard's version of superadmin's
// org-wide /departments, scoped by the same getDescendantIds check every
// other supervisor-scoped route uses. An AM or TL calling this just gets
// their own single department (their subtree only ever contains at most one
// Manager, found via the ancestor walk, not a descendant one).
supervisorsRouter.get('/:id/departments', requireSupervisorSelf, ah(async (req, res) => {
  const user = await db.prepare('SELECT id, role FROM users WHERE id = ?').get(req.params.id);
  let managers;
  if (user.role === 'am' || user.role === 'tl') {
    const managerId = await getAncestorIdWithRole(user.id, 'manager');
    managers = managerId
      ? await db.prepare("SELECT id, name, email, mobile, department, job_role AS \"jobRole\" FROM users WHERE id = ?").all(managerId)
      : [];
  } else {
    const descendantIds = await getDescendantIds(user.id);
    managers = descendantIds.length === 0 ? [] : await db.prepare(
      "SELECT id, name, email, mobile, department, job_role AS \"jobRole\" FROM users WHERE id = ANY(?) AND role = 'manager' ORDER BY name"
    ).all(descendantIds);
  }
  const departments = await Promise.all(managers.map(buildDepartment));
  res.json(departments);
}));

// Profile edit (name/email/mobile/department/title, no password) for any
// Manager/AM/TL within this supervisor's own subtree — the "Manager
// Details" panel's pencil form. No password field on purpose: GM/AGM get
// read/edit visibility into their own departments, not super admin's
// account-security powers (setting anyone's password stays super-admin-only,
// see superadminRouter's /admins/:id and /users/:id/set-password).
supervisorsRouter.patch('/:id/admins/:targetId', requireSupervisorSelf, ah(async (req, res) => {
  const descendantIds = await getDescendantIds(Number(req.params.id));
  const target = descendantIds.includes(Number(req.params.targetId))
    ? await db.prepare("SELECT * FROM users WHERE id = ? AND role IN ('manager', 'am', 'tl')").get(req.params.targetId)
    : null;
  if (!target) return res.status(404).json({ error: 'not found in your scope' });

  const { name, mobile, department, jobRole } = req.body;
  const email = req.body.email !== undefined ? req.body.email.trim().toLowerCase() : undefined;
  if (name !== undefined && !name.trim()) return res.status(400).json({ error: 'name cannot be blank' });
  if (email) {
    const emailTaken = await db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(email, target.id);
    if (emailTaken) return res.status(409).json({ error: 'that email is already registered' });
  }

  const updates = [];
  const values = [];
  if (name !== undefined) { updates.push('name = ?'); values.push(name.trim()); }
  if (email !== undefined) { updates.push('email = ?'); values.push(email || null); }
  if (mobile !== undefined) { updates.push('mobile = ?'); values.push(mobile.trim() || null); }
  if (department !== undefined) { updates.push('department = ?'); values.push(department.trim() || null); }
  if (jobRole !== undefined) { updates.push('job_role = ?'); values.push(jobRole.trim() || null); }
  if (updates.length === 0) return res.status(400).json({ error: 'nothing to update' });

  values.push(target.id);
  await db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  const updated = await db.prepare(`
    SELECT id, name, email, mobile, role, department, job_role AS "jobRole" FROM users WHERE id = ?
  `).get(target.id);
  res.json(updated);
}));

// Every TL in this supervisor's own subtree, with their AM's name attached —
// the option list for the Employee Management edit form's Assistant
// Manager/Team Lead reassignment picker (unlike the peer-transfer above,
// which only moves an employee's direct TL to another TL and only works if
// the caller *is* that TL, this lets any supervisor move an employee
// anywhere in their own subtree to a different TL further down it).
supervisorsRouter.get('/:id/tls-in-scope', requireSupervisorSelf, ah(async (req, res) => {
  const descendantIds = await getDescendantIds(Number(req.params.id));
  if (descendantIds.length === 0) return res.json([]);
  const tls = await db.prepare(`
    SELECT tl.id, tl.name, am.id AS "amId", am.name AS "amName"
    FROM users tl
    LEFT JOIN users am ON am.id = tl.parent_id AND am.role = 'am'
    WHERE tl.id = ANY(?) AND tl.role = 'tl' ORDER BY tl.name
  `).all(descendantIds);
  res.json(tls);
}));

// Reassigns one employee (anywhere in this supervisor's subtree) to a
// different TL — the new TL must also be in this supervisor's own subtree,
// so a Manager/AM/GM/AGM can shuffle an employee between two of their own
// TLs, but never poach one from outside their scope. Org-wide moves (a
// different Manager's branch entirely) stay the super admin's job.
supervisorsRouter.post('/:id/employees/:employeeId/reassign', requireSupervisorSelf, ah(async (req, res) => {
  const { newTlId } = req.body;
  if (!newTlId) return res.status(400).json({ error: 'newTlId required' });

  const descendantIds = await getDescendantIds(Number(req.params.id));
  const employee = descendantIds.includes(Number(req.params.employeeId))
    ? await db.prepare("SELECT * FROM users WHERE id = ? AND role = 'employee'").get(req.params.employeeId)
    : null;
  if (!employee) return res.status(404).json({ error: 'employee not found in your team' });

  const newTl = descendantIds.includes(Number(newTlId))
    ? await db.prepare("SELECT * FROM users WHERE id = ? AND role = 'tl'").get(newTlId)
    : null;
  if (!newTl) return res.status(404).json({ error: 'that team lead is not in your team' });
  if (newTl.id === employee.parent_id) return res.status(400).json({ error: 'employee already reports to that team lead' });

  await db.prepare('UPDATE users SET parent_id = ? WHERE id = ?').run(newTl.id, employee.id);
  res.json({ ok: true, employeeId: employee.id, newTlId: newTl.id, newTlName: newTl.name });
}));
