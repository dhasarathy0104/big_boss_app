import { Router } from 'express';
import { db } from '../db.js';
import { buildOverrideMaps, computeProductivity } from '../productivity.js';

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

liveStatusRouter.get('/:managerId/live-status', (req, res) => {
  const manager = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'manager'").get(req.params.managerId);
  if (!manager) return res.status(404).json({ error: 'manager not found' });

  const team = db.prepare(`
    SELECT id, name FROM users WHERE manager_id = ? AND role = 'employee' ORDER BY name
  `).all(req.params.managerId);

  const rules = db.prepare('SELECT * FROM category_rules WHERE manager_id = ?').all(req.params.managerId);
  const overrides = buildOverrideMaps(rules);
  const today = new Date().toISOString().slice(0, 10);

  const result = team.map((member) => {
    const latestEvent = db.prepare(`
      SELECT * FROM activity_events WHERE user_id = ? ORDER BY ended_at DESC LIMIT 1
    `).get(member.id);

    const todaysEvents = db.prepare(`
      SELECT * FROM activity_events
      WHERE user_id = ? AND started_at >= ? AND started_at < ?
      ORDER BY started_at
    `).all(member.id, `${today}T00:00:00.000Z`, `${today}T23:59:59.999Z`);
    const productivity = computeProductivity(todaysEvents, overrides);

    return {
      id: member.id,
      name: member.name,
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
