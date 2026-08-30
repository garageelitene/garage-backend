const jwt = require('jsonwebtoken');
const db = require('../db');

// Vérifie le token et attache l'utilisateur à req.user
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentification requise.' });
  }
  const token = header.split(' ')[1];
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session invalide ou expirée.' });
  }
}

// Autorise uniquement le staff (back-office), avec rôles optionnels
function requireStaff(allowedRoles = []) {
  return (req, res, next) => {
    if (req.user?.type !== 'staff') {
      return res.status(403).json({ error: 'Accès réservé au personnel du garage.' });
    }
    if (allowedRoles.length && !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Droits insuffisants pour cette action.' });
    }
    next();
  };
}

// Autorisation fine par permission. Le rôle "admin" a TOUJOURS accès
// (accès maximum, quelle que soit la table role_permissions) : c'est
// le seul rôle avec bypass total, volontairement, pour garantir qu'un
// administrateur ne peut jamais se retrouver bloqué par une permission
// mal configurée.
function requirePermission(permissionKey) {
  return async (req, res, next) => {
    if (req.user?.type !== 'staff') {
      return res.status(403).json({ error: 'Accès réservé au personnel du garage.' });
    }
    if (req.user.role === 'admin') return next(); // accès maximum, toujours

    try {
      const result = await db.query(
        'SELECT 1 FROM role_permissions WHERE role = ? AND permission_key = ? LIMIT 1',
        [req.user.role, permissionKey]
      );
      if (!result.rows.length) {
        return res.status(403).json({ error: `Permission manquante : ${permissionKey}.` });
      }
      next();
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Erreur serveur.' });
    }
  };
}

module.exports = { requireAuth, requireStaff, requirePermission };
