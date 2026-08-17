import { Router } from 'express';
import { db } from '../db.js';
import { DEFAULT_RULES } from '../productivity.js';

export const categoryRulesRouter = Router();

const CATEGORIES = ['productive', 'neutral', 'unproductive'];

// So the dashboard can show what's already classified before a manager overrides anything.
categoryRulesRouter.get('/defaults', (req, res) => {
  res.json(Object.entries(DEFAULT_RULES).map(([appPattern, rule]) => ({ appPattern, ...rule })));
});

categoryRulesRouter.get('/', (req, res) => {
  const { managerId } = req.query;
  if (!managerId) return res.status(400).json({ error: 'managerId required' });
  res.json(db.prepare('SELECT * FROM category_rules WHERE manager_id = ? ORDER BY app_pattern').all(managerId));
});

categoryRulesRouter.post('/', (req, res) => {
  const { managerId, appPattern, category, isEngagedApp } = req.body;
  if (!managerId || !appPattern?.trim() || !CATEGORIES.includes(category)) {
    return res.status(400).json({ error: `managerId, appPattern, and category (one of ${CATEGORIES.join(', ')}) required` });
  }
  db.prepare(`
    INSERT INTO category_rules (manager_id, app_pattern, category, is_engaged_app)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(manager_id, app_pattern) DO UPDATE SET category = excluded.category, is_engaged_app = excluded.is_engaged_app
  `).run(managerId, appPattern.trim().toLowerCase(), category, isEngagedApp ? 1 : 0);

  res.json(db.prepare('SELECT * FROM category_rules WHERE manager_id = ? AND app_pattern = ?').get(managerId, appPattern.trim().toLowerCase()));
});

categoryRulesRouter.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM category_rules WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});
