import { WebSocketServer } from 'ws';
import { db } from './db.js';
import { resolveSession } from './auth.js';
import { getSession, markSessionConnected, markSessionError, deleteSession } from './liveSessions.js';

// "Watch Live" video relay: both the employee's agent and the manager's
// browser open a plain WebSocket to this same path and get paired up by
// sessionId. Deliberately NOT peer-to-peer — the earlier WebRTC/STUN/TURN
// design kept failing in ways that took days to even diagnose (wrong TURN
// hostname, ICE connectivity checks hanging forever with no error) because
// direct connections depend on the specifics of whatever network the
// employee and manager happen to be on. Relaying through this server, which
// both sides already reach reliably for every other feature, sidesteps NAT
// traversal entirely. Frames are never written to disk or the database —
// this only ever forwards bytes from one open socket to the other while
// someone is actively watching.
const AGENT_CONNECT_TIMEOUT_MS = 15_000;

// sessionId -> { agentWs, viewerWs, agentTimeout }
const pairs = new Map();

function getOrCreatePair(sessionId) {
  let pair = pairs.get(sessionId);
  if (!pair) {
    pair = { agentWs: null, viewerWs: null, agentTimeout: null };
    pairs.set(sessionId, pair);
  }
  return pair;
}

function cleanupPair(sessionId) {
  const pair = pairs.get(sessionId);
  if (pair?.agentTimeout) clearTimeout(pair.agentTimeout);
  pairs.delete(sessionId);
}

function closeSocket(ws, code, reason) {
  if (ws && ws.readyState === ws.OPEN) {
    try { ws.close(code, reason); } catch { /* already closing */ }
  }
}

async function authenticate(role, sessionId, params) {
  const session = getSession(sessionId);
  if (!session) return { ok: false, reason: 'session not found or expired' };

  if (role === 'agent') {
    const key = params.get('key');
    if (!key) return { ok: false, reason: 'missing key' };
    const user = await db.prepare('SELECT * FROM users WHERE agent_key = ?').get(key);
    if (!user || user.id !== session.employeeId) return { ok: false, reason: 'unauthorized' };
    return { ok: true, session };
  }

  if (role === 'viewer') {
    const token = params.get('token');
    const authUser = await resolveSession(token);
    if (!authUser || authUser.id !== session.requestedByUserId) return { ok: false, reason: 'unauthorized' };
    return { ok: true, session };
  }

  return { ok: false, reason: 'invalid role' };
}

// Called from the POST /live-sessions/:id/stop route — that route only
// deletes the session record, so this is what actually tears down whichever
// WebSocket(s) are open for it (the sockets' own 'close' handlers below take
// care of notifying and closing the other side).
export function closeSessionSockets(sessionId) {
  const pair = pairs.get(sessionId);
  if (!pair) return;
  closeSocket(pair.agentWs, 4004, 'session stopped');
  closeSocket(pair.viewerWs, 4004, 'session stopped');
  cleanupPair(sessionId);
}

export function attachLiveRelay(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/live-ws') return; // not ours — let other upgrade handlers (if any) see it

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, url);
    });
  });

  wss.on('connection', async (ws, url) => {
    const params = url.searchParams;
    const role = params.get('role');
    const sessionId = params.get('sessionId');

    if (!sessionId || (role !== 'agent' && role !== 'viewer')) {
      ws.close(4000, 'bad request');
      return;
    }

    const auth = await authenticate(role, sessionId, params);
    if (!auth.ok) {
      ws.close(4001, auth.reason);
      return;
    }

    const pair = getOrCreatePair(sessionId);

    if (role === 'agent') {
      if (pair.agentTimeout) { clearTimeout(pair.agentTimeout); pair.agentTimeout = null; }
      pair.agentWs = ws;
      markSessionConnected(sessionId);

      ws.on('message', (data, isBinary) => {
        if (isBinary && pair.viewerWs?.readyState === pair.viewerWs?.OPEN) {
          pair.viewerWs.send(data);
        }
      });

      ws.on('close', () => {
        if (pairs.get(sessionId)?.agentWs !== ws) return; // a newer connection already replaced this one
        closeSocket(pair.viewerWs, 4002, 'employee stream ended');
        deleteSession(sessionId);
        cleanupPair(sessionId);
      });
    } else {
      pair.viewerWs = ws;

      // The agent polls every couple of seconds for a new session, so it
      // should attach quickly — if it never does (employee went offline
      // between the click and now, or their app is too old to speak this
      // relay protocol), tell the viewer why instead of leaving it hanging.
      if (!pair.agentWs) {
        pair.agentTimeout = setTimeout(() => {
          if (pairs.get(sessionId)?.viewerWs !== ws) return;
          const message = "the employee's app didn't respond — they may have gone offline, or need the latest app update";
          markSessionError(sessionId, message);
          try { ws.send(JSON.stringify({ type: 'error', message })); } catch { /* socket already gone */ }
          closeSocket(ws, 4003, 'agent timeout');
          cleanupPair(sessionId);
        }, AGENT_CONNECT_TIMEOUT_MS);
      }

      ws.on('close', () => {
        if (pairs.get(sessionId)?.viewerWs !== ws) return;
        closeSocket(pair.agentWs, 4004, 'viewer stopped watching');
        deleteSession(sessionId);
        cleanupPair(sessionId);
      });
    }
  });
}
