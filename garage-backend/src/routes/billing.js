const express = require('express');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { buildInvoicePdf } = require('../utils/invoicePdf');
const { sendEmailWithAttachment } = require('../utils/mailer');

const router = express.Router();
const STANDARD_VAT = 8.10; // taux TVA standard suisse en vigueur

async function nextInvoiceNumber() {
  const year = new Date().getFullYear();
  const result = await db.query(
    "SELECT COUNT(*) AS n FROM invoices WHERE invoice_number LIKE ?",
    [`${year}-%`]
  );
  const seq = (result.rows[0].n || 0) + 1;
  return `${year}-${String(seq).padStart(6, '0')}`;
}

async function loadInvoiceFull(id) {
  const inv = await db.query('SELECT * FROM invoices WHERE id = ?', [id]);
  if (!inv.rows.length) return null;
  const items = await db.query('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order', [id]);
  const client = await db.query('SELECT first_name, last_name, email, address, postal_code, city FROM clients WHERE id = ?', [inv.rows[0].client_id]);
  const template = inv.rows[0].template_id
    ? (await db.query('SELECT * FROM invoice_templates WHERE id = ?', [inv.rows[0].template_id])).rows[0]
    : (await db.query('SELECT * FROM invoice_templates WHERE is_default = 1 LIMIT 1')).rows[0];
  return { invoice: inv.rows[0], items: items.rows, client: client.rows[0], template };
}

// ============================================================
// CATALOGUE DE PIÈCES / SERVICES (modèles réutilisables sur les factures)
// ============================================================

router.get('/catalog', requireAuth, requirePermission('billing_catalog.manage'), async (req, res) => {
  const result = await db.query('SELECT * FROM billing_catalog WHERE active = 1 ORDER BY type, label_fr');
  res.json(result.rows);
});

