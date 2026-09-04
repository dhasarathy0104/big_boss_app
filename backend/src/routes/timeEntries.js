import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, authorizeScopedQuery } from '../auth.js';
import { getDescendantIds, getAncestorIdWithRole, isManagerInScope } from '../hierarchy.js';
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
  if (managerId) {
    // "managerId" is really the requesting supervisor's own id at any tier
    // (see authorizeScopedQuery) — scope to their whole subtree, not just
    // entries against projects they personally own, so a GM/AGM/AM sees
    // entries logged by anyone below them regardless of which department's
    // project it was logged against.
    const descendantIds = await getDescendantIds(Number(managerId));
    if (descendantIds.length === 0) return res.json([]);
    sql += ' AND te.user_id = ANY(?)'; params.push(descendantIds);
  }
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
  // The employee's real department Manager is found by walking up the
  // chain (their direct parent is a TL, not the Manager, in the current
  // hierarchy) — a direct parent_id comparison here would reject every
  // properly-nested employee's own department project.
  const ownManagerId = await getAncestorIdWithRole(user.id, 'manager');
  if (project.manager_id !== ownManagerId) {
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
  if (!['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be approved or rejected' });
  }
  const entry = await db.prepare(`
    SELECT te.*, p.manager_id AS project_manager_id FROM time_entries te
    JOIN projects p ON p.id = te.project_id WHERE te.id = ?
  `).get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'time entry not found' });
  // isManagerInScope's ancestor-branch would also match the employee who
  // logged the entry against their own department's project — explicitly
  // excluded, since an employee must never approve their own (or anyone's)
  // time entry.
  if (req.authUser.role === 'employee' || !(await isManagerInScope(req.authUser, entry.project_manager_id))) {
    return res.status(403).json({ error: 'not your team' });
  }
  if (entry.status !== 'pending') return res.status(409).json({ error: `already ${entry.status}` });

  await db.prepare(`
    UPDATE time_entries SET status = ?, reviewed_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'), reviewed_by = ?
    WHERE id = ?
  `).run(decision, req.authUser.id, req.params.id);

  res.json(await db.prepare('SELECT * FROM time_entries WHERE id = ?').get(req.params.id));
}));
