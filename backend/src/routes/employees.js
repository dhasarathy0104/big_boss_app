import { Router } from 'express';
import { db } from '../db.js';
import { requireManager } from '../auth.js';

export const employeesRouter = Router();

// Manager-only: their own team, for internal lookups (e.g. project assignee pickers).
employeesRouter.get('/', requireManager, (req, res) => {
  const employees = db.prepare(`
    SELECT e.id, e.name, e.manager_id AS managerId, m.name AS managerName
    FROM users e
    LEFT JOIN users m ON m.id = e.manager_id
    WHERE e.role = 'employee' AND e.manager_id = ?
    ORDER BY e.name
  `).all(req.authUser.id);
  res.json(employees);
});
