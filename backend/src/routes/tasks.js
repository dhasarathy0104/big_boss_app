import { Router } from 'express';
import { db } from '../db.js';
import { requireManagerOrSuperAdmin, requireAuth } from '../auth.js';
import { ah } from '../asyncHandler.js';

export const tasksRouter = Router();

const STATUSES = ['todo', 'in_progress', 'review', 'done'];

// A manager must own the project; a super admin can act on any project
// (that's how a project/task gets "assigned to an admin" in the first place).
async function canActOnProject(authUser, projectId) {
  const project = await db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) return null;
  if (authUser.role === 'superadmin') return project;
  return project.manager_id === authUser.id ? project : null;
}

tasksRouter.get('/', requireManagerOrSuperAdmin, ah(async (req, res) => {
  const { projectId } = req.query;
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  if (!(await canActOnProject(req.authUser, projectId))) return res.status(403).json({ error: 'not your project' });
  res.json(await db.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY position, id').all(projectId));
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

tasksRouter.post('/', requireManagerOrSuperAdmin, ah(async (req, res) => {
  const { projectId, title, description, assigneeUserId } = req.body;
  if (!projectId || !title?.trim()) return res.status(400).json({ error: 'projectId and title required' });
  if (!(await canActOnProject(req.authUser, projectId))) return res.status(403).json({ error: 'not your project' });

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

  const isManagerOrSuperAdmin = await canActOnProject(req.authUser, existing.project_id);
  const isOwnStatusUpdate = req.authUser.role === 'employee'
    && existing.assignee_user_id === req.authUser.id
    && assigneeUserId === undefined && position === undefined;
  if (!isManagerOrSuperAdmin && !isOwnStatusUpdate) return res.status(403).json({ error: 'not authorized for this task' });

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
tasksRouter.delete('/:id', requireManagerOrSuperAdmin, ah(async (req, res) => {
  const existing = await db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'task not found' });
  if (!(await canActOnProject(req.authUser, existing.project_id))) return res.status(403).json({ error: 'not your project' });

  await db.prepare('UPDATE time_entries SET task_id = NULL WHERE task_id = ?').run(req.params.id);
  await db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));
