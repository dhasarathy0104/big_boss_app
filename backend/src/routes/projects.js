import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { ah } from '../asyncHandler.js';

export const projectsRouter = Router();

// Read by both a manager (their own projects) and their employees (to pick a
// project to log time against) — same permission shape as isSelfOrOwnEmployee,
// just checking a managerId instead of a userId.
function canSeeManagersProjects(authUser, managerId) {
  if (authUser.role === 'superadmin') return true;
  if (authUser.role === 'manager') return authUser.id === managerId;
  return authUser.manager_id === managerId;
}

projectsRouter.get('/', requireAuth, ah(async (req, res) => {
  const { managerId } = req.query;
  if (!managerId) return res.status(400).json({ error: 'managerId required' });
  if (!canSeeManagersProjects(req.authUser, Number(managerId))) {
    return res.status(403).json({ error: 'not your team' });
  }
  const projects = await db.prepare('SELECT * FROM projects WHERE manager_id = ? ORDER BY created_at DESC').all(managerId);
  res.json(projects);
}));

projectsRouter.post('/', requireAuth, ah(async (req, res) => {
  const { managerId, name, clientName, isBillable, hourlyRate } = req.body;
  if (!managerId || !name?.trim()) return res.status(400).json({ error: 'managerId and name required' });

  const isOwnProject = req.authUser.role === 'manager' && req.authUser.id === Number(managerId);
  const isSuperAdminAssigning = req.authUser.role === 'superadmin'
    && await db.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'manager'").get(managerId);
  if (!isOwnProject && !isSuperAdminAssigning) {
    return res.status(403).json({ error: 'manager access required' });
  }

  const info = await db.prepare(`
    INSERT INTO projects (manager_id, name, client_name, is_billable, hourly_rate)
    VALUES (?, ?, ?, ?, ?) RETURNING id
  `).run(managerId, name.trim(), clientName ?? null, isBillable ? 1 : 0, hourlyRate ?? null);
  res.json(await db.prepare('SELECT * FROM projects WHERE id = ?').get(info.lastInsertRowid));
}));
