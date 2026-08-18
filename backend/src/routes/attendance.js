import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, authorizeScopedQuery } from '../auth.js';

export const attendanceRouter = Router();

attendanceRouter.get('/status', requireAuth, (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  if (!authorizeScopedQuery(req, res)) return;
  const open = db.prepare(`
    SELECT * FROM attendance_records WHERE user_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1
  `).get(userId);
  res.json({ clockedIn: !!open, record: open ?? null });
});

attendanceRouter.post('/clock-in', requireAuth, (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  if (Number(userId) !== req.authUser.id) return res.status(403).json({ error: 'can only clock yourself in' });
  const open = db.prepare('SELECT * FROM attendance_records WHERE user_id = ? AND clock_out IS NULL').get(userId);
  if (open) return res.status(409).json({ error: 'already clocked in' });

  const info = db.prepare(`
    INSERT INTO attendance_records (user_id, clock_in) VALUES (?, ?)
  `).run(userId, new Date().toISOString());
  res.json(db.prepare('SELECT * FROM attendance_records WHERE id = ?').get(info.lastInsertRowid));
});

attendanceRouter.post('/clock-out', requireAuth, (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  if (Number(userId) !== req.authUser.id) return res.status(403).json({ error: 'can only clock yourself out' });
  const open = db.prepare('SELECT * FROM attendance_records WHERE user_id = ? AND clock_out IS NULL').get(userId);
  if (!open) return res.status(409).json({ error: 'not clocked in' });

  db.prepare('UPDATE attendance_records SET clock_out = ? WHERE id = ?').run(new Date().toISOString(), open.id);
  res.json(db.prepare('SELECT * FROM attendance_records WHERE id = ?').get(open.id));
});

attendanceRouter.get('/', requireAuth, (req, res) => {
  const { userId, managerId, date } = req.query;
  if (!userId && !managerId) return res.status(400).json({ error: 'userId or managerId required' });
  if (!authorizeScopedQuery(req, res)) return;

  if (userId) {
    const records = db.prepare(`
      SELECT * FROM attendance_records WHERE user_id = ? ORDER BY clock_in DESC LIMIT 30
    `).all(userId);
    return res.json(records);
  }

  const day = date || new Date().toISOString().slice(0, 10);
  const records = db.prepare(`
    SELECT a.*, u.name AS user_name
    FROM attendance_records a
    JOIN users u ON u.id = a.user_id
    WHERE u.manager_id = ? AND a.clock_in >= ? AND a.clock_in < ?
    ORDER BY a.clock_in DESC
  `).all(managerId, `${day}T00:00:00.000Z`, `${day}T23:59:59.999Z`);
  res.json(records);
});
