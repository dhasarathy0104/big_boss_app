import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, authorizeScopedQuery } from '../auth.js';
import { ah } from '../asyncHandler.js';

export const leaveRequestsRouter = Router();

const LEAVE_TYPES = ['sick', 'vacation', 'personal', 'other'];

leaveRequestsRouter.get('/', requireAuth, ah(async (req, res) => {
  const { userId, managerId } = req.query;
  if (!userId && !managerId) return res.status(400).json({ error: 'userId or managerId required' });
  if (!(await authorizeScopedQuery(req, res))) return;

  if (userId) {
    return res.json(await db.prepare(`
      SELECT * FROM leave_requests WHERE user_id = ? ORDER BY created_at DESC
    `).all(userId));
  }

  const requests = await db.prepare(`
    SELECT l.*, u.name AS user_name
    FROM leave_requests l
    JOIN users u ON u.id = l.user_id
    WHERE u.manager_id = ?
    ORDER BY l.created_at DESC
  `).all(managerId);
  res.json(requests);
}));

leaveRequestsRouter.post('/', requireAuth, ah(async (req, res) => {
  const { userId, leaveType, startDate, endDate, reason } = req.body;
  if (!userId || !LEAVE_TYPES.includes(leaveType) || !startDate || !endDate) {
    return res.status(400).json({ error: `userId, leaveType (one of ${LEAVE_TYPES.join(', ')}), startDate, endDate required` });
  }
  if (Number(userId) !== req.authUser.id) return res.status(403).json({ error: 'can only request leave for yourself' });
  if (endDate < startDate) return res.status(400).json({ error: 'endDate must be on or after startDate' });

  const info = await db.prepare(`
    INSERT INTO leave_requests (user_id, leave_type, start_date, end_date, reason, status)
    VALUES (?, ?, ?, ?, ?, 'pending') RETURNING id
  `).run(userId, leaveType, startDate, endDate, reason ?? null);
  res.json(await db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(info.lastInsertRowid));
}));

leaveRequestsRouter.patch('/:id/review', requireAuth, ah(async (req, res) => {
  const { decision } = req.body;
  if (req.authUser.role !== 'manager') return res.status(403).json({ error: 'manager access required' });
  if (!['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be approved or rejected' });
  }
  const request = await db.prepare(`
    SELECT l.*, u.manager_id AS employee_manager_id FROM leave_requests l
    JOIN users u ON u.id = l.user_id WHERE l.id = ?
  `).get(req.params.id);
  if (!request) return res.status(404).json({ error: 'leave request not found' });
  if (request.employee_manager_id !== req.authUser.id) return res.status(403).json({ error: 'not your team' });
  if (request.status !== 'pending') return res.status(409).json({ error: `already ${request.status}` });

  await db.prepare(`
    UPDATE leave_requests SET status = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?
  `).run(decision, new Date().toISOString(), req.authUser.id, req.params.id);

  res.json(await db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(req.params.id));
}));
