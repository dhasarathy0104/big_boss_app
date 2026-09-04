// Single source of truth for role slugs on the frontend — mirrors
// backend/src/hierarchy.js's ROLE_ORDER so the two never drift apart.
// Replaces four independent per-file ROLE_LABEL maps (JoinPage.jsx,
// SupervisorDashboard.jsx, SupervisorTeamView.jsx, SuperAdminDashboard.jsx)
// that had quietly gone out of sync with each other (two of the four
// abbreviated "General Manager"/"Assistant General Manager" down to
// "GM"/"AGM" while the other two spelled them out).
export const ROLE_ORDER = ['superadmin', 'gm', 'agm', 'manager', 'am', 'tl', 'employee'];

export const ROLE_LABEL = {
  superadmin: 'Super Admin',
  gm: 'General Manager',
  agm: 'Assistant General Manager',
  manager: 'Manager',
  am: 'Assistant Manager',
  tl: 'Team Lead',
  employee: 'Employee',
};

export function roleLabel(role) {
  return ROLE_LABEL[role] ?? role;
}

export function roleLevel(role) {
  return ROLE_ORDER.indexOf(role);
}

export function isSupervisorRole(role) {
  return ROLE_ORDER.includes(role) && role !== 'employee';
}

// Mirrors backend/src/hierarchy.js's roleAtOrAbove — used only to decide
// which controls to render (e.g. hide Billing for TL), never as the actual
// security boundary; the backend enforces the real check independently on
// every request regardless of what the UI shows.
export function roleAtOrAbove(role, thresholdRole) {
  const level = roleLevel(role);
  const threshold = roleLevel(thresholdRole);
  return level !== -1 && threshold !== -1 && level <= threshold;
}

// The roles that share the generalized SupervisorDashboard (see App.jsx) —
// everyone above Employee except Manager, which keeps its own richer
// dashboard (Projects/Billing/Category Rules aren't generalized yet). This
// is a UI-composition decision, not a hierarchy fact, so it's kept as its
// own explicit list rather than derived from ROLE_ORDER.
export const SUPERVISOR_DASHBOARD_ROLES = ['gm', 'agm', 'am', 'tl'];
