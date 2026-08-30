const express = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { creditLoyaltyPoints } = require('./loyalty_helpers');

const router = express.Router();

// ============================================================
// CÔTÉ CLIENT
// ============================================================

// GET /loyalty/me — solde, palier, historique récent
router.get('/me', requireAuth, async (req, res) => {
  if (req.user.type !== 'client') return res.status(403).json({ error: 'Réservé aux clients.' });

  const account = await db.query('SELECT * FROM loyalty_accounts WHERE client_id = ?', [req.user.id]);
  const history = await db.query(
    'SELECT points, reason, related_type, created_at FROM loyalty_transactions WHERE client_id = ? ORDER BY created_at DESC LIMIT 30',
    [req.user.id]
  );
  const rules = await db.query('SELECT rule_key, value FROM loyalty_rules');

  res.json({
    points_balance: account.rows[0]?.points_balance || 0,
    tier: account.rows[0]?.tier || 'standard',
    history: history.rows,
    rules: Object.fromEntries(rules.rows.map(r => [r.rule_key, r.value]))
  });
});

// ============================================================
// BACK-OFFICE
// ============================================================

// GET /backoffice/loyalty/:clientId
router.get('/backoffice/:clientId', requireAuth, requirePermission('loyalty.manage'), async (req, res) => {
  const account = await db.query('SELECT * FROM loyalty_accounts WHERE client_id = ?', [req.params.clientId]);
  const history = await db.query('SELECT * FROM loyalty_transactions WHERE client_id = ? ORDER BY created_at DESC', [req.params.clientId]);
  res.json({ account: account.rows[0] || { client_id: req.params.clientId, points_balance: 0, tier: 'standard' }, history: history.rows });
});

// POST /backoffice/loyalty/:clientId/adjust — ajustement manuel (positif ou négatif)
router.post('/backoffice/:clientId/adjust', requireAuth, requirePermission('loyalty.manage'), async (req, res) => {
  const { points, reason } = req.body;
  if (!points || !reason) return res.status(400).json({ error: 'points et reason sont requis.' });

  await creditLoyaltyPoints(req.params.clientId, Number(points), `manual: ${reason}`, 'manual_adjustment', null, req.user.id);
  res.json({ message: 'Points ajustés.' });
});

// GET/PUT /backoffice/loyalty-rules — règles du programme (points/CHF, valeur du point, etc.)
router.get('/backoffice-rules', requireAuth, requirePermission('loyalty.manage'), async (req, res) => {
  const result = await db.query('SELECT * FROM loyalty_rules');
  res.json(result.rows);
});

router.put('/backoffice-rules/:key', requireAuth, requirePermission('loyalty.manage'), async (req, res) => {
  await db.query('UPDATE loyalty_rules SET value = ? WHERE rule_key = ?', [req.body.value, req.params.key]);
  res.json({ message: 'Règle mise à jour.' });
});

module.exports = router;
