import { Router } from 'express';
import { db } from '../db.js';
import { requireSupervisor, requireAuth } from '../auth.js';
import { isManagerInScope, getDescendantIds } from '../hierarchy.js';
import { ah } from '../asyncHandler.js';

export const tasksRouter = Router();

const STATUSES = ['todo', 'in_progress', 'review', 'done'];

// Generalized across the whole hierarchy via the project's owning manager:
// true for superadmin, the owning Manager, any GM/AGM with that manager in
// their subtree, or any AM/TL whose own department Manager owns it — see
// hierarchy.js's isManagerInScope for the direction-aware logic (owner can
// sit above or below the caller depending on their tier).
async function canActOnProject(authUser, projectId) {
  const project = await db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) return null;
  return (await isManagerInScope(authUser, project.manager_id)) ? project : null;
}

// A TL's task scope is narrower than the rest of the department: unlike
// AM/Manager/AGM/GM (whole department board), a TL only ever sees/creates/
// touches tasks assigned to their own direct employees — a peer TL's or
// another branch's tasks under the same project are off limits even though
// the project itself is technically "in scope" via canActOnProject. Returns
// null for any role other than 'tl' (nothing to restrict).
async function tlOwnEmployeeIds(authUser) {
  return authUser.role === 'tl' ? await getDescendantIds(authUser.id) : null;
}

tasksRouter.get('/', requireSupervisor, ah(async (req, res) => {
  const { projectId } = req.query;
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  if (!(await canActOnProject(req.authUser, projectId))) return res.status(403).json({ error: 'not your project' });
  const tasks = await db.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY position, id').all(projectId);
  const tlEmployeeIds = await tlOwnEmployeeIds(req.authUser);
  if (tlEmployeeIds) {
    return res.json(tasks.filter((t) => t.assignee_user_id && tlEmployeeIds.includes(t.assignee_user_id)));
  }
  res.json(tasks);
}));

// An employee's own task list, across every project they're assigned to —
// unlike the manager/super-admin route above, this isn't scoped to one
// project, since an employee has no "pick a project" step of their own.
tasksRouter.get('/mine', requireAuth, ah(async (req, res) => {
  const tasks = await db.prepare(`
    SELECT t.*, p.name AS project_name, p.client_name
    FROM tasks t JOIN projects p ON p.id = t.project_id
    WHERE t.assignee_user_id = ?
    ORDER BY t.status, t.position, t.id
  `).all(req.authUser.id);
  res.json(tasks);
}));

tasksRouter.post('/', requireSupervisor, ah(async (req, res) => {
  const { projectId, title, description, assigneeUserId } = req.body;
  if (!projectId || !title?.trim()) return res.status(400).json({ error: 'projectId and title required' });
  if (!(await canActOnProject(req.authUser, projectId))) return res.status(403).json({ error: 'not your project' });

  const tlEmployeeIds = await tlOwnEmployeeIds(req.authUser);
  if (tlEmployeeIds && (!assigneeUserId || !tlEmployeeIds.includes(Number(assigneeUserId)))) {
    return res.status(403).json({ error: 'a team lead can only create tasks assigned to their own employees' });
  }

  const { maxPos } = await db.prepare('SELECT COALESCE(MAX(position), -1) AS "maxPos" FROM tasks WHERE project_id = ?').get(projectId);
  const info = await db.prepare(`
    INSERT INTO tasks (project_id, title, description, assignee_user_id, position)
    VALUES (?, ?, ?, ?, ?) RETURNING id
  `).run(projectId, title.trim(), description ?? null, assigneeUserId ?? null, maxPos + 1);
  res.json(await db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid));
}));

// Manager/super admin can change status, assignee, and position (the full
// Kanban board). An employee can only move their own assigned task's status
// — reporting progress, not reassigning or reordering anyone's work.
tasksRouter.patch('/:id', requireAuth, ah(async (req, res) => {
  const { status, assigneeUserId, position } = req.body;
  if (status !== undefined && !STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of ${STATUSES.join(', ')}` });
  }
  const existing = await db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'task not found' });

  // canActOnProject's isManagerInScope check also matches an employee whose
  // own department project this is (the "ancestor manager" branch doesn't
  // distinguish supervisor tiers from employee) — explicitly excluded here
  // so an employee only ever gets isOwnStatusUpdate below, never full
  // reassign/reposition management of their own task.
  let canManage = req.authUser.role !== 'employee' && await canActOnProject(req.authUser, existing.project_id);
  const tlEmployeeIds = await tlOwnEmployeeIds(req.authUser);
  if (canManage && tlEmployeeIds) {
    // Both the task's current assignee and any new assignee being set must
    // be one of this TL's own employees — otherwise a TL could reach into
    // a peer TL's or another branch's task just because it shares the same
    // department project.
    const currentAssigneeIsOwn = existing.assignee_user_id && tlEmployeeIds.includes(existing.assignee_user_id);
    const newAssigneeIsOwn = assigneeUserId === undefined || tlEmployeeIds.includes(Number(assigneeUserId));
    canManage = currentAssigneeIsOwn && newAssigneeIsOwn;
  }
  const isOwnStatusUpdate = req.authUser.role === 'employee'
    && existing.assignee_user_id === req.authUser.id
    && assigneeUserId === undefined && position === undefined;
  if (!canManage && !isOwnStatusUpdate) return res.status(403).json({ error: 'not authorized for this task' });

  await db.prepare(`
    UPDATE tasks SET
      status = COALESCE(?, status),
      assignee_user_id = COALESCE(?, assignee_user_id),
      position = COALESCE(?, position)
    WHERE id = ?
  `).run(status ?? null, assigneeUserId ?? null, position ?? null, req.params.id);

  res.json(await db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id));
}));

// Manager (own project) or super admin (any project) can delete a task
// outright — e.g. one assigned by mistake, or no longer needed.
tasksRouter.delete('/:id', requireSupervisor, ah(async (req, res) => {
  const existing = await db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'task not found' });
  if (!(await canActOnProject(req.authUser, existing.project_id))) return res.status(403).json({ error: 'not your project' });

  const tlEmployeeIds = await tlOwnEmployeeIds(req.authUser);
  if (tlEmployeeIds && (!existing.assignee_user_id || !tlEmployeeIds.includes(existing.assignee_user_id))) {
    return res.status(403).json({ error: 'a team lead can only delete tasks assigned to their own employees' });
  }

  await db.prepare('UPDATE time_entries SET task_id = NULL WHERE task_id = ?').run(req.params.id);
  await db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));
