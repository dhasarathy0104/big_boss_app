import { Router } from 'express';
import { db } from '../db.js';
import { buildOverrideMaps, computeProductivity } from '../productivity.js';
import { requireSupervisor } from '../auth.js';
import { getDescendantIds, getAncestorIdWithRole } from '../hierarchy.js';
import { ah } from '../asyncHandler.js';

export const liveStatusRouter = Router();

// A generous freshness window: the agent only flushes every 30s, so "most recent
// event" can lag reality by up to ~40s even while someone is actively working.
const FRESH_WINDOW_MS = 90_000;

function statusFor(latestEvent) {
  if (!latestEvent) return 'offline';
  const ageMs = Date.now() - new Date(latestEvent.ended_at).getTime();
  if (ageMs > FRESH_WINDOW_MS) return 'offline';
  return latestEvent.is_idle ? 'idle' : 'active';
}

liveStatusRouter.get('/:managerId/live-status', requireSupervisor, ah(async (req, res) => {
  if (Number(req.params.managerId) !== req.authUser.id) return res.status(403).json({ error: 'not your team' });

  // "Team" is now everyone anywhere below this person in the reporting
  // chain, not just direct reports — a GM's team includes every AGM's,
  // Manager's, AM's, and TL's employees several levels down.
  const descendantIds = await getDescendantIds(req.authUser.id);
  const team = descendantIds.length === 0 ? [] : await db.prepare(`
    SELECT id, name, email, mobile, department, job_role AS "jobRole"
    FROM users WHERE id = ANY(?) AND role = 'employee' ORDER BY name
  `).all(descendantIds);
  if (team.length === 0) return res.json([]);

  const ids = team.map((m) => m.id);

  // Category rules belong to whichever department Manager owns each
  // employee, and a supervisor above Manager level (AGM, GM) can span
  // several departments at once — resolve and cache per-manager overrides
  // rather than assuming one shared set for the whole team.
  const overridesByManager = new Map();
  const overridesForEmployee = new Map();
  for (const member of team) {
    const managerId = await getAncestorIdWithRole(member.id, 'manager');
    if (!managerId) { overridesForEmployee.set(member.id, buildOverrideMaps([])); continue; }
    if (!overridesByManager.has(managerId)) {
      const rules = await db.prepare('SELECT * FROM category_rules WHERE manager_id = ?').all(managerId);
      overridesByManager.set(managerId, buildOverrideMaps(rules));
    }
    overridesForEmployee.set(member.id, overridesByManager.get(managerId));
  }
  const today = new Date().toISOString().slice(0, 10);

  // Two queries for the whole team instead of two per member — at team
  // sizes in the hundreds, the old per-member Promise.all() loop fired
  // hundreds of small round trips every 15s (once per open Live tab),
  // which queues up behind the connection pool under real load.
  const [latestEvents, todaysEvents] = await Promise.all([
    db.prepare(`
      SELECT DISTINCT ON (user_id) * FROM activity_events
      WHERE user_id = ANY(?) ORDER BY user_id, ended_at DESC
    `).all(ids),
    db.prepare(`
      SELECT * FROM activity_events
      WHERE user_id = ANY(?) AND started_at >= ? AND started_at < ?
      ORDER BY user_id, started_at
    `).all(ids, `${today}T00:00:00.000Z`, `${today}T23:59:59.999Z`),
  ]);

  const latestByUser = new Map(latestEvents.map((e) => [e.user_id, e]));
  const eventsByUser = new Map();
  for (const e of todaysEvents) {
    if (!eventsByUser.has(e.user_id)) eventsByUser.set(e.user_id, []);
    eventsByUser.get(e.user_id).push(e);
  }

  const result = team.map((member) => {
    const latestEvent = latestByUser.get(member.id);
    const productivity = computeProductivity(eventsByUser.get(member.id) ?? [], overridesForEmployee.get(member.id));

    return {
      id: member.id,
      name: member.name,
      email: member.email,
      mobile: member.mobile,
      department: member.department,
      jobRole: member.jobRole,
      status: statusFor(latestEvent),
      currentApp: latestEvent?.app_name ?? null,
      currentDomain: latestEvent?.domain ?? null,
      lastSeenAt: latestEvent?.ended_at ?? null,
      todayScore: productivity.score,
      todayActiveMinutes: Math.round(productivity.totals.productive + productivity.totals.neutral + productivity.totals.unproductive + productivity.totals.engaged),
    };
  });

  res.json(result);
}));
