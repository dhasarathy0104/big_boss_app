import { Router } from 'express';
import { db, randomToken } from '../db.js';
import { requireSupervisorSelf } from '../auth.js';
import { getDescendantIds, roleBelow } from '../hierarchy.js';
import { isValidHHMMOrEmpty } from '../trackingWindow.js';
import { ah } from '../asyncHandler.js';

// Generalized invite management for any level above Employee (GM, AGM,
// Manager, AM, TL) — the same idea as the original manager-only invite
// links in routes/managers.js, just not restricted to one specific role.
// One rule everywhere: you can only invite the role directly below you
// (see hierarchy.js's roleBelow) — which role that actually is gets
// resolved when the link is used (see invites.js's public preview and
// auth.js's claim-invite), not stored on the link itself.
export const supervisorsRouter = Router();

supervisorsRouter.get('/:id/invites', requireSupervisorSelf, ah(async (req, res) => {
  const invites = await db.prepare(`
    SELECT * FROM invite_links WHERE inviter_id = ? AND revoked = 0 ORDER BY created_at DESC
  `).all(req.params.id);
  res.json(invites);
}));

supervisorsRouter.post('/:id/invites', requireSupervisorSelf, ah(async (req, res) => {
  const token = randomToken(12);
  await db.prepare('INSERT INTO invite_links (token, inviter_id) VALUES (?, ?)').run(token, req.params.id);
  res.json(await db.prepare('SELECT * FROM invite_links WHERE token = ?').get(token));
}));

supervisorsRouter.post('/:id/invites/:inviteId/revoke', requireSupervisorSelf, ah(async (req, res) => {
  await db.prepare('UPDATE invite_links SET revoked = 1 WHERE id = ? AND inviter_id = ?').run(req.params.inviteId, req.params.id);
  res.json({ ok: true });
}));

// Direct reports only — whoever this person invited (or was assigned)
// directly, one level down. Could be any role: a Manager's direct reports
// are typically AMs, a TL's are Employees, and so on depending on how deep
// the org actually uses each level.
supervisorsRouter.get('/:id/team', requireSupervisorSelf, ah(async (req, res) => {
  const team = await db.prepare(`
    SELECT id, name, email, role, mobile, department, job_role AS "jobRole", created_at,
      (password_reset_requested_at IS NOT NULL) AS "passwordResetRequested"
    FROM users WHERE parent_id = ? ORDER BY name
  `).all(req.params.id);
  res.json(team);
}));

// Every Employee anywhere below this person, no matter how many levels
// down — this is the list Timeline/Screenshots pick from, which is a
// different question from "my direct reports" above (an AGM's direct
// reports are Managers, not the Employees several levels further down who
// are the ones actually being monitored).
supervisorsRouter.get('/:id/employees', requireSupervisorSelf, ah(async (req, res) => {
  const descendantIds = await getDescendantIds(Number(req.params.id));
  if (descendantIds.length === 0) return res.json([]);
  const employees = await db.prepare(`
    SELECT id, name, email, mobile, department, job_role AS "jobRole"
    FROM users WHERE id = ANY(?) AND role = 'employee' ORDER BY name
  `).all(descendantIds);
  res.json(employees);
}));

// Screenshot interval / tracking hours — the generalized version of
// routes/managers.js's settings endpoints, usable by any supervisor tier
// for the people directly below them (see server.js's agent-settings/
// ingest routes, which read whichever direct parent's row this affects).
supervisorsRouter.get('/:id/settings', requireSupervisorSelf, ah(async (req, res) => {
  const user = await db.prepare(
    'SELECT screenshot_interval_minutes, tracking_start_time, tracking_end_time FROM users WHERE id = ?'
  ).get(req.params.id);
  res.json({
    screenshotIntervalMinutes: user.screenshot_interval_minutes,
    trackingStartTime: user.tracking_start_time,
    trackingEndTime: user.tracking_end_time,
  });
}));

supervisorsRouter.patch('/:id/settings', requireSupervisorSelf, ah(async (req, res) => {
  const updates = [];
  const values = [];

  if ('screenshotIntervalMinutes' in req.body) {
    const minutes = Number(req.body.screenshotIntervalMinutes);
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 240) {
      return res.status(400).json({ error: 'screenshotIntervalMinutes must be an integer between 0 (off) and 240' });
    }
    updates.push('screenshot_interval_minutes = ?');
    values.push(minutes);
  }
  if ('trackingStartTime' in req.body || 'trackingEndTime' in req.body) {
    const start = req.body.trackingStartTime ?? null;
    const end = req.body.trackingEndTime ?? null;
    if (!isValidHHMMOrEmpty(start) || !isValidHHMMOrEmpty(end)) {
      return res.status(400).json({ error: 'tracking hours must be in HH:MM (24-hour) format, or blank' });
    }
    if ((start && !end) || (!start && end)) {
      return res.status(400).json({ error: 'set both a start and end time, or leave both blank' });
    }
    updates.push('tracking_start_time = ?', 'tracking_end_time = ?');
    values.push(start || null, end || null);
  }
  if (updates.length === 0) return res.status(400).json({ error: 'nothing to update' });

  values.push(req.params.id);
  await db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const updated = await db.prepare(
    'SELECT screenshot_interval_minutes, tracking_start_time, tracking_end_time FROM users WHERE id = ?'
  ).get(req.params.id);
  res.json({
    screenshotIntervalMinutes: updated.screenshot_interval_minutes,
    trackingStartTime: updated.tracking_start_time,
    trackingEndTime: updated.tracking_end_time,
  });
}));

// What role this person is allowed to invite, so the dashboard can label
// the invite link correctly ("Invite an AM") without hardcoding the chain
// client-side.
supervisorsRouter.get('/:id/invite-role', requireSupervisorSelf, ah(async (req, res) => {
  const user = await db.prepare('SELECT role FROM users WHERE id = ?').get(req.params.id);
  res.json({ role: roleBelow(user?.role) });
}));
