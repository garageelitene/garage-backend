const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { creditLoyaltyPoints } = require('./loyalty_helpers');

const router = express.Router();

function generateCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase(); // ex: "A1B2C3D4"
}

// ============================================================
// CÔTÉ CLIENT
// ============================================================

// GET /referrals/my-code — récupère (ou crée) le code de parrainage du client connecté
router.get('/my-code', requireAuth, async (req, res) => {
  if (req.user.type !== 'client') return res.status(403).json({ error: 'Réservé aux clients.' });

  let existing = await db.query('SELECT code FROM referral_codes WHERE client_id = ?', [req.user.id]);
  if (!existing.rows.length) {
    const code = generateCode();
    await db.query('INSERT INTO referral_codes (client_id, code) VALUES (?, ?)', [req.user.id, code]);
    existing = { rows: [{ code }] };
  }
  res.json({ code: existing.rows[0].code });
});

// GET /referrals/my-referrals — liste des filleuls du client connecté
router.get('/my-referrals', requireAuth, async (req, res) => {
  if (req.user.type !== 'client') return res.status(403).json({ error: 'Réservé aux clients.' });
  const result = await db.query(
    `SELECT r.status, r.reward_points, r.created_at, r.qualified_at, c.first_name, c.last_name
     FROM referrals r JOIN clients c ON c.id = r.referred_client_id
     WHERE r.referrer_client_id = ? ORDER BY r.created_at DESC`,
    [req.user.id]
  );
  res.json(result.rows);
});

// ============================================================
// BACK-OFFICE
// ============================================================

// GET /backoffice/referrals — vue d'ensemble
router.get('/backoffice/list', requireAuth, requirePermission('referrals.manage'), async (req, res) => {
  const result = await db.query(
    `SELECT r.*, ref.first_name AS referrer_first_name, ref.last_name AS referrer_last_name,
            fil.first_name AS referred_first_name, fil.last_name AS referred_last_name
     FROM referrals r
     JOIN clients ref ON ref.id = r.referrer_client_id
     JOIN clients fil ON fil.id = r.referred_client_id
     ORDER BY r.created_at DESC`
  );
  res.json(result.rows);
});

// PUT /backoffice/referrals/:id/qualify — valide le parrainage (ex: après le 1er RDV du filleul)
// et crédite automatiquement les points au parrain.
router.put('/backoffice/:id/qualify', requireAuth, requirePermission('referrals.manage'), async (req, res) => {
  const referral = await db.query('SELECT * FROM referrals WHERE id = ?', [req.params.id]);
  if (!referral.rows.length) return res.status(404).json({ error: 'Parrainage introuvable.' });
  if (referral.rows[0].status !== 'pending') return res.status(400).json({ error: 'Ce parrainage a déjà été traité.' });

  const rule = await db.query("SELECT value FROM loyalty_rules WHERE rule_key = 'referral_reward_points'");
  const rewardPoints = Number(rule.rows[0]?.value || 50);

  await db.query(
    'UPDATE referrals SET status = "rewarded", reward_points = ?, qualified_at = NOW(), rewarded_at = NOW() WHERE id = ?',
    [rewardPoints, req.params.id]
  );
  await creditLoyaltyPoints(referral.rows[0].referrer_client_id, rewardPoints, 'referral_reward', 'referral', req.params.id, req.user.id);

  res.json({ message: `Parrainage validé, ${rewardPoints} points crédités au parrain.` });
});

module.exports = router;
