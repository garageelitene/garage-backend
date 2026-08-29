const express = require('express');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const MIN_HOURS_BEFORE_CHANGE = 48;

function hoursUntil(date) {
  return (new Date(date).getTime() - Date.now()) / (1000 * 60 * 60);
}

// ------------------------------------------------------------
// GET /appointments/availability?category_id=&date=YYYY-MM-DD
// Créneaux disponibles pour une catégorie de service à une date donnée
// ------------------------------------------------------------
router.get('/availability', async (req, res) => {
  const { category_id, date } = req.query;
  if (!category_id || !date) {
    return res.status(400).json({ error: 'category_id et date sont requis.' });
  }
  try {
    const category = await db.query('SELECT * FROM service_categories WHERE id = ?', [category_id]);
    if (!category.rows.length) return res.status(404).json({ error: 'Catégorie inconnue.' });

    const duration = category.rows[0].default_duration_minutes;

    // Horaires d'ouverture (simplifié — à affiner selon jour de semaine)
    const OPENING = { start: '07:30', lunchEnd: '13:30', end: '17:30' };

    const existing = await db.query(
      `SELECT scheduled_at, duration_minutes FROM appointments
       WHERE DATE(scheduled_at) = ? AND status IN ('pending','confirmed')`,
      [date]
    );

    // Génère les créneaux possibles par pas de 30 min et retire ceux déjà pris
    const slots = [];
    const [sh, sm] = OPENING.start.split(':').map(Number);
    const [eh, em] = OPENING.end.split(':').map(Number);
    let cursor = new Date(`${date}T${OPENING.start}:00`);
    const dayEnd = new Date(`${date}T${OPENING.end}:00`);

    while (cursor < dayEnd) {
      const slotEnd = new Date(cursor.getTime() + duration * 60000);
      const overlaps = existing.rows.some(a => {
        const aStart = new Date(a.scheduled_at);
        const aEnd = new Date(aStart.getTime() + a.duration_minutes * 60000);
        return cursor < aEnd && slotEnd > aStart;
      });
      if (!overlaps && slotEnd <= dayEnd && hoursUntil(cursor) > 1) {
        slots.push(cursor.toISOString());
      }
      cursor = new Date(cursor.getTime() + 30 * 60000);
    }

    res.json({ date, category: category.rows[0].code, duration_minutes: duration, slots });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ------------------------------------------------------------
// POST /appointments — Prise de rendez-vous (client connecté)
// ------------------------------------------------------------
router.post('/',
  requireAuth,
  body('category_id').isInt(),
  body('scheduled_at').isISO8601(),
  body('vehicle_id').optional().isUUID(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    if (req.user.type !== 'client') return res.status(403).json({ error: 'Réservé aux clients.' });

    const { category_id, scheduled_at, vehicle_id, notes } = req.body;

    if (hoursUntil(scheduled_at) < 1) {
      return res.status(400).json({ error: 'Ce créneau n\'est plus disponible.' });
    }

    try {
      const category = await db.query('SELECT default_duration_minutes FROM service_categories WHERE id=?', [category_id]);
      if (!category.rows.length) return res.status(404).json({ error: 'Catégorie inconnue.' });
      const duration = category.rows[0].default_duration_minutes;

      // Vérifie que le véhicule appartient bien au client (si fourni)
      if (vehicle_id) {
        const vehicle = await db.query('SELECT id FROM client_vehicles WHERE id=? AND client_id=?', [vehicle_id, req.user.id]);
        if (!vehicle.rows.length) return res.status(403).json({ error: 'Véhicule non associé à ce compte.' });
      }

      const id = crypto.randomUUID();
      await db.query(
        `INSERT INTO appointments (id, client_id, vehicle_id, category_id, scheduled_at, duration_minutes, notes, status)
         VALUES (?,?,?,?,?,?,?,'pending')`,
        [id, req.user.id, vehicle_id || null, category_id, scheduled_at, duration, notes || null]
      );
      const created = await db.query('SELECT * FROM appointments WHERE id = ?', [id]);

      // TODO: envoyer email/SMS de confirmation au client + notifier le back-office

      res.status(201).json({ message: 'Rendez-vous enregistré, en attente de confirmation.', appointment: created.rows[0] });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Erreur serveur.' });
    }
  }
);

// ------------------------------------------------------------
// GET /appointments/mine — Mes rendez-vous
// ------------------------------------------------------------
router.get('/mine', requireAuth, async (req, res) => {
  if (req.user.type !== 'client') return res.status(403).json({ error: 'Réservé aux clients.' });
  try {
    const result = await db.query(
      `SELECT a.*, sc.name_fr, sc.name_de, sc.name_en
       FROM appointments a JOIN service_categories sc ON sc.id = a.category_id
       WHERE a.client_id = ? ORDER BY a.scheduled_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ------------------------------------------------------------
// POST /appointments/:id/cancel — Annulation (règle des 48h)
// ------------------------------------------------------------
router.post('/:id/cancel', requireAuth, async (req, res) => {
  try {
    const appt = await db.query('SELECT * FROM appointments WHERE id=? AND client_id=?', [req.params.id, req.user.id]);
    if (!appt.rows.length) return res.status(404).json({ error: 'Rendez-vous introuvable.' });

    const appointment = appt.rows[0];
    if (['cancelled', 'completed'].includes(appointment.status)) {
      return res.status(400).json({ error: 'Ce rendez-vous ne peut plus être annulé.' });
    }

    if (hoursUntil(appointment.scheduled_at) < MIN_HOURS_BEFORE_CHANGE) {
      return res.status(400).json({
        error: `Annulation impossible : le délai minimum de ${MIN_HOURS_BEFORE_CHANGE}h avant le rendez-vous est dépassé. Merci de contacter le garage directement au 032 725 50 60.`
      });
    }

    await db.query(
      `UPDATE appointments SET status='cancelled', cancelled_at=now(), cancellation_reason=? WHERE id=?`,
      [req.body.reason || 'Annulé par le client', appointment.id]
    );
    await db.query(
      `INSERT INTO appointment_status_log (id, appointment_id, old_status, new_status, changed_by, changed_by_id)
       VALUES (?,?,?,'cancelled','client',?)`,
      [crypto.randomUUID(), appointment.id, appointment.status, req.user.id]
    );

    res.json({ message: 'Rendez-vous annulé.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ------------------------------------------------------------
// POST /appointments/:id/reschedule — Déplacement (règle des 48h)
// ------------------------------------------------------------
router.post('/:id/reschedule', requireAuth, body('new_scheduled_at').isISO8601(), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const appt = await db.query('SELECT * FROM appointments WHERE id=? AND client_id=?', [req.params.id, req.user.id]);
    if (!appt.rows.length) return res.status(404).json({ error: 'Rendez-vous introuvable.' });

    const appointment = appt.rows[0];
    if (['cancelled', 'completed'].includes(appointment.status)) {
      return res.status(400).json({ error: 'Ce rendez-vous ne peut plus être modifié.' });
    }

    if (hoursUntil(appointment.scheduled_at) < MIN_HOURS_BEFORE_CHANGE) {
      return res.status(400).json({
        error: `Déplacement impossible : le délai minimum de ${MIN_HOURS_BEFORE_CHANGE}h avant le rendez-vous est dépassé. Merci de contacter le garage directement au 032 725 50 60.`
      });
    }

    if (hoursUntil(req.body.new_scheduled_at) < 1) {
      return res.status(400).json({ error: 'Le nouveau créneau doit être dans le futur.' });
    }

    await db.query(
      `UPDATE appointments SET scheduled_at=?, status='pending', reschedule_count = reschedule_count + 1
       WHERE id=?`,
      [req.body.new_scheduled_at, appointment.id]
    );
    await db.query(
      `INSERT INTO appointment_status_log (id, appointment_id, old_status, new_status, changed_by, changed_by_id)
       VALUES (?,?,?,'pending','client',?)`,
      [crypto.randomUUID(), appointment.id, appointment.status, req.user.id]
    );

    // TODO: notifier le back-office + envoyer nouvelle confirmation au client

    res.json({ message: 'Rendez-vous déplacé, en attente de reconfirmation.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
