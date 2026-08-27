import { Router } from 'express';
import { db } from '../db.js';
import { buildOverrideMaps, computeProductivity } from '../productivity.js';
import { requireManager } from '../auth.js';
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

liveStatusRouter.get('/:managerId/live-status', requireManager, ah(async (req, res) => {
  if (Number(req.params.managerId) !== req.authUser.id) return res.status(403).json({ error: 'not your team' });

  const team = await db.prepare(`
    SELECT id, name, email, mobile, department, job_role AS "jobRole"
    FROM users WHERE manager_id = ? AND role = 'employee' ORDER BY name
  `).all(req.params.managerId);
  if (team.length === 0) return res.json([]);

  const ids = team.map((m) => m.id);
  const rules = await db.prepare('SELECT * FROM category_rules WHERE manager_id = ?').all(req.params.managerId);
  const overrides = buildOverrideMaps(rules);
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
    const productivity = computeProductivity(eventsByUser.get(member.id) ?? [], overrides);

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
