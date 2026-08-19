import { Router } from 'express';
import { db } from '../db.js';
import { requireSuperAdmin } from '../auth.js';
import { buildOverrideMaps, computeProductivity } from '../productivity.js';

export const superadminRouter = Router();

// Org structure: how many admins, how many employees, and who reports to
// whom. No screenshot/activity data here — that's an employee-monitoring
// concept, not something extended to overseeing admins themselves.
superadminRouter.get('/overview', requireSuperAdmin, (req, res) => {
  const managers = db.prepare("SELECT id, name, created_at FROM users WHERE role = 'manager' ORDER BY name").all();
  const admins = managers.map((m) => {
    const employees = db.prepare(`
      SELECT id, name FROM users WHERE role = 'employee' AND manager_id = ? ORDER BY name
    `).all(m.id);
    return { id: m.id, name: m.name, createdAt: m.created_at, employeeCount: employees.length, employees };
  });
  const totalEmployees = admins.reduce((sum, a) => sum + a.employeeCount, 0);
  res.json({ totalAdmins: admins.length, totalEmployees, admins });
});

// Same shape as a manager's live-status, just across every manager's team at
// once, with managerName attached so the dashboard can show who's who.
const FRESH_WINDOW_MS = 90_000;
function statusFor(latestEvent) {
  if (!latestEvent) return 'offline';
  const ageMs = Date.now() - new Date(latestEvent.ended_at).getTime();
  if (ageMs > FRESH_WINDOW_MS) return 'offline';
  return latestEvent.is_idle ? 'idle' : 'active';
}

superadminRouter.get('/live-status', requireSuperAdmin, (req, res) => {
  const employees = db.prepare(`
    SELECT e.id, e.name, e.manager_id AS managerId, m.name AS managerName
    FROM users e JOIN users m ON m.id = e.manager_id
    WHERE e.role = 'employee'
    ORDER BY m.name, e.name
  `).all();

  const today = new Date().toISOString().slice(0, 10);
  const rulesByManager = new Map();

  const result = employees.map((emp) => {
    const latestEvent = db.prepare(`
      SELECT * FROM activity_events WHERE user_id = ? ORDER BY ended_at DESC LIMIT 1
    `).get(emp.id);

    if (!rulesByManager.has(emp.managerId)) {
      const rules = db.prepare('SELECT * FROM category_rules WHERE manager_id = ?').all(emp.managerId);
      rulesByManager.set(emp.managerId, buildOverrideMaps(rules));
    }
    const overrides = rulesByManager.get(emp.managerId);

    const todaysEvents = db.prepare(`
      SELECT * FROM activity_events
      WHERE user_id = ? AND started_at >= ? AND started_at < ?
      ORDER BY started_at
    `).all(emp.id, `${today}T00:00:00.000Z`, `${today}T23:59:59.999Z`);
    const productivity = computeProductivity(todaysEvents, overrides);

    return {
      id: emp.id,
      name: emp.name,
      managerId: emp.managerId,
      managerName: emp.managerName,
      status: statusFor(latestEvent),
      currentApp: latestEvent?.app_name ?? null,
      currentDomain: latestEvent?.domain ?? null,
      lastSeenAt: latestEvent?.ended_at ?? null,
      todayScore: productivity.score,
      todayActiveMinutes: Math.round(productivity.totals.productive + productivity.totals.neutral + productivity.totals.unproductive + productivity.totals.engaged),
    };
  });

  res.json(result);
});
