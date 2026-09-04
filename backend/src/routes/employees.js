import { Router } from 'express';
import { db } from '../db.js';
import { requireSupervisor } from '../auth.js';
import { getDescendantIds } from '../hierarchy.js';
import { ah } from '../asyncHandler.js';

export const employeesRouter = Router();

// Any supervisor tier's own subtree of employees, for internal lookups (e.g.
// project assignee pickers) — generalized from Manager-only/direct-report-only
// to the full hierarchy, since a GM/AGM/AM/TL's employees are no longer
// necessarily their direct reports (see hierarchy.js's getDescendantIds).
employeesRouter.get('/', requireSupervisor, ah(async (req, res) => {
  const descendantIds = await getDescendantIds(req.authUser.id);
  if (descendantIds.length === 0) return res.json([]);
  const employees = await db.prepare(`
    SELECT e.id, e.name, e.parent_id AS "managerId", m.name AS "managerName"
    FROM users e
    LEFT JOIN users m ON m.id = e.parent_id
    WHERE e.role = 'employee' AND e.id = ANY(?)
    ORDER BY e.name
  `).all(descendantIds);
  res.json(employees);
}));
