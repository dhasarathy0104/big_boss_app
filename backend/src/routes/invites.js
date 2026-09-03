import { Router } from 'express';
import { db } from '../db.js';
import { ah } from '../asyncHandler.js';
import { roleBelow } from '../hierarchy.js';

// Public — the /join/:token landing page calls this before the invitee has
// any credentials. `role` tells the join page what kind of account it's
// about to create (an Employee joining via the native app, or one of the
// supervisor tiers joining via the web claim form) — always the inviter's
// role one level down (see hierarchy.js's roleBelow), never stored on the
// invite itself.
export const invitesPublicRouter = Router();

invitesPublicRouter.get('/:token', ah(async (req, res) => {
  const invite = await db.prepare('SELECT * FROM invite_links WHERE token = ? AND revoked = 0').get(req.params.token);
  if (!invite) return res.status(404).json({ valid: false, error: 'invite not found or revoked' });
  const inviter = await db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(invite.inviter_id);
  const role = roleBelow(inviter.role);
  if (!role) return res.status(404).json({ valid: false, error: 'this account cannot invite anyone' });
  res.json({ valid: true, managerId: inviter.id, managerName: inviter.name, role });
}));
