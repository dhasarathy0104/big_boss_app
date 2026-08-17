import { Router } from 'express';
import { db } from '../db.js';

export const leaveRequestsRouter = Router();

const LEAVE_TYPES = ['sick', 'vacation', 'personal', 'other'];

leaveRequestsRouter.get('/', (req, res) => {
  const { userId, managerId } = req.query;
  if (!userId && !managerId) return res.status(400).json({ error: 'userId or managerId required' });

  if (userId) {
    return res.json(db.prepare(`
      SELECT * FROM leave_requests WHERE user_id = ? ORDER BY created_at DESC
    `).all(userId));
  }

  const requests = db.prepare(`
    SELECT l.*, u.name AS user_name
    FROM leave_requests l
    JOIN users u ON u.id = l.user_id
    WHERE u.manager_id = ?
    ORDER BY l.created_at DESC
  `).all(managerId);
  res.json(requests);
});

leaveRequestsRouter.post('/', (req, res) => {
  const { userId, leaveType, startDate, endDate, reason } = req.body;
  if (!userId || !LEAVE_TYPES.includes(leaveType) || !startDate || !endDate) {
    return res.status(400).json({ error: `userId, leaveType (one of ${LEAVE_TYPES.join(', ')}), startDate, endDate required` });
  }
  if (endDate < startDate) return res.status(400).json({ error: 'endDate must be on or after startDate' });

  const info = db.prepare(`
    INSERT INTO leave_requests (user_id, leave_type, start_date, end_date, reason, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `).run(userId, leaveType, startDate, endDate, reason ?? null);
  res.json(db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(info.lastInsertRowid));
});

leaveRequestsRouter.patch('/:id/review', (req, res) => {
  const { decision, reviewerUserId } = req.body;
  if (!['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be approved or rejected' });
  }
  const request = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'leave request not found' });
  if (request.status !== 'pending') return res.status(409).json({ error: `already ${request.status}` });

  db.prepare(`
    UPDATE leave_requests SET status = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?
  `).run(decision, new Date().toISOString(), reviewerUserId ?? null, req.params.id);

  res.json(db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(req.params.id));
});
