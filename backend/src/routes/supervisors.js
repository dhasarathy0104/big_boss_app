import { Router } from 'express';
import { db, randomToken } from '../db.js';
import { requireSupervisorSelf } from '../auth.js';
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
