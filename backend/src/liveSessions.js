import crypto from 'node:crypto';

// In-memory only, by design: a "watch live" session just tracks who's allowed
// to pair with whom over the WebSocket relay (see liveRelay.js) — the actual
// video frames pass through that relay directly, never touching Postgres or
// this Map. Only correct for a single backend instance (true of both
// Render's free tier and the planned Lightsail box) — a multi-instance
// deployment would need a shared store (e.g. Redis) instead of this Map.
const sessions = new Map();
const SESSION_TTL_MS = 2 * 60 * 1000;

function sweepStale() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.createdAt > SESSION_TTL_MS) sessions.delete(id);
  }
}

export function createSession({ employeeId, requestedByUserId }) {
  sweepStale();
  const id = crypto.randomBytes(12).toString('hex');
  const session = {
    id,
    employeeId,
    requestedByUserId,
    status: 'pending', // pending -> connected -> ended
    error: null,
    createdAt: Date.now(),
  };
  sessions.set(id, session);
  return session;
}

export function getSession(id) {
  return sessions.get(id) ?? null;
}

export function findPendingSessionForEmployee(employeeId) {
  sweepStale();
  for (const s of sessions.values()) {
    if (s.employeeId === employeeId && s.status === 'pending') return s;
  }
  return null;
}

export function markSessionConnected(id) {
  const session = sessions.get(id);
  if (session) session.status = 'connected';
}

export function markSessionError(id, message) {
  const session = sessions.get(id);
  if (session) { session.status = 'ended'; session.error = message; }
}

export function deleteSession(id) {
  sessions.delete(id);
}
