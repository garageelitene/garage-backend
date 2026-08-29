const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { requireAuth, requireStaff, requirePermission } = require('../middleware/auth');

const router = express.Router();
const SALT_ROUNDS = 12;
const ROLES = ['admin', 'conseiller', 'mecanicien', 'carrossier'];

// ------------------------------------------------------------
// GET /backoffice/permissions — liste de toutes les permissions existantes
// ------------------------------------------------------------
router.get('/permissions', requireAuth, requirePermission('staff.manage'), async (req, res) => {
  const result = await db.query('SELECT * FROM permissions ORDER BY permission_key');
  res.json(result.rows);
});

// ------------------------------------------------------------
// GET /backoffice/roles — chaque rôle avec ses permissions actuelles
// Le rôle "admin" est toujours affiché avec la totalité des permissions
// (accès maximum non modifiable, par conception).
// ------------------------------------------------------------
router.get('/roles', requireAuth, requirePermission('staff.manage'), async (req, res) => {
  const allPermissions = await db.query('SELECT permission_key FROM permissions');
  const out = {};
  for (const role of ROLES) {
    if (role === 'admin') {
      out[role] = { role, permissions: allPermissions.rows.map(p => p.permission_key), editable: false };
      continue;
    }
    const rp = await db.query('SELECT permission_key FROM role_permissions WHERE role = ?', [role]);
    out[role] = { role, permissions: rp.rows.map(p => p.permission_key), editable: true };
  }
  res.json(out);
});

// ------------------------------------------------------------
// PUT /backoffice/roles/:role/permissions — redéfinir les permissions d'un rôle
// Réservé aux admins. Le rôle "admin" ne peut pas être modifié : il garde
// toujours l'accès maximum (protection contre une mauvaise configuration
// qui bloquerait tout le monde, y compris les administrateurs).
// ------------------------------------------------------------
router.put('/roles/:role/permissions',
  requireAuth, requireStaff(['admin']),
  body('permissions').isArray(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { role } = req.params;
    if (role === 'admin') {
      return res.status(400).json({ error: "Le rôle administrateur dispose toujours de l'accès maximum et ne peut pas être restreint." });
    }
    if (!ROLES.includes(role)) return res.status(404).json({ error: 'Rôle inconnu.' });

    try {
      await db.query('DELETE FROM role_permissions WHERE role = ?', [role]);
      for (const key of req.body.permissions) {
        await db.query('INSERT IGNORE INTO role_permissions (role, permission_key) VALUES (?,?)', [role, key]);
      }
      await db.query(
        `INSERT INTO audit_log (id, actor_type, actor_id, action, entity, entity_id) VALUES (?,?,?,?,?,?)`,
        [crypto.randomUUID(), 'staff', req.user.id, 'update_role_permissions', 'role', role]
      );
      res.json({ message: `Permissions du rôle "${role}" mises à jour.` });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Erreur serveur.' });
    }
  }
);

// ------------------------------------------------------------
// GET /backoffice/staff — liste du personnel
// ------------------------------------------------------------
router.get('/staff', requireAuth, requirePermission('staff.manage'), async (req, res) => {
  const result = await db.query('SELECT id, email, full_name, role, active, created_at FROM staff ORDER BY full_name');
  res.json(result.rows);
});

// ------------------------------------------------------------
// POST /backoffice/staff — créer un compte membre du personnel
// Seul un administrateur peut créer un autre compte administrateur.
// ------------------------------------------------------------
router.post('/staff',
  requireAuth, requireStaff(['admin']),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 12 }).withMessage('Le mot de passe du personnel doit contenir au moins 12 caractères.'),
  body('full_name').trim().notEmpty(),
  body('role').isIn(ROLES),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password, full_name, role } = req.body;
    try {
      const existing = await db.query('SELECT id FROM staff WHERE email = ?', [email]);
      if (existing.rows.length) return res.status(400).json({ error: 'Un compte existe déjà avec cet email.' });

      const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
      const id = crypto.randomUUID();
      await db.query(
        'INSERT INTO staff (id, email, password_hash, full_name, role, active) VALUES (?,?,?,?,?,1)',
        [id, email, password_hash, full_name, role]
      );
      await db.query(
        `INSERT INTO audit_log (id, actor_type, actor_id, action, entity, entity_id) VALUES (?,?,?,?,?,?)`,
        [crypto.randomUUID(), 'staff', req.user.id, 'create_staff_account', 'staff', id]
      );
      res.status(201).json({ id, email, full_name, role });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Erreur serveur.' });
    }
  }
);

// ------------------------------------------------------------
// PUT /backoffice/staff/:id — modifier le rôle ou désactiver un compte
// ------------------------------------------------------------
router.put('/staff/:id', requireAuth, requireStaff(['admin']), async (req, res) => {
  const { role, active } = req.body;
  if (role && !ROLES.includes(role)) return res.status(400).json({ error: 'Rôle inconnu.' });

  if (req.params.id === req.user.id && active === false) {
    return res.status(400).json({ error: 'Vous ne pouvez pas désactiver votre propre compte.' });
  }

  await db.query(
    'UPDATE staff SET role = COALESCE(?, role), active = COALESCE(?, active) WHERE id = ?',
    [role || null, active === undefined ? null : (active ? 1 : 0), req.params.id]
  );
  await db.query(
    `INSERT INTO audit_log (id, actor_type, actor_id, action, entity, entity_id) VALUES (?,?,?,?,?,?)`,
    [crypto.randomUUID(), 'staff', req.user.id, 'update_staff_account', 'staff', req.params.id]
  );
  res.json({ message: 'Compte mis à jour.' });
});

module.exports = router;
