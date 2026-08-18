import { Router } from 'express';
import { db } from '../db.js';
import { requireManager } from '../auth.js';

export const tasksRouter = Router();

const STATUSES = ['todo', 'in_progress', 'review', 'done'];

function ownsProject(authUser, projectId) {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  return project && project.manager_id === authUser.id ? project : null;
}

tasksRouter.get('/', requireManager, (req, res) => {
  const { projectId } = req.query;
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  if (!ownsProject(req.authUser, projectId)) return res.status(403).json({ error: 'not your project' });
  res.json(db.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY position, id').all(projectId));
});

tasksRouter.post('/', requireManager, (req, res) => {
  const { projectId, title, description, assigneeUserId } = req.body;
  if (!projectId || !title?.trim()) return res.status(400).json({ error: 'projectId and title required' });
  if (!ownsProject(req.authUser, projectId)) return res.status(403).json({ error: 'not your project' });

  const { maxPos } = db.prepare('SELECT COALESCE(MAX(position), -1) AS maxPos FROM tasks WHERE project_id = ?').get(projectId);
  const info = db.prepare(`
    INSERT INTO tasks (project_id, title, description, assignee_user_id, position)
    VALUES (?, ?, ?, ?, ?)
  `).run(projectId, title.trim(), description ?? null, assigneeUserId ?? null, maxPos + 1);
  res.json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid));
});

tasksRouter.patch('/:id', requireManager, (req, res) => {
  const { status, assigneeUserId, position } = req.body;
  if (status !== undefined && !STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of ${STATUSES.join(', ')}` });
  }
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'task not found' });
  if (!ownsProject(req.authUser, existing.project_id)) return res.status(403).json({ error: 'not your project' });

  db.prepare(`
    UPDATE tasks SET
      status = COALESCE(?, status),
      assignee_user_id = COALESCE(?, assignee_user_id),
      position = COALESCE(?, position)
    WHERE id = ?
  `).run(status ?? null, assigneeUserId ?? null, position ?? null, req.params.id);

  res.json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id));
});
