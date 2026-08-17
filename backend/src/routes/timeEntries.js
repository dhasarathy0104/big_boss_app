import { Router } from 'express';
import { db } from '../db.js';

export const timeEntriesRouter = Router();

timeEntriesRouter.get('/', (req, res) => {
  const { userId, managerId } = req.query;
  if (!userId && !managerId) return res.status(400).json({ error: 'userId or managerId required' });

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
  res.json(db.prepare(sql).all(...params));
});

timeEntriesRouter.post('/', (req, res) => {
  const { userId, projectId, taskId, startedAt, endedAt, note } = req.body;
  if (!userId || !projectId || !startedAt || !endedAt) {
    return res.status(400).json({ error: 'userId, projectId, startedAt, endedAt required' });
  }
  if (new Date(endedAt) <= new Date(startedAt)) {
    return res.status(400).json({ error: 'endedAt must be after startedAt' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!user || !project) return res.status(404).json({ error: 'user or project not found' });
  if (project.manager_id !== user.manager_id) {
    return res.status(403).json({ error: "project does not belong to this employee's manager" });
  }

  const info = db.prepare(`
    INSERT INTO time_entries (user_id, project_id, task_id, started_at, ended_at, note, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `).run(userId, projectId, taskId ?? null, startedAt, endedAt, note ?? null);
  res.json(db.prepare('SELECT * FROM time_entries WHERE id = ?').get(info.lastInsertRowid));
});

timeEntriesRouter.patch('/:id/review', (req, res) => {
  const { decision, reviewerUserId } = req.body;
  if (!['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be approved or rejected' });
  }
  const entry = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'time entry not found' });
  if (entry.status !== 'pending') return res.status(409).json({ error: `already ${entry.status}` });

  db.prepare(`
    UPDATE time_entries SET status = ?, reviewed_at = datetime('now'), reviewed_by = ?
    WHERE id = ?
  `).run(decision, reviewerUserId ?? null, req.params.id);

  res.json(db.prepare('SELECT * FROM time_entries WHERE id = ?').get(req.params.id));
});
