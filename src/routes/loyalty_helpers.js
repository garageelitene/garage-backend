const crypto = require('crypto');
const db = require('../db');

/**
 * Crédite (ou débite) des points de fidélité pour un client et journalise
 * la transaction. Utilisé par : paiement de facture, récompense de parrainage,
 * ajustement manuel en back-office.
 */
async function creditLoyaltyPoints(clientId, points, reason, relatedType = null, relatedId = null, createdBy = null) {
  if (!points) return;

  const existing = await db.query('SELECT client_id FROM loyalty_accounts WHERE client_id = ?', [clientId]);
  if (!existing.rows.length) {
    await db.query('INSERT INTO loyalty_accounts (client_id, points_balance) VALUES (?, 0)', [clientId]);
  }

  await db.query('UPDATE loyalty_accounts SET points_balance = points_balance + ? WHERE client_id = ?', [points, clientId]);
  await db.query(
    `INSERT INTO loyalty_transactions (id, client_id, points, reason, related_type, related_id, created_by)
     VALUES (?,?,?,?,?,?,?)`,
    [crypto.randomUUID(), clientId, points, reason, relatedType, relatedId, createdBy]
  );

  // Mise à jour simple du palier de fidélité
  const balance = await db.query('SELECT points_balance FROM loyalty_accounts WHERE client_id = ?', [clientId]);
  const bal = balance.rows[0].points_balance;
  const tier = bal >= 2000 ? 'or' : bal >= 500 ? 'argent' : 'standard';
  await db.query('UPDATE loyalty_accounts SET tier = ? WHERE client_id = ?', [tier, clientId]);
}

module.exports = { creditLoyaltyPoints };
