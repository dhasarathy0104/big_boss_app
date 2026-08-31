import { Router } from 'express';
import { requireManagerOrSuperAdmin, isSelfOrOwnEmployee } from '../auth.js';
import { ah } from '../asyncHandler.js';
import { createSession, getSession, deleteSession } from '../liveSessions.js';
import { closeSessionSockets } from '../liveRelay.js';

export const liveStreamRouter = Router();

// Manager/superadmin asks to watch one employee's screen live. This only
// creates the session record the WebSocket relay (see liveRelay.js) uses to
// authorize and pair the two sides — the video itself flows over that
// relay, not through any route here, and nothing is written to the database.
liveStreamRouter.post('/live-sessions', requireManagerOrSuperAdmin, ah(async (req, res) => {
  const employeeId = Number(req.body.employeeId);
  if (!employeeId) return res.status(400).json({ error: 'employeeId required' });
  if (!(await isSelfOrOwnEmployee(req.authUser, employeeId))) {
    return res.status(403).json({ error: 'not authorized to watch this employee' });
  }
  const session = createSession({ employeeId, requestedByUserId: req.authUser.id });
  res.json({ sessionId: session.id });
}));

// Polled by the viewer only as a fallback (the relay itself pushes a
// JSON error message over the WebSocket when something goes wrong) — mainly
// useful if the WebSocket never even manages to open.
liveStreamRouter.get('/live-sessions/:id', requireManagerOrSuperAdmin, ah(async (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'session not found or expired' });
  if (session.requestedByUserId !== req.authUser.id) return res.status(403).json({ error: 'not your session' });
  res.json(session);
}));

// Either side can stop at any time — the session is simply deleted, and the
// relay closes both WebSocket connections as a result.
liveStreamRouter.post('/live-sessions/:id/stop', requireManagerOrSuperAdmin, ah(async (req, res) => {
  const session = getSession(req.params.id);
  if (session && session.requestedByUserId === req.authUser.id) {
    deleteSession(session.id);
    closeSessionSockets(session.id);
  }
  res.json({ ok: true });
}));
