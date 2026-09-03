import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, authorizeScopedQuery } from '../auth.js';
import { ah } from '../asyncHandler.js';

export const timeEntriesRouter = Router();

timeEntriesRouter.get('/', requireAuth, ah(async (req, res) => {
  const { userId, managerId } = req.query;
  if (!userId && !managerId) return res.status(400).json({ error: 'userId or managerId required' });
  if (!(await authorizeScopedQuery(req, res))) return;

  let sql = `
    SELECT te.*, u.name AS user_name, p.name AS project_name, t.title AS task_title
    FROM time_entries te
    JOIN users u ON u.id = te.user_id
    JOIN projects p ON p.id = te.project_id
    LEFT JOIN tasks t ON t.id = te.task_id
    WHERE 1=1
  `;
  const params = [];
  if (userId) { sql += ' AND te.user_id = ?'; params.push(userId); }
  if (managerId) { sql += ' AND p.manager_id = ?'; params.push(managerId); }
  sql += ' ORDER BY te.started_at DESC';
  res.json(await db.prepare(sql).all(...params));
}));

timeEntriesRouter.post('/', requireAuth, ah(async (req, res) => {
  const { userId, projectId, taskId, startedAt, endedAt, note } = req.body;
  if (!userId || !projectId || !startedAt || !endedAt) {
    return res.status(400).json({ error: 'userId, projectId, startedAt, endedAt required' });
  }
  if (Number(userId) !== req.authUser.id) return res.status(403).json({ error: 'can only log your own time' });
  if (new Date(endedAt) <= new Date(startedAt)) {
    return res.status(400).json({ error: 'endedAt must be after startedAt' });
  }

  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const project = await db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!user || !project) return res.status(404).json({ error: 'user or project not found' });
  if (project.manager_id !== user.parent_id) {
    return res.status(403).json({ error: "project does not belong to this employee's manager" });
  }

  const info = await db.prepare(`
    INSERT INTO time_entries (user_id, project_id, task_id, started_at, ended_at, note, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending') RETURNING id
  `).run(userId, projectId, taskId ?? null, startedAt, endedAt, note ?? null);
  res.json(await db.prepare('SELECT * FROM time_entries WHERE id = ?').get(info.lastInsertRowid));
}));

timeEntriesRouter.patch('/:id/review', requireAuth, ah(async (req, res) => {
  const { decision } = req.body;
  if (req.authUser.role !== 'manager') return res.status(403).json({ error: 'manager access required' });
  if (!['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be approved or rejected' });
  }
  const entry = await db.prepare(`
    SELECT te.*, p.manager_id AS project_manager_id FROM time_entries te
    JOIN projects p ON p.id = te.project_id WHERE te.id = ?
  `).get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'time entry not found' });
  if (entry.project_manager_id !== req.authUser.id) return res.status(403).json({ error: 'not your team' });
  if (entry.status !== 'pending') return res.status(409).json({ error: `already ${entry.status}` });

  await db.prepare(`
    UPDATE time_entries SET status = ?, reviewed_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'), reviewed_by = ?
    WHERE id = ?
  `).run(decision, req.authUser.id, req.params.id);

  res.json(await db.prepare('SELECT * FROM time_entries WHERE id = ?').get(req.params.id));
}));
