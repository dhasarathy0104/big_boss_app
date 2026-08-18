import { Router } from 'express';
import crypto from 'node:crypto';
import { db, randomToken } from '../db.js';
import { requireManagerSelf } from '../auth.js';

export const managersRouter = Router();

managersRouter.get('/:id/team', requireManagerSelf, (req, res) => {
  const team = db.prepare(`
    SELECT id, name, created_at, (claim_token IS NOT NULL) AS hasPendingClaim, (password_hash IS NOT NULL) AS hasDashboardLogin
    FROM users WHERE manager_id = ? AND role = 'employee' ORDER BY name
  `).all(req.params.id);
  res.json(team);
});

managersRouter.get('/:id/invites', requireManagerSelf, (req, res) => {
  const invites = db.prepare(`
    SELECT * FROM invite_links WHERE manager_id = ? AND revoked = 0 ORDER BY created_at DESC
  `).all(req.params.id);
  res.json(invites);
});

managersRouter.post('/:id/invites', requireManagerSelf, (req, res) => {
  const token = randomToken(12);
  db.prepare('INSERT INTO invite_links (token, manager_id) VALUES (?, ?)').run(token, req.params.id);
  res.json(db.prepare('SELECT * FROM invite_links WHERE token = ?').get(token));
});

managersRouter.post('/:id/invites/:inviteId/revoke', requireManagerSelf, (req, res) => {
  db.prepare('UPDATE invite_links SET revoked = 1 WHERE id = ? AND manager_id = ?').run(req.params.inviteId, req.params.id);
  res.json({ ok: true });
});

managersRouter.get('/:id/settings', requireManagerSelf, (req, res) => {
  const manager = db.prepare('SELECT screenshot_interval_minutes FROM users WHERE id = ?').get(req.params.id);
  res.json({ screenshotIntervalMinutes: manager.screenshot_interval_minutes });
});

managersRouter.patch('/:id/settings', requireManagerSelf, (req, res) => {
  const { screenshotIntervalMinutes } = req.body;
  const minutes = Number(screenshotIntervalMinutes);
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 240) {
    return res.status(400).json({ error: 'screenshotIntervalMinutes must be an integer between 0 (off) and 240' });
  }
  db.prepare('UPDATE users SET screenshot_interval_minutes = ? WHERE id = ?').run(minutes, req.params.id);
  res.json({ screenshotIntervalMinutes: minutes });
});

// Generates (or regenerates) a one-time link an employee uses to set their own
// dashboard password — separate from the invite link, which only connects the
// background tracking agent. Manager hands this to that specific employee.
managersRouter.post('/:id/team/:employeeId/claim-link', requireManagerSelf, (req, res) => {
  const employee = db.prepare("SELECT * FROM users WHERE id = ? AND manager_id = ? AND role = 'employee'")
    .get(req.params.employeeId, req.params.id);
  if (!employee) return res.status(404).json({ error: 'employee not found on your team' });

  const claimToken = randomToken(16);
  db.prepare('UPDATE users SET claim_token = ? WHERE id = ?').run(claimToken, employee.id);
  res.json({ claimToken });
});
