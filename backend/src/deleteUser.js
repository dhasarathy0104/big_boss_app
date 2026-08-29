import { withTransaction } from './db.js';

// Permanently removes an employee and everything that references their user
// row. No table here has ON DELETE CASCADE, so each dependent table is
// cleared explicitly, in a single transaction, before the user row itself —
// same set of tables the manual duplicate-employee merge touched by hand.
export async function deleteEmployeeCascade(employeeId) {
  await withTransaction(async (tx) => {
    await tx.prepare('DELETE FROM activity_events WHERE user_id = ?').run(employeeId);
    await tx.prepare('DELETE FROM screenshots WHERE user_id = ?').run(employeeId);
    await tx.prepare('DELETE FROM time_entries WHERE user_id = ?').run(employeeId);
    await tx.prepare('DELETE FROM attendance_records WHERE user_id = ?').run(employeeId);
    await tx.prepare('DELETE FROM leave_requests WHERE user_id = ?').run(employeeId);
    await tx.prepare('UPDATE tasks SET assignee_user_id = NULL WHERE assignee_user_id = ?').run(employeeId);
    await tx.prepare('DELETE FROM project_members WHERE user_id = ?').run(employeeId);
    await tx.prepare('DELETE FROM sessions WHERE user_id = ?').run(employeeId);
    await tx.prepare('DELETE FROM users WHERE id = ?').run(employeeId);
  });
}

// Removes a manager and everything they own directly (projects, tasks on
// those projects, category rules, invite links, sessions). Callers must
// check for remaining employees first — this does not touch other users'
// rows, so a manager with employees still attached would leave them
// pointing at a manager_id that no longer exists.
export async function deleteManagerCascade(managerId) {
  await withTransaction(async (tx) => {
    const projects = await tx.prepare('SELECT id FROM projects WHERE manager_id = ?').all(managerId);
    for (const p of projects) {
      await tx.prepare('DELETE FROM time_entries WHERE project_id = ?').run(p.id);
      await tx.prepare('DELETE FROM project_members WHERE project_id = ?').run(p.id);
      await tx.prepare('DELETE FROM tasks WHERE project_id = ?').run(p.id);
    }
    await tx.prepare('DELETE FROM projects WHERE manager_id = ?').run(managerId);
    await tx.prepare('DELETE FROM category_rules WHERE manager_id = ?').run(managerId);
    await tx.prepare('DELETE FROM invite_links WHERE manager_id = ?').run(managerId);
    await tx.prepare('DELETE FROM sessions WHERE user_id = ?').run(managerId);
    await tx.prepare('DELETE FROM users WHERE id = ?').run(managerId);
  });
}
