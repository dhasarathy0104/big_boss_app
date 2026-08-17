import { Router } from 'express';
import { db } from '../db.js';

export const projectsRouter = Router();

// Projects are owned by a manager — only that manager's dashboard should see them.
projectsRouter.get('/', (req, res) => {
  const { managerId } = req.query;
  if (!managerId) return res.status(400).json({ error: 'managerId required' });
  const projects = db.prepare('SELECT * FROM projects WHERE manager_id = ? ORDER BY created_at DESC').all(managerId);
  res.json(projects);
});

projectsRouter.post('/', (req, res) => {
  const { managerId, name, clientName, isBillable, hourlyRate } = req.body;
  if (!managerId || !name?.trim()) return res.status(400).json({ error: 'managerId and name required' });
  const manager = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'manager'").get(managerId);
  if (!manager) return res.status(404).json({ error: 'manager not found' });

  const info = db.prepare(`
    INSERT INTO projects (manager_id, name, client_name, is_billable, hourly_rate)
    VALUES (?, ?, ?, ?, ?)
  `).run(managerId, name.trim(), clientName ?? null, isBillable ? 1 : 0, hourlyRate ?? null);
  res.json(db.prepare('SELECT * FROM projects WHERE id = ?').get(info.lastInsertRowid));
});
