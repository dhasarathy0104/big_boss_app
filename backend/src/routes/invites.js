import { Router } from 'express';
import { db } from '../db.js';
import { ah } from '../asyncHandler.js';

// Public — the /join/:token landing page calls this before the employee has any credentials.
export const invitesPublicRouter = Router();

invitesPublicRouter.get('/:token', ah(async (req, res) => {
  const invite = await db.prepare('SELECT * FROM invite_links WHERE token = ? AND revoked = 0').get(req.params.token);
  if (!invite) return res.status(404).json({ valid: false, error: 'invite not found or revoked' });
  const manager = await db.prepare('SELECT id, name FROM users WHERE id = ?').get(invite.manager_id);
  res.json({ valid: true, managerId: manager.id, managerName: manager.name });
}));
