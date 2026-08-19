import crypto from 'node:crypto';
import { db } from './db.js';

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

export function createSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, userId);
  return token;
}

function tokenFromReq(req) {
  const header = req.header('authorization');
  if (header?.startsWith('Bearer ')) return header.slice(7);
  // Fallback for contexts that can't set headers, e.g. <img src>/PDF download links.
  if (req.query.token) return req.query.token;
  return null;
}

export function resolveSession(token) {
  if (!token) return null;
  return db.prepare(`
    SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?
  `).get(token) ?? null;
}

// Attaches req.authUser if a valid session token is present; 401 otherwise.
export function requireAuth(req, res, next) {
  const user = resolveSession(tokenFromReq(req));
  if (!user) return res.status(401).json({ error: 'not authenticated' });
  req.authUser = user;
  next();
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

// For routes shared between manager team-wide views (?managerId=) and employee
// self-views (?userId=): the caller must be that exact manager, or that exact
// employee, or the manager who owns that employee.
export function authorizeScopedQuery(req, res) {
  const { userId, managerId } = req.query;
  if (managerId !== undefined) {
    if (req.authUser.role !== 'manager' || Number(managerId) !== req.authUser.id) {
      res.status(403).json({ error: 'not your team' });
      return false;
    }
  }
  if (userId !== undefined) {
    if (!isSelfOrOwnEmployee(req.authUser, Number(userId))) {
      res.status(403).json({ error: 'not authorized for this user' });
      return false;
    }
  }
  return true;
}

export function isSelfOrOwnEmployee(authUser, targetUserId) {
  if (authUser.id === targetUserId) return true;
  if (authUser.role === 'superadmin') return true;
  if (authUser.role !== 'manager') return false;
  const target = db.prepare('SELECT manager_id FROM users WHERE id = ?').get(targetUserId);
  return target?.manager_id === authUser.id;
}
