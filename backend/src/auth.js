import crypto from 'node:crypto';
import { db } from './db.js';
import { isSupervisorRole, isSelfOrDescendant } from './hierarchy.js';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === check.length && crypto.timingSafeEqual(expected, check);
}

export async function createSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  await db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, userId);
  return token;
}

function tokenFromReq(req) {
  const header = req.header('authorization');
  if (header?.startsWith('Bearer ')) return header.slice(7);
  // Fallback for contexts that can't set headers, e.g. <img src>/PDF download links.
  if (req.query.token) return req.query.token;
  return null;
}

export async function resolveSession(token) {
  if (!token) return null;
  const user = await db.prepare(`
    SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?
  `).get(token);
  return user ?? null;
}

// Attaches req.authUser if a valid session token is present; 401 otherwise.
export async function requireAuth(req, res, next) {
  try {
    const user = await resolveSession(tokenFromReq(req));
    if (!user) return res.status(401).json({ error: 'not authenticated' });
    req.authUser = user;
    next();
  } catch (err) {
    next(err);
  }
}

// requireAuth + must be a manager.
export function requireManager(req, res, next) {
  requireAuth(req, res, () => {
    if (req.authUser.role !== 'manager') return res.status(403).json({ error: 'manager access required' });
    next();
  });
}

// requireAuth + must be a super admin (org-wide oversight across all managers/employees).
export function requireSuperAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.authUser.role !== 'superadmin') return res.status(403).json({ error: 'super admin access required' });
    next();
  });
}

// requireManager OR requireSuperAdmin.
export function requireManagerOrSuperAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.authUser.role !== 'manager' && req.authUser.role !== 'superadmin') {
      return res.status(403).json({ error: 'manager or super admin access required' });
    }
    next();
  });
}

// requireManager + the :id route param must be their own id (can't act on another manager's account).
export function requireManagerSelf(req, res, next) {
  requireManager(req, res, () => {
    if (Number(req.params.id) !== req.authUser.id) return res.status(403).json({ error: 'not your account' });
    next();
  });
}

// requireAuth + must be any level of the reporting chain above Employee
// (GM, AGM, Manager, AM, TL) — the generalized version of "is a manager,"
// for the features every one of those levels shares: viewing/managing
// their own subtree, inviting the level below them, adjusting settings
// for the people under them.
export function requireSupervisor(req, res, next) {
  requireAuth(req, res, () => {
    if (!isSupervisorRole(req.authUser.role)) return res.status(403).json({ error: 'supervisor access required' });
    next();
  });
}

// requireSupervisor + the :id route param must be their own id.
export function requireSupervisorSelf(req, res, next) {
  requireSupervisor(req, res, () => {
    if (Number(req.params.id) !== req.authUser.id) return res.status(403).json({ error: 'not your account' });
    next();
  });
}

// For routes shared between a supervisor's team-wide view (?managerId=,
// despite the name — kept for backward compatibility, it now means "this
// supervisor's own id" at any tier) and an individual's self-view
// (?userId=): the caller must be a supervisor querying their own id, or
// that exact employee, or someone above that employee in the hierarchy.
// Generalized from Manager-only to every supervisor tier (see
// hierarchy.js's isSupervisorRole) — team-wide time-entries/leave-requests/
// attendance review now works the same way team management already does.
// The actual subtree scoping happens in each route's own query (via
// getDescendantIds), not here — this only confirms the caller may ask for
// their own id at all.
export async function authorizeScopedQuery(req, res) {
  const { userId, managerId } = req.query;
  if (managerId !== undefined) {
    if (!isSupervisorRole(req.authUser.role) || Number(managerId) !== req.authUser.id) {
      res.status(403).json({ error: 'not your team' });
      return false;
    }
  }
  if (userId !== undefined) {
    if (!(await isSelfOrOwnEmployee(req.authUser, Number(userId)))) {
      res.status(403).json({ error: 'not authorized for this user' });
      return false;
    }
  }
  return true;
}

// Generalized across the whole reporting chain, not just a direct manager —
// true for the person themselves, a super admin (sees everyone), or anyone
// with targetUserId anywhere below them in the chain (see hierarchy.js).
// Kept under its original name since it's used throughout the codebase; the
// behavior is what changed; every existing call site gets the wider
// (correct) hierarchy check automatically.
export async function isSelfOrOwnEmployee(authUser, targetUserId) {
  return isSelfOrDescendant(authUser, targetUserId);
}
