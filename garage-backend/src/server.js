require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const appointmentRoutes = require('./routes/appointments');
const backofficeRoutes = require('./routes/backoffice');
const contentPublicRoutes = require('./routes/content_public');
const contentAdminRoutes = require('./routes/content_admin');
const adminRoutes = require('./routes/admin');
const billingRoutes = require('./routes/billing');
const loyaltyRoutes = require('./routes/loyalty');
const referralRoutes = require('./routes/referral');
const vehicleRoutes = require('./routes/vehicles');

const app = express();

// --- Sécurité de base ---
app.use(helmet());                     // en-têtes HTTP sécurisés
app.use(cors({
  origin: ['https://garage-elite-ne.ch'], // à restreindre au(x) domaine(s) réel(s)
  credentials: true
}));
app.use(express.json({ limit: '2mb' }));

// Limite globale anti-abus (les routes sensibles ont en plus leur propre limite)
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 300 }));

// Force HTTPS en production (utile derrière un proxy Infomaniak)
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production' && req.headers['x-forwarded-proto'] !== 'https') {
    return res.redirect(301, `https://${req.headers.host}${req.url}`);
  }
  next();
});

// --- Routes ---
app.use('/auth', authRoutes);
app.use('/appointments', appointmentRoutes);
app.use('/backoffice', backofficeRoutes);           // /backoffice/login, /appointments, /sinistres
app.use('/backoffice', adminRoutes);                // /backoffice/roles, /staff, /permissions
app.use('/backoffice/content', contentAdminRoutes);  // /backoffice/content/banners, /news, /site-content
app.use('/content', contentPublicRoutes);            // /content/banners, /news, /languages (public)
app.use('/backoffice/billing', billingRoutes);       // /backoffice/billing/invoices, /catalog, /templates
app.use('/loyalty', loyaltyRoutes);                  // /loyalty/me, /loyalty/backoffice/:clientId
app.use('/referrals', referralRoutes);               // /referrals/my-code, /referrals/backoffice/list
app.use('/vehicles', vehicleRoutes);                 // /vehicles/lookup, /vehicles/backoffice/:id/notifications

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Gestion d'erreurs générique (ne jamais renvoyer la stack trace au client)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Une erreur est survenue.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API Garage Elite-Auto démarrée sur le port ${PORT}`));
