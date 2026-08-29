const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { requireAuth, requireStaff } = require('../middleware/auth');

const router = express.Router();
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

// ------------------------------------------------------------
// POST /backoffice/login — Connexion staff (séparée des clients)
// ------------------------------------------------------------
router.post('/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await db.query('SELECT * FROM staff WHERE email=? AND active=true', [email]);
    const staff = result.rows[0];
    if (!staff) return res.status(401).json({ error: 'Identifiants incorrects.' });

    const valid = await bcrypt.compare(password, staff.password_hash);
    if (!valid) return res.status(401).json({ error: 'Identifiants incorrects.' });

    const token = jwt.sign(
      { id: staff.id, type: 'staff', role: staff.role, email: staff.email },
      process.env.JWT_SECRET,
      { expiresIn: '8h' } // session plus courte pour le back-office
    );

    res.json({ token, staff: { id: staff.id, full_name: staff.full_name, role: staff.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ------------------------------------------------------------
// GET /backoffice/appointments?date=YYYY-MM-DD — Vue calendrier du jour
// ------------------------------------------------------------
router.get('/appointments', requireAuth, requireStaff(), async (req, res) => {
  const { date } = req.query;
  try {
    const query = date
      ? `SELECT a.*, c.first_name, c.last_name, c.phone, cv.plate_number, cv.brand, cv.model, sc.name_fr
         FROM appointments a
         JOIN clients c ON c.id = a.client_id
         LEFT JOIN client_vehicles cv ON cv.id = a.vehicle_id
         JOIN service_categories sc ON sc.id = a.category_id
         WHERE a.DATE(scheduled_at) = ? ORDER BY a.scheduled_at ASC`
      : `SELECT a.*, c.first_name, c.last_name, c.phone, cv.plate_number, cv.brand, cv.model, sc.name_fr
         FROM appointments a
         JOIN clients c ON c.id = a.client_id
         LEFT JOIN client_vehicles cv ON cv.id = a.vehicle_id
         JOIN service_categories sc ON sc.id = a.category_id
         WHERE a.scheduled_at >= now() ORDER BY a.scheduled_at ASC LIMIT 100`;

    const result = await db.query(query, date ? [date] : []);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ------------------------------------------------------------
// POST /backoffice/appointments/:id/confirm — Confirmer un RDV + assigner un employé
// ------------------------------------------------------------
router.post('/appointments/:id/confirm', requireAuth, requireStaff(), async (req, res) => {
  const { staff_id } = req.body; // technicien assigné (optionnel)
  try {
    const appt = await db.query('SELECT * FROM appointments WHERE id=?', [req.params.id]);
    if (!appt.rows.length) return res.status(404).json({ error: 'Rendez-vous introuvable.' });

    await db.query(
      `UPDATE appointments SET status='confirmed', staff_id=COALESCE(?, staff_id) WHERE id=?`,
      [staff_id || null, req.params.id]
    );
    await db.query(
      `INSERT INTO appointment_status_log (id, appointment_id, old_status, new_status, changed_by, changed_by_id)
       VALUES (?,?,?,'confirmed','staff',?)`,
      [crypto.randomUUID(), req.params.id, appt.rows[0].status, req.user.id]
    );

    // TODO: envoyer la confirmation par email/SMS au client

    res.json({ message: 'Rendez-vous confirmé.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ------------------------------------------------------------
// GET /backoffice/sinistres — Liste des déclarations de sinistre
// ------------------------------------------------------------
router.get('/sinistres', requireAuth, requireStaff(), async (req, res) => {
  try {
    const result = await db.query(
      `SELECT s.*, c.first_name, c.last_name, c.phone
       FROM sinistre_reports s JOIN clients c ON c.id = s.client_id
       ORDER BY s.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
