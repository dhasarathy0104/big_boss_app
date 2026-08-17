import { Router } from 'express';
import { db } from '../db.js';

// Used by the dashboard's employee identity switcher — not real auth,
// just a way to pick "who am I" among existing employees for this prototype.
export const employeesRouter = Router();

employeesRouter.get('/', (req, res) => {
  const employees = db.prepare(`
    SELECT e.id, e.name, e.manager_id AS managerId, m.name AS managerName
    FROM users e
    LEFT JOIN users m ON m.id = e.manager_id
    WHERE e.role = 'employee'
    ORDER BY e.name
  `).all();
  res.json(employees);
});
