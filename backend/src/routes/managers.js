import { Router } from 'express';
import crypto from 'node:crypto';
import { db, randomToken } from '../db.js';
import { requireManager, requireManagerSelf } from '../auth.js';

export const managersRouter = Router();

// Any logged-in manager can create another manager account (a peer, e.g. for
// team-transfer scenarios) — not open public self-registration, which was
// intentionally locked to the very first manager account only. Reuses the
// same claim-link flow employees use to set their own password, since the
// claim mechanism doesn't care about role.
managersRouter.post('/create-peer', requireManager, (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });

  const agentKey = crypto.randomBytes(16).toString('hex');
  const claimToken = randomToken(16);
  const info = db.prepare(`
    INSERT INTO users (name, agent_key, role, manager_id, claim_token) VALUES (?, ?, 'manager', NULL, ?)
  `).run(name.trim(), agentKey, claimToken);
  res.json({ id: info.lastInsertRowid, name: name.trim(), claimToken });
});

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

// Other manager accounts, to pick a transfer destination from.
managersRouter.get('/:id/other-managers', requireManagerSelf, (req, res) => {
  const others = db.prepare("SELECT id, name FROM users WHERE role = 'manager' AND id != ? ORDER BY name")
    .all(req.params.id);
  res.json(others);
});

// Moves an employee to a different manager. Their whole record (history,
// screenshots, attendance, leave) moves with them — manager_id is the one
// source of truth for "whose team is this employee on", there's no
// before/after split. The old manager loses access immediately; the new
// manager gains full access immediately, including past data.
managersRouter.post('/:id/team/:employeeId/transfer', requireManagerSelf, (req, res) => {
  const { targetManagerId } = req.body;
  if (!targetManagerId) return res.status(400).json({ error: 'targetManagerId required' });
  if (Number(targetManagerId) === Number(req.params.id)) {
    return res.status(400).json({ error: 'employee is already on your team' });
  }

  const employee = db.prepare("SELECT * FROM users WHERE id = ? AND manager_id = ? AND role = 'employee'")
    .get(req.params.employeeId, req.params.id);
  if (!employee) return res.status(404).json({ error: 'employee not found on your team' });

  const targetManager = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'manager'").get(targetManagerId);
  if (!targetManager) return res.status(404).json({ error: 'target manager not found' });

  db.prepare('UPDATE users SET manager_id = ? WHERE id = ?').run(targetManager.id, employee.id);
  res.json({ ok: true, employeeId: employee.id, newManagerId: targetManager.id, newManagerName: targetManager.name });
});
