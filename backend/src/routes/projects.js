import { Router } from 'express';
import { db, withTransaction } from '../db.js';
import { requireAuth } from '../auth.js';
import { isManagerInScope, roleAtOrAbove } from '../hierarchy.js';
import { ah } from '../asyncHandler.js';

export const projectsRouter = Router();

// Project lifecycle (create/delete) is deliberately narrower than viewing —
// only Manager-and-above (Manager/AGM/GM/superadmin) can own or remove a
// project; AM/TL explicitly get view/task-management access (see tasks.js)
// but never become the owner, per the hierarchy rework's permission model.
function canOwnProject(authUser) {
  return authUser.role === 'superadmin' || roleAtOrAbove(authUser.role, 'manager');
}

// Department-wide project browsing — deliberately not for employees. An
// employee's own project visibility is tied to their assigned work instead
// (see GET /api/tasks/mine, which already returns each task's project name
// directly), not a browsable list of every project their department has.
projectsRouter.get('/', requireAuth, ah(async (req, res) => {
  const { managerId } = req.query;
  if (!managerId) return res.status(400).json({ error: 'managerId required' });
  if (req.authUser.role === 'employee' || !(await isManagerInScope(req.authUser, Number(managerId)))) {
    return res.status(403).json({ error: 'not your team' });
  }
  const projects = await db.prepare('SELECT * FROM projects WHERE manager_id = ? ORDER BY created_at DESC').all(managerId);
  res.json(projects);
}));

projectsRouter.post('/', requireAuth, ah(async (req, res) => {
  const { managerId, name, clientName, isBillable, hourlyRate } = req.body;
  if (!managerId || !name?.trim()) return res.status(400).json({ error: 'managerId and name required' });
  if (!canOwnProject(req.authUser)) return res.status(403).json({ error: 'manager access required' });

  const targetIsManager = await db.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'manager'").get(managerId);
  if (!targetIsManager) return res.status(400).json({ error: 'managerId must belong to a manager account' });

  // canOwnProject already excluded AM/TL/Employee above, so isManagerInScope
  // here only ever takes its "at-or-above manager" branch: exact self-match
  // for a Manager, descendant-match for GM/AGM, always-true for superadmin.
  if (!(await isManagerInScope(req.authUser, Number(managerId)))) {
    return res.status(403).json({ error: 'that manager is outside your hierarchy' });
  }

  const info = await db.prepare(`
    INSERT INTO projects (manager_id, name, client_name, is_billable, hourly_rate)
    VALUES (?, ?, ?, ?, ?) RETURNING id
  `).run(managerId, name.trim(), clientName ?? null, isBillable ? 1 : 0, hourlyRate ?? null);
  res.json(await db.prepare('SELECT * FROM projects WHERE id = ?').get(info.lastInsertRowid));
}));

// Manager (their own project), GM/AGM (a project owned by a manager in
// their subtree), or super admin (any project) can remove it entirely — its
// tasks, and any time entries logged against it (project_id is required on
// a time entry, so those can't be kept dangling once the project is gone).
// Never AM/TL — see canOwnProject.
projectsRouter.delete('/:id', requireAuth, ah(async (req, res) => {
  const project = await db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'project not found' });

  if (!canOwnProject(req.authUser) || !(await isManagerInScope(req.authUser, project.manager_id))) {
    return res.status(403).json({ error: 'not your project' });
  }

  await withTransaction(async (tx) => {
    await tx.prepare('DELETE FROM time_entries WHERE project_id = ?').run(project.id);
    await tx.prepare('DELETE FROM tasks WHERE project_id = ?').run(project.id);
    await tx.prepare('DELETE FROM project_members WHERE project_id = ?').run(project.id);
    await tx.prepare('DELETE FROM projects WHERE id = ?').run(project.id);
  });
  res.json({ ok: true });
}));
