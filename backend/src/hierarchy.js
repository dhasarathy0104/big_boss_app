import { db } from './db.js';

// The full reporting chain, top to bottom. Index = level: lower is more
// senior. Each role can only invite/create the role exactly one index below
// it (see roleBelow), and can see/manage everyone at any index below its own
// (see getDescendantIds) — a fixed hierarchy, not an arbitrary tree.
export const ROLE_ORDER = ['superadmin', 'gm', 'agm', 'manager', 'am', 'tl', 'employee'];

export function roleLevel(role) {
  return ROLE_ORDER.indexOf(role);
}

// The one role this role is allowed to invite directly below it, or null for
// a role with nobody below (employee) or one with no normal invite path
// (superadmin is created once, not "invited" the same way).
export function roleBelow(role) {
  const i = ROLE_ORDER.indexOf(role);
  if (i === -1 || i === ROLE_ORDER.length - 1) return null;
  return ROLE_ORDER[i + 1];
}

export function isSupervisorRole(role) {
  return ROLE_ORDER.includes(role) && role !== 'employee';
}

// Every user id anywhere below `userId` in the reporting chain, no matter
// how many levels down — a manager's AMs, their TLs, and their employees are
// all descendants of that manager, for example. A single recursive query
// rather than walking level by level in application code; correct and fast
// enough at any org size this app is realistically used at.
export async function getDescendantIds(userId) {
  const rows = await db.prepare(`
    WITH RECURSIVE subtree AS (
      SELECT id FROM users WHERE parent_id = ?
      UNION ALL
      SELECT u.id FROM users u JOIN subtree s ON u.parent_id = s.id
    )
    SELECT id FROM subtree
  `).all(userId);
  return rows.map((r) => r.id);
}

// Walks up the reporting chain from `userId` (starting at `userId` itself)
// until it finds someone with the given role, or returns null if nobody in
// the chain has it. Used for features still owned by one specific level —
// category rules and projects belong to the department Manager, not
// whichever level directly manages a given person, so an Employee under a
// TL under an AM needs this to find "their" Manager rather than just their
// direct parent.
export async function getAncestorIdWithRole(userId, role) {
  let currentId = userId;
  while (currentId) {
    const row = await db.prepare('SELECT role, parent_id FROM users WHERE id = ?').get(currentId);
    if (!row) return null;
    if (row.role === role) return currentId;
    currentId = row.parent_id;
  }
  return null;
}

// True if `authUser` is allowed to view/act on `targetUserId`'s data: it's
// their own, they're a super admin (sees everyone), or the target is
// anywhere in their reporting chain below them.
export async function isSelfOrDescendant(authUser, targetUserId) {
  if (authUser.id === targetUserId) return true;
  if (authUser.role === 'superadmin') return true;
  if (!isSupervisorRole(authUser.role)) return false;
  const descendantIds = await getDescendantIds(authUser.id);
  return descendantIds.includes(targetUserId);
}
