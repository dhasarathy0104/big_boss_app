import { Router } from 'express';
import { requireManagerOrSuperAdmin, isSelfOrOwnEmployee } from '../auth.js';
import { ah } from '../asyncHandler.js';
import { createSession, getSession, deleteSession } from '../liveSessions.js';

export const liveStreamRouter = Router();

// Manager/superadmin asks to watch one employee's screen live. This only sets
// up peer-to-peer signaling (SDP offer/answer) — the video itself goes
// directly between the agent and the viewer's browser, never through this
// server, and nothing here is written to the database.
liveStreamRouter.post('/live-sessions', requireManagerOrSuperAdmin, ah(async (req, res) => {
  const employeeId = Number(req.body.employeeId);
  if (!employeeId) return res.status(400).json({ error: 'employeeId required' });
  if (!(await isSelfOrOwnEmployee(req.authUser, employeeId))) {
    return res.status(403).json({ error: 'not authorized to watch this employee' });
  }
  const session = createSession({ employeeId, requestedByUserId: req.authUser.id });
  res.json({ sessionId: session.id });
}));

function requireOwnSession(req, res) {
  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'session not found or expired' });
    return null;
  }
  if (session.requestedByUserId !== req.authUser.id) {
    res.status(403).json({ error: 'not your session' });
    return null;
  }
  return session;
}

// Polled by the viewer's browser while waiting for the agent to pick up the
// request and post its offer, and again while waiting for the agent to see
// the answer. 404 once the session is gone (stopped by either side, or timed
// out) is the viewer's cue to tear down.
liveStreamRouter.get('/live-sessions/:id', requireManagerOrSuperAdmin, ah(async (req, res) => {
  const session = requireOwnSession(req, res);
  if (!session) return;
  res.json(session);
}));

liveStreamRouter.post('/live-sessions/:id/answer', requireManagerOrSuperAdmin, ah(async (req, res) => {
  const session = requireOwnSession(req, res);
  if (!session) return;
  if (!req.body.sdp) return res.status(400).json({ error: 'sdp required' });
  session.answer = req.body.sdp;
  session.status = 'answered';
  res.json({ ok: true });
}));

// Either side can stop at any time — the session is simply deleted, and the
// other side's next poll gets a 404, which it treats as "stream ended."
liveStreamRouter.post('/live-sessions/:id/stop', requireManagerOrSuperAdmin, ah(async (req, res) => {
  const session = getSession(req.params.id);
  if (session && session.requestedByUserId === req.authUser.id) {
    deleteSession(session.id);
  }
  res.json({ ok: true });
}));
