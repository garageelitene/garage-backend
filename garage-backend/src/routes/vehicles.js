const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();

// ============================================================
// CÔTÉ CLIENT
// ============================================================

// GET /vehicles/lookup?plate=NE123456
// Le client ne peut consulter que ses PROPRES véhicules (vérifié via client_id).
router.get('/lookup', requireAuth, async (req, res) => {
  if (req.user.type !== 'client') return res.status(403).json({ error: 'Réservé aux clients.' });
  const plate = (req.query.plate || '').trim();
  if (!plate) return res.status(400).json({ error: 'Le paramètre "plate" est requis.' });

  const vehicle = await db.query(
    'SELECT * FROM client_vehicles WHERE client_id = ? AND plate_number = ?',
    [req.user.id, plate]
  );
  if (!vehicle.rows.length) {
    return res.status(404).json({ error: "Aucun véhicule avec cette immatriculation n'est associé à votre compte." });
  }
  const v = vehicle.rows[0];

  const appointments = await db.query(
    `SELECT a.id, a.scheduled_at, a.status, sc.name_fr, sc.name_de, sc.name_it, sc.name_en
     FROM appointments a JOIN service_categories sc ON sc.id = a.category_id
     WHERE a.vehicle_id = ? ORDER BY a.scheduled_at DESC`,
    [v.id]
  );

  const notifications = await db.query(
    'SELECT * FROM vehicle_notifications WHERE vehicle_id = ? ORDER BY created_at DESC LIMIT 20',
    [v.id]
  );

  res.json({
    vehicle: v,
    next_service: { due_date: v.next_service_due_date, due_km: v.next_service_due_km },
    appointments: appointments.rows,
    notifications: notifications.rows
  });
});

// GET /vehicles/notifications — toutes les notifications du client, tous véhicules confondus
router.get('/notifications', requireAuth, async (req, res) => {
  if (req.user.type !== 'client') return res.status(403).json({ error: 'Réservé aux clients.' });
  const result = await db.query(
    `SELECT n.*, cv.plate_number, cv.brand, cv.model
     FROM vehicle_notifications n JOIN client_vehicles cv ON cv.id = n.vehicle_id
     WHERE n.client_id = ? ORDER BY n.created_at DESC LIMIT 50`,
    [req.user.id]
  );
  res.json(result.rows);
});

// PUT /vehicles/notifications/:id/read
router.put('/notifications/:id/read', requireAuth, async (req, res) => {
  if (req.user.type !== 'client') return res.status(403).json({ error: 'Réservé aux clients.' });
  await db.query('UPDATE vehicle_notifications SET read_at = NOW() WHERE id = ? AND client_id = ?', [req.params.id, req.user.id]);
  res.json({ message: 'Notification marquée comme lue.' });
});

// ============================================================
// BACK-OFFICE
// ============================================================

// PUT /backoffice/vehicles/:id/next-service — définir la prochaine échéance d'entretien
router.put('/backoffice/:id/next-service', requireAuth, requirePermission('vehicle_notifications.manage'), async (req, res) => {
  const { due_date, due_km } = req.body;
  await db.query('UPDATE client_vehicles SET next_service_due_date = ?, next_service_due_km = ? WHERE id = ?', [due_date || null, due_km || null, req.params.id]);
  res.json({ message: 'Prochaine échéance mise à jour.' });
});

// POST /backoffice/vehicles/:id/notifications — informer le client (pièce changée, rappel, info spéciale)
router.post('/backoffice/:id/notifications', requireAuth, requirePermission('vehicle_notifications.manage'), async (req, res) => {
  const { type, title, message } = req.body;
  if (!['part_replaced', 'service_due', 'special', 'appointment_update'].includes(type)) {
    return res.status(400).json({ error: 'Type de notification invalide.' });
  }
  if (!title) return res.status(400).json({ error: 'Un titre est requis.' });

  const vehicle = await db.query('SELECT client_id FROM client_vehicles WHERE id = ?', [req.params.id]);
  if (!vehicle.rows.length) return res.status(404).json({ error: 'Véhicule introuvable.' });

  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO vehicle_notifications (id, vehicle_id, client_id, type, title, message, created_by)
     VALUES (?,?,?,?,?,?,?)`,
    [id, req.params.id, vehicle.rows[0].client_id, type, title, message || null, req.user.id]
  );

  // TODO: notifier aussi par email/SMS immédiatement (SMTP configuré)

  res.status(201).json({ id, message: 'Notification envoyée au client.' });
});

module.exports = router;
