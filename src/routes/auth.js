const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto'); // crypto.randomUUID() sert aussi à générer les id CHAR(36)
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const db = require('../db');

const router = express.Router();

// Anti brute-force sur les routes sensibles
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 10,
  message: { error: 'Trop de tentatives, réessayez plus tard.' }
});

const SALT_ROUNDS = 12;

// ------------------------------------------------------------
// POST /auth/register — Inscription client
// ------------------------------------------------------------
router.post('/register',
  authLimiter,
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 10 }).withMessage('Le mot de passe doit contenir au moins 10 caractères.'),
  body('first_name').trim().notEmpty(),
  body('last_name').trim().notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password, first_name, last_name, phone, preferred_language } = req.body;

    try {
      const existing = await db.query('SELECT id FROM clients WHERE email = ?', [email]);
      if (existing.rows.length) {
        // Réponse volontairement générique pour ne pas révéler quels emails existent
        return res.status(400).json({ error: "Impossible de créer ce compte avec ces informations." });
      }

      const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
      const id = crypto.randomUUID();
      await db.query(
        `INSERT INTO clients (id, email, password_hash, first_name, last_name, phone, preferred_language)
         VALUES (?,?,?,?,?,?,?)`,
        [id, email, password_hash, first_name, last_name, phone || null, preferred_language || 'fr']
      );

      // Parrainage optionnel : si un code valide est fourni, on crée le lien (statut "pending",
      // qualifié plus tard par le back-office après le 1er rendez-vous du filleul).
      if (req.body.referral_code) {
        const referrer = await db.query('SELECT client_id FROM referral_codes WHERE code = ?', [req.body.referral_code.toUpperCase()]);
        if (referrer.rows.length && referrer.rows[0].client_id !== id) {
          await db.query(
            'INSERT INTO referrals (id, referrer_client_id, referred_client_id, code_used, status) VALUES (?,?,?,?,\'pending\')',
            [crypto.randomUUID(), referrer.rows[0].client_id, id, req.body.referral_code.toUpperCase()]
          );
        }
      }

      // TODO: envoyer un email de vérification (SMTP configuré dans .env)

      res.status(201).json({ message: 'Compte créé. Vérifiez votre email.', client: { id, email, first_name, last_name } });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Erreur serveur.' });
    }
  }
);

// ------------------------------------------------------------
// POST /auth/login
// ------------------------------------------------------------
router.post('/login', authLimiter, body('email').isEmail(), body('password').notEmpty(), async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await db.query('SELECT * FROM clients WHERE email = ?', [email]);
    const client = result.rows[0];

    // Message générique volontaire (ne pas révéler si l'email existe)
    const genericError = () => res.status(401).json({ error: 'Email ou mot de passe incorrect.' });

    if (!client) return genericError();

    // Verrouillage temporaire après tentatives échouées répétées
    if (client.locked_until && new Date(client.locked_until) > new Date()) {
      return res.status(423).json({ error: 'Compte temporairement verrouillé suite à plusieurs échecs. Réessayez plus tard.' });
    }

    const valid = await bcrypt.compare(password, client.password_hash);
    if (!valid) {
      const failedCount = (client.failed_login_count || 0) + 1;
      const lockUntil = failedCount >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
      await db.query(
        'UPDATE clients SET failed_login_count = ?, locked_until = ? WHERE id = ?',
        [failedCount, lockUntil, client.id]
      );
      return genericError();
    }

    // Connexion réussie : reset du compteur
    await db.query('UPDATE clients SET failed_login_count = 0, locked_until = NULL WHERE id = ?', [client.id]);

    const token = jwt.sign(
      { id: client.id, type: 'client', email: client.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '2h' }
    );

    res.json({
      token,
      client: { id: client.id, email: client.email, first_name: client.first_name, last_name: client.last_name }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ------------------------------------------------------------
// POST /auth/forgot-password — Demande de réinitialisation
// ------------------------------------------------------------
router.post('/forgot-password', authLimiter, body('email').isEmail(), async (req, res) => {
  const { email } = req.body;
  try {
    const result = await db.query('SELECT id FROM clients WHERE email = ?', [email]);

    // Toujours la même réponse, que l'email existe ou non (anti-énumération)
    const genericResponse = { message: "Si un compte existe avec cet email, un lien de réinitialisation a été envoyé." };

    if (!result.rows.length) return res.json(genericResponse);

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1h

    await db.query(
      'UPDATE clients SET reset_token_hash = ?, reset_token_expires = ? WHERE id = ?',
      [tokenHash, expires, result.rows[0].id]
    );

    // TODO: envoyer rawToken par email (jamais le hash), ex:
    // https://garage-elite-ne.ch/reset-password?token=rawToken

    res.json(genericResponse);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ------------------------------------------------------------
// POST /auth/reset-password — Application du nouveau mot de passe
// ------------------------------------------------------------
router.post('/reset-password',
  authLimiter,
  body('token').notEmpty(),
  body('new_password').isLength({ min: 10 }),
  async (req, res) => {
    const { token, new_password } = req.body;
    try {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const result = await db.query(
        'SELECT id FROM clients WHERE reset_token_hash = ? AND reset_token_expires > now()',
        [tokenHash]
      );

      if (!result.rows.length) {
        return res.status(400).json({ error: 'Lien invalide ou expiré.' });
      }

      const password_hash = await bcrypt.hash(new_password, SALT_ROUNDS);
      await db.query(
        `UPDATE clients SET password_hash = ?, reset_token_hash = NULL, reset_token_expires = NULL,
         failed_login_count = 0, locked_until = NULL WHERE id = ?`,
        [password_hash, result.rows[0].id]
      );

      res.json({ message: 'Mot de passe mis à jour avec succès.' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Erreur serveur.' });
    }
  }
);

module.exports = router;
