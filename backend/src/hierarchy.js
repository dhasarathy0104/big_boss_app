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

// The one role allowed to be this role's parent, or null for superadmin
// (nobody's above it). Used by reassignment: moving someone to a new parent
// is only valid if the new parent's role is exactly this — the inverse of
// roleBelow, kept as its own function since callers ask both directions.
export function roleAbove(role) {
  const i = ROLE_ORDER.indexOf(role);
  if (i <= 0) return null;
  return ROLE_ORDER[i - 1];
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

// True if `role` is at `thresholdRole`'s level or more senior — e.g.
// roleAtOrAbove('am', 'am') and roleAtOrAbove('manager', 'am') are both
// true, roleAtOrAbove('tl', 'am') is false. Used for features with a fixed
// "this tier and everyone above it" cutoff (e.g. category-rule editing is
// AM-and-above, project creation is Manager-and-above) — a plain roleLevel
// comparison, kept as its own function so cutoffs read as intent rather
// than a bare index comparison at every call site.
export function roleAtOrAbove(role, thresholdRole) {
  const level = roleLevel(role);
  const threshold = roleLevel(thresholdRole);
  return level !== -1 && threshold !== -1 && level <= threshold;
}

// True if `authUser` is allowed to act on a resource owned by the Manager
// `managerId` — projects, category rules, and billing are all anchored to
// one specific Manager this way (see projects.manager_id /
// category_rules.manager_id), unlike employee-owned data which uses
// isSelfOrDescendant above. The owning Manager can sit either below the
// caller (a GM/AGM looking down at a Manager somewhere in their subtree) or
// above the caller (an AM/TL/Employee looking up at their own department's
// Manager) — this checks both directions relative to roleLevel('manager')
// rather than assuming "below" like isSelfOrDescendant does.
export async function isManagerInScope(authUser, managerId) {
  if (authUser.role === 'superadmin') return true;
  if (authUser.id === managerId) return true;
  if (roleLevel(authUser.role) === -1) return false;
  if (roleAtOrAbove(authUser.role, 'manager')) {
    const descendantIds = await getDescendantIds(authUser.id);
    return descendantIds.includes(managerId);
  }
  const ownManagerId = await getAncestorIdWithRole(authUser.id, 'manager');
  return ownManagerId === managerId;
}

// One department's full org chart: the Manager, their AMs, and each AM's
// TLs, each level carrying an employee count so the UI can show "12
// employees" on a card without a separate round trip per card. Legacy
// employees still pointing straight at the manager (pre-dating AM/TL) count
// toward the department total but aren't nested under a synthetic AM/TL —
// same "shows as direct, not excluded" precedent as employees-full elsewhere.
// Shared by superadmin's org-wide /departments and every supervisor tier's
// scoped /:id/departments, so the two can never drift apart.
const EMPLOYEE_COLUMNS = "id, name, email, mobile, department, job_role AS \"jobRole\"";

export async function buildDepartment(manager) {
  const ams = await db.prepare("SELECT id, name, email, mobile FROM users WHERE parent_id = ? AND role = 'am' ORDER BY name").all(manager.id);
  const amsWithTls = await Promise.all(ams.map(async (am) => {
    const tls = await db.prepare("SELECT id, name, email, mobile FROM users WHERE parent_id = ? AND role = 'tl' ORDER BY name").all(am.id);
    const tlsWithEmployees = await Promise.all(tls.map(async (tl) => {
      const employees = await db.prepare(`SELECT ${EMPLOYEE_COLUMNS} FROM users WHERE parent_id = ? AND role = 'employee' ORDER BY name`).all(tl.id);
      return { ...tl, employees, employeeCount: employees.length };
    }));
    const employeeCount = tlsWithEmployees.reduce((sum, tl) => sum + tl.employeeCount, 0);
    return { ...am, tls: tlsWithEmployees, employeeCount };
  }));
  // Legacy employees still pointing straight at the manager, pre-dating
  // AM/TL — kept as their own small list rather than folded into a
  // synthetic AM/TL, same "shows as direct, not excluded" precedent as
  // employees-full elsewhere.
  const directEmployees = await db.prepare(`SELECT ${EMPLOYEE_COLUMNS} FROM users WHERE parent_id = ? AND role = 'employee' ORDER BY name`).all(manager.id);
  const employeeCount = amsWithTls.reduce((sum, am) => sum + am.employeeCount, 0) + directEmployees.length;
  return {
    id: manager.id, name: manager.name, email: manager.email, mobile: manager.mobile,
    department: manager.department, jobRole: manager.jobRole ?? null,
    ams: amsWithTls, directEmployees, employeeCount,
  };
}