router.post('/catalog',
  requireAuth, requirePermission('billing_catalog.manage'),
  body('label_fr').notEmpty(), body('unit_price_chf').isFloat({ min: 0 }), body('type').isIn(['piece', 'service']),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const id = crypto.randomUUID();
    const { type, reference, label_fr, label_de, label_it, label_en, unit_price_chf, default_vat_rate = STANDARD_VAT } = req.body;
    await db.query(
      `INSERT INTO billing_catalog (id, type, reference, label_fr, label_de, label_it, label_en, unit_price_chf, default_vat_rate)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, type, reference || null, label_fr, label_de || null, label_it || null, label_en || null, unit_price_chf, default_vat_rate]
    );
    res.status(201).json({ id });
  }
);

router.put('/catalog/:id', requireAuth, requirePermission('billing_catalog.manage'), async (req, res) => {
  const { label_fr, label_de, label_it, label_en, unit_price_chf, default_vat_rate, active } = req.body;
  await db.query(
    `UPDATE billing_catalog SET
       label_fr = COALESCE(?, label_fr), label_de = ?, label_it = ?, label_en = ?,
       unit_price_chf = COALESCE(?, unit_price_chf), default_vat_rate = COALESCE(?, default_vat_rate),
       active = COALESCE(?, active)
     WHERE id = ?`,
    [label_fr || null, label_de ?? null, label_it ?? null, label_en ?? null, unit_price_chf ?? null, default_vat_rate ?? null,
     active === undefined ? null : (active ? 1 : 0), req.params.id]
  );
  res.json({ message: 'Modèle mis à jour.' });
});

router.delete('/catalog/:id', requireAuth, requirePermission('billing_catalog.manage'), async (req, res) => {
  await db.query('UPDATE billing_catalog SET active = 0 WHERE id = ?', [req.params.id]);
  res.json({ message: 'Modèle désactivé.' });
});

// ============================================================
// MODÈLES DE MISE EN PAGE DE FACTURE
// ============================================================

router.get('/templates', requireAuth, requirePermission('billing_catalog.manage'), async (req, res) => {
  const result = await db.query('SELECT * FROM invoice_templates ORDER BY is_default DESC, name');
  res.json(result.rows);
});

router.post('/templates', requireAuth, requirePermission('billing_catalog.manage'), body('name').notEmpty(), async (req, res) => {
  const id = crypto.randomUUID();
  const { name, logo_url, accent_color, footer_text } = req.body;
  await db.query(
    'INSERT INTO invoice_templates (id, name, logo_url, accent_color, footer_text) VALUES (?,?,?,?,?)',
    [id, name, logo_url || null, accent_color || '#D62828', footer_text || null]
  );
  res.status(201).json({ id });
});

router.put('/templates/:id', requireAuth, requirePermission('billing_catalog.manage'), async (req, res) => {
  const { name, logo_url, accent_color, footer_text, is_default } = req.body;
  if (is_default) {
    await db.query('UPDATE invoice_templates SET is_default = 0'); // un seul modèle par défaut à la fois
  }
  await db.query(
    `UPDATE invoice_templates SET
       name = COALESCE(?, name), logo_url = ?, accent_color = COALESCE(?, accent_color),
       footer_text = ?, is_default = COALESCE(?, is_default)
     WHERE id = ?`,
    [name || null, logo_url ?? null, accent_color || null, footer_text ?? null,
     is_default === undefined ? null : (is_default ? 1 : 0), req.params.id]
  );
  res.json({ message: 'Modèle de mise en page mis à jour.' });
});

// ============================================================
// FACTURES
// ============================================================

// GET /backoffice/billing/invoices?status=&client_id=
router.get('/invoices', requireAuth, requirePermission('invoices.create'), async (req, res) => {
  const clauses = [];
  const params = [];
  if (req.query.status) { clauses.push('i.status = ?'); params.push(req.query.status); }
  if (req.query.client_id) { clauses.push('i.client_id = ?'); params.push(req.query.client_id); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await db.query(
    `SELECT i.*, c.first_name, c.last_name, c.email
     FROM invoices i JOIN clients c ON c.id = i.client_id
     ${where} ORDER BY i.created_at DESC LIMIT 200`,
    params
  );
  res.json(result.rows);
});

// GET /backoffice/billing/invoices/:id — détail + lignes
router.get('/invoices/:id', requireAuth, requirePermission('invoices.create'), async (req, res) => {
  const data = await loadInvoiceFull(req.params.id);
  if (!data) return res.status(404).json({ error: 'Facture introuvable.' });
  res.json(data);
});

// POST /backoffice/billing/invoices — créer une facture avec ses lignes
// Règle TVA : si is_export = true OU billing_country != 'CH', toutes les lignes passent à 0% (art. 8 LTVA, prestation à l'export).
// Sinon, taux standard suisse 8.10% par défaut (ou taux fourni par ligne, ex. 0% pour une prestation exonérée).
router.post('/invoices',
  requireAuth, requirePermission('invoices.create'),
  body('client_id').isUUID(),
  body('items').isArray({ min: 1 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { client_id, appointment_id, billing_country = 'CH', lang_code = 'fr', template_id, items } = req.body;
    const isExport = billing_country !== 'CH';

    let subtotal = 0, vatTotal = 0;
    const preparedItems = items.map((it) => {
      const qty = Number(it.quantity ?? 1);
      const unitPrice = Number(it.unit_price_chf);
      const vatRate = isExport ? 0 : Number(it.vat_rate ?? STANDARD_VAT);
      const lineSubtotal = qty * unitPrice;
      const lineVat = lineSubtotal * (vatRate / 100);
      subtotal += lineSubtotal;
      vatTotal += lineVat;
      return { ...it, quantity: qty, unit_price_chf: unitPrice, vat_rate: vatRate, line_total_chf: lineSubtotal + lineVat };
    });

    try {
      const id = crypto.randomUUID();
      const invoice_number = await nextInvoiceNumber();
      const total = subtotal + vatTotal;

      await db.query(
        `INSERT INTO invoices
           (id, invoice_number, template_id, client_id, appointment_id, billing_country, is_export,
            subtotal_chf, vat_amount_chf, total_chf, amount_chf, lang_code, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'unpaid')`,
        [id, invoice_number, template_id || null, client_id, appointment_id || null, billing_country, isExport ? 1 : 0,
         subtotal.toFixed(2), vatTotal.toFixed(2), total.toFixed(2), total.toFixed(2), lang_code]
      );

      let sortOrder = 0;
      for (const it of preparedItems) {
        await db.query(
          `INSERT INTO invoice_items (id, invoice_id, catalog_id, description, quantity, unit_price_chf, vat_rate, line_total_chf, sort_order)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [crypto.randomUUID(), id, it.catalog_id || null, it.description, it.quantity, it.unit_price_chf, it.vat_rate, it.line_total_chf.toFixed(2), sortOrder++]
        );
      }

      res.status(201).json({ id, invoice_number, subtotal_chf: subtotal.toFixed(2), vat_amount_chf: vatTotal.toFixed(2), total_chf: total.toFixed(2) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Erreur serveur.' });
    }
  }
);

