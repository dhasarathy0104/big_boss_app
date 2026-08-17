import { Router } from 'express';
import { db } from '../db.js';
import { DEFAULT_RULES, DEFAULT_DOMAIN_RULES } from '../productivity.js';

export const categoryRulesRouter = Router();

const CATEGORIES = ['productive', 'neutral', 'unproductive'];
const RULE_TYPES = ['app', 'domain'];

// So the dashboard can show what's already classified before a manager overrides anything.
categoryRulesRouter.get('/defaults', (req, res) => {
  res.json([
    ...Object.entries(DEFAULT_RULES).map(([appPattern, rule]) => ({ appPattern, ruleType: 'app', ...rule })),
    ...Object.entries(DEFAULT_DOMAIN_RULES).map(([appPattern, rule]) => ({ appPattern, ruleType: 'domain', ...rule })),
  ]);
});

categoryRulesRouter.get('/', (req, res) => {
  const { managerId } = req.query;
  if (!managerId) return res.status(400).json({ error: 'managerId required' });
  res.json(db.prepare('SELECT * FROM category_rules WHERE manager_id = ? ORDER BY rule_type, app_pattern').all(managerId));
});

categoryRulesRouter.post('/', (req, res) => {
  const { managerId, appPattern, category, isEngagedApp, ruleType } = req.body;
  const type = ruleType || 'app';
  if (!managerId || !appPattern?.trim() || !CATEGORIES.includes(category) || !RULE_TYPES.includes(type)) {
    return res.status(400).json({
      error: `managerId, appPattern, category (one of ${CATEGORIES.join(', ')}), and ruleType (one of ${RULE_TYPES.join(', ')}) required`,
    });
  }
  const pattern = appPattern.trim().toLowerCase();
  db.prepare(`
    INSERT INTO category_rules (manager_id, app_pattern, category, is_engaged_app, rule_type)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(manager_id, app_pattern) DO UPDATE SET category = excluded.category, is_engaged_app = excluded.is_engaged_app, rule_type = excluded.rule_type
  `).run(managerId, pattern, category, isEngagedApp ? 1 : 0, type);

  res.json(db.prepare('SELECT * FROM category_rules WHERE manager_id = ? AND app_pattern = ?').get(managerId, pattern));
});

categoryRulesRouter.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM category_rules WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});
