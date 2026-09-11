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

// The screenshot interval + tracking-hours window that actually govern a
// given employee's agent: their real Manager's row, walking through any
// number of TL/AM hops, or the org-wide default (the super admin row) when
// no Manager exists anywhere in their chain (a fully orphaned TL/AM, or no
// Manager in the org yet). Single source of truth for this resolution --
// GET /api/agent-settings and both /api/ingest/* routes must all agree on
// what "the employee's settings" means, so they share this instead of each
// re-implementing the manager-or-fallback lookup (one previously skipped
// the fallback entirely, silently leaving tracking-hours unenforced for
// every orphaned-chain employee despite the org-default UI showing a
// window as active).
export async function getEffectiveAgentSettings(userId) {
  const managerId = await getAncestorIdWithRole(userId, 'manager');
  const source = managerId
    ? await db.prepare('SELECT screenshot_interval_minutes, tracking_start_time, tracking_end_time FROM users WHERE id = ?').get(managerId)
    : await db.prepare("SELECT screenshot_interval_minutes, tracking_start_time, tracking_end_time FROM users WHERE role = 'superadmin'").get();
  return {
    screenshotIntervalMinutes: source?.screenshot_interval_minutes ?? 5,
    trackingStartTime: source?.tracking_start_time ?? null,
    trackingEndTime: source?.tracking_end_time ?? null,
  };
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

async function buildTlWithEmployees(tl) {
  const employees = await db.prepare(`SELECT ${EMPLOYEE_COLUMNS} FROM users WHERE parent_id = ? AND role = 'employee' ORDER BY name`).all(tl.id);
  return { ...tl, employees, employeeCount: employees.length };
}

async function buildAmWithTls(am) {
  const tls = await db.prepare("SELECT id, name, email, mobile FROM users WHERE parent_id = ? AND role = 'tl' ORDER BY name").all(am.id);
  const tlsWithEmployees = await Promise.all(tls.map(buildTlWithEmployees));
  const employeeCount = tlsWithEmployees.reduce((sum, tl) => sum + tl.employeeCount, 0);
  return { ...am, tls: tlsWithEmployees, employeeCount };
}

export async function buildDepartment(manager) {
  const ams = await db.prepare("SELECT id, name, email, mobile FROM users WHERE parent_id = ? AND role = 'am' ORDER BY name").all(manager.id);
  const amsWithTls = await Promise.all(ams.map(buildAmWithTls));
  // Legacy employees still pointing straight at the manager, pre-dating
  // AM/TL — kept as their own small list rather than folded into a
  // synthetic AM/TL, same "shows as direct, not excluded" precedent as
  // employees-full elsewhere.
  const directEmployees = await db.prepare(`SELECT ${EMPLOYEE_COLUMNS} FROM users WHERE parent_id = ? AND role = 'employee' ORDER BY name`).all(manager.id);
  // A Team Lead can now also report straight to the Manager with no
  // Assistant Manager in between (see the tl/manager exception in
  // POST /users/:id/reassign and adoptOrphansIntoDepartment below) — same
  // "shows as direct, not excluded" precedent as directEmployees above,
  // just one level up.
  const directTlRows = await db.prepare("SELECT id, name, email, mobile FROM users WHERE parent_id = ? AND role = 'tl' ORDER BY name").all(manager.id);
  const directTls = await Promise.all(directTlRows.map(buildTlWithEmployees));
  const employeeCount = amsWithTls.reduce((sum, am) => sum + am.employeeCount, 0)
    + directEmployees.length
    + directTls.reduce((sum, tl) => sum + tl.employeeCount, 0);
  return {
    id: manager.id, name: manager.name, email: manager.email, mobile: manager.mobile,
    department: manager.department, jobRole: manager.jobRole ?? null,
    ams: amsWithTls, directEmployees, directTls, employeeCount,
  };
}

// When a new Manager registers with a department name, silently adopt any
// pre-existing orphaned AM/TL (parent_id IS NULL) that declared the exact
// same department name (matched case/whitespace-insensitively, since a
// typo'd/differently-cased retype of the same real department is far more
// likely than two genuinely distinct departments sharing a name) --
// otherwise they'd sit in Overview as a *separate* "Unassigned" group
// forever, even though the whole point of typing a matching name was "this
// is the same team." An orphaned TL is attached directly to the Manager
// (no AM in between), same allowance as the manual admin-panel transfer.
export async function adoptOrphansIntoDepartment(managerId, department) {
  const normalized = (department ?? '').trim().toLowerCase();
  if (!normalized) return;

  const orphanAms = await db.prepare(
    "SELECT id FROM users WHERE parent_id IS NULL AND role = 'am' AND department IS NOT NULL AND LOWER(TRIM(department)) = ?"
  ).all(normalized);
  const orphanTls = await db.prepare(
    "SELECT id FROM users WHERE parent_id IS NULL AND role = 'tl' AND department IS NOT NULL AND LOWER(TRIM(department)) = ?"
  ).all(normalized);
  for (const row of [...orphanAms, ...orphanTls]) {
    await db.prepare('UPDATE users SET parent_id = ? WHERE id = ?').run(managerId, row.id);
  }
}

// Every Team Lead org-wide, with their Assistant Manager (direct parent, if
// any) and real Manager -- walked tolerantly via getAncestorIdWithRole so a
// TL parented straight to a Manager (no AM in between) still resolves
// correctly, instead of a fixed two-hop LEFT JOIN showing "no manager" for
// exactly the shape adoptOrphansIntoDepartment/the reassign route now
// create. Shared by GET /api/superadmin/tls and
// GET /api/managers/:id/tls-org-wide so the two org-wide TL pickers can't
// drift apart the way agent-settings and its ingest siblings once did.
export async function listTlsWithManagerInfo() {
  const tls = await db.prepare(`
    SELECT tl.id, tl.name, am.id AS "amId", am.name AS "amName"
    FROM users tl
    LEFT JOIN users am ON am.id = tl.parent_id AND am.role = 'am'
    WHERE tl.role = 'tl' ORDER BY tl.name
  `).all();
  return Promise.all(tls.map(async (tl) => {
    const managerId = await getAncestorIdWithRole(tl.id, 'manager');
    const manager = managerId ? await db.prepare('SELECT name FROM users WHERE id = ?').get(managerId) : null;
    return { ...tl, managerId, managerName: manager?.name ?? null };
  }));
}

// A department normally only exists as a Manager's own department field —
// but registration allows creating an AM or TL with no manager at all (see
// auth.js's register-admin), and someone can still set a department name
// directly on that orphaned AM/TL afterward (see PATCH /admins/:id). That
// name used to just vanish from Overview, since buildDepartment only ever
// walks down from a real Manager row — this synthesizes one "department"
// entry per distinct name found among orphaned AM/TL roots, in the same
// Manager -> AM -> TL -> Employee shape DepartmentDrillDown already
// renders, so no separate UI is needed. A root TL (no AM either) is
// wrapped as a single-TL "AM" node purely to fit that shape; there's no
// real AM behind it. Marked `unassigned: true` so the frontend can label
// these distinctly from a real Manager-backed department of the same name,
// since there's no actual hierarchy link between the two.
export async function buildUnassignedDepartments() {
  const orphanAms = await db.prepare("SELECT id, name, email, mobile, department FROM users WHERE parent_id IS NULL AND role = 'am' AND department IS NOT NULL ORDER BY name").all();
  const orphanTls = await db.prepare("SELECT id, name, email, mobile, department FROM users WHERE parent_id IS NULL AND role = 'tl' AND department IS NOT NULL ORDER BY name").all();

  const amNodes = await Promise.all(orphanAms.map(async (am) => ({ department: am.department, node: await buildAmWithTls(am) })));
  const tlNodes = await Promise.all(orphanTls.map(async (tl) => {
    const tlWithEmployees = await buildTlWithEmployees(tl);
    return {
      department: tl.department,
      // roleLabel overrides DepartmentDrillDown's hardcoded "Assistant
      // Manager" at this level — this node is really a Team Lead, just
      // wrapped one level up to fit the shape.
      node: {
        id: tl.id, name: tl.name, email: tl.email, mobile: tl.mobile, roleLabel: 'Team Lead',
        tls: [tlWithEmployees], employeeCount: tlWithEmployees.employeeCount,
      },
    };
  }));

  const groups = new Map();
  for (const { department, node } of [...amNodes, ...tlNodes]) {
    if (!groups.has(department)) groups.set(department, []);
    groups.get(department).push(node);
  }

  return [...groups.entries()].map(([department, ams]) => ({
    id: `unassigned:${department}`,
    name: 'Unassigned', email: null, mobile: null, department, jobRole: null,
    unassigned: true,
    ams, directEmployees: [], directTls: [],
    employeeCount: ams.reduce((sum, am) => sum + am.employeeCount, 0),
  }));
}
