import crypto from 'node:crypto';

// In-memory only, by design: a "watch live" session is a few minutes of
// SDP/ICE signaling text, never needs to survive a server restart, and the
// video itself never reaches this process at all (agent and viewer connect
// directly, peer-to-peer). Nothing here is written to Postgres.
// Only correct for a single backend instance (true of both Render's free
// tier and the planned Lightsail box) — a multi-instance deployment would
// need a shared store (e.g. Redis) instead of this Map.
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
    status: 'pending', // pending -> offered -> answered -> failed
    offer: null,
    answer: null,
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

export function deleteSession(id) {
  sessions.delete(id);
}