// PUT /backoffice/billing/invoices/:id/status — marquer payée/annulée/remboursée
// Le passage à "paid" crédite automatiquement les points de fidélité du client.
router.put('/invoices/:id/status', requireAuth, requirePermission('invoices.create'), async (req, res) => {
  const { status } = req.body;
  if (!['unpaid', 'paid', 'cancelled', 'refunded'].includes(status)) {
    return res.status(400).json({ error: 'Statut invalide.' });
  }
  const inv = await db.query('SELECT * FROM invoices WHERE id = ?', [req.params.id]);
  if (!inv.rows.length) return res.status(404).json({ error: 'Facture introuvable.' });

  await db.query('UPDATE invoices SET status = ?, paid_at = IF(? = "paid", NOW(), paid_at) WHERE id = ?', [status, status, req.params.id]);

  if (status === 'paid' && inv.rows[0].status !== 'paid') {
    const { creditLoyaltyPoints } = require('./loyalty_helpers');
    await creditLoyaltyPoints(inv.rows[0].client_id, Math.floor(Number(inv.rows[0].total_chf)), 'invoice_paid', 'invoice', inv.rows[0].id, req.user.id);
  }

  res.json({ message: `Facture marquée "${status}".` });
});

// GET /backoffice/billing/invoices/:id/pdf — génère et télécharge le PDF A4
router.get('/invoices/:id/pdf', requireAuth, requirePermission('invoices.create'), async (req, res) => {
  const data = await loadInvoiceFull(req.params.id);
  if (!data) return res.status(404).json({ error: 'Facture introuvable.' });

  try {
    const buffer = await buildInvoicePdf(data.invoice, data.items, data.client, data.template);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="facture-${data.invoice.invoice_number}.pdf"`);
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la génération du PDF.' });
  }
});

// POST /backoffice/billing/invoices/:id/send-email — génère le PDF et l'envoie directement au client
router.post('/invoices/:id/send-email', requireAuth, requirePermission('invoices.create'), async (req, res) => {
  const data = await loadInvoiceFull(req.params.id);
  if (!data) return res.status(404).json({ error: 'Facture introuvable.' });

  try {
    const buffer = await buildInvoicePdf(data.invoice, data.items, data.client, data.template);
    await sendEmailWithAttachment({
      to: data.client.email,
      subject: `Facture ${data.invoice.invoice_number} — Garage Elite-Auto`,
      text: `Bonjour ${data.client.first_name},\n\nVeuillez trouver ci-joint votre facture ${data.invoice.invoice_number}.\n\nGarage Elite-Auto DRN Sarl`,
      filename: `facture-${data.invoice.invoice_number}.pdf`,
      buffer
    });
    await db.query('UPDATE invoices SET sent_at = NOW() WHERE id = ?', [req.params.id]);
    res.json({ message: 'Facture envoyée par email au client.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Erreur lors de l'envoi de l'email." });
  }
});

module.exports = router;
