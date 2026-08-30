# Garage Elite-Auto — Backend (Base de données + Système de rendez-vous)

## Mise à jour : facturation TVA, parrainage, fidélité, notifications véhicule

Après `schema_mysql.sql` et `migrations/002_*.sql`, appliquez aussi :

```bash
mysql -h 601yx.myd.infomaniak.com -u 601yx_autoelite -p 601yx_autoduran < migrations/003_billing_referral_loyalty_vehicle.sql
```

**⚠️ Voir `SECURITE_ET_BACKOFFICE.md` en premier** — analyse de sécurité complète et guide pour créer votre premier compte administrateur et vous connecter au back-office.

### Facturation (`/backoffice/billing/*`)
- Catalogue de pièces/services réutilisables avec prix et taux de TVA par défaut (`billing_catalog`)
- Modèles de mise en page personnalisables : logo, couleur, texte de pied de page (`invoice_templates`)
- Création de facture avec calcul automatique de la TVA : **8.1% standard suisse** par défaut, **0%** si le pays de facturation n'est pas la Suisse (export, art. 8 LTVA) ou si une ligne est explicitement à 0%
- `GET /backoffice/billing/invoices/:id/pdf` — facture A4 générée à la volée
- `POST /backoffice/billing/invoices/:id/send-email` — génère le PDF et l'envoie directement au client par email

### Fidélité (`/loyalty/*`) et Parrainage (`/referrals/*`)
- 1 point par CHF payé (réglable via `loyalty_rules`), paliers standard/argent/or
- Chaque client a un code de parrainage personnel ; le filleul l'indique à l'inscription (`referral_code`) ; le back-office valide le parrainage après le 1er rendez-vous, ce qui crédite automatiquement des points au parrain

### Suivi véhicule par immatriculation (`/vehicles/*`)
- `GET /vehicles/lookup?plate=NE123456` — le client voit tous ses rendez-vous et sa prochaine échéance d'entretien pour ce véhicule
- Le back-office peut notifier le client (pièce changée, rappel d'entretien, information spéciale) via `POST /backoffice/vehicles/:id/notifications`

### Frontend : PWA, responsive, langue en menu déroulant
- Site installable sur smartphone/ordinateur (`manifest.json` + `service-worker.js`) — bannière d'installation automatique
- Sélecteur de langue transformé en menu déroulant compact (corrige aussi le débordement observé sur mobile)
- Corrections responsive : boutons empilés proprement sur petit écran, espacement réduit sur mobile
- Icônes réseaux sociaux ajoutées au pied de page (liens à personnaliser dans `build.py`)

## Contenu livré dans ce lot
- `schema.sql` — schéma PostgreSQL complet (clients, véhicules, rendez-vous, catalogue véhicules, leasing/location/abonnement, factures/paiements, sinistres, demandes d'immatriculation, journal d'audit)
- `src/routes/auth.js` — inscription, connexion, mot de passe oublié / réinitialisation
- `src/routes/appointments.js` — prise de RDV en ligne, mes rendez-vous, **annulation/déplacement avec la règle des 48h**
- `src/routes/backoffice.js` — connexion staff, vue calendrier, confirmation des RDV, liste des sinistres
- `src/server.js` — serveur Express avec sécurité de base (Helmet, CORS restreint, rate limiting, HTTPS forcé en prod)

## Installation

```bash
npm install
cp .env.example .env      # puis remplir les vraies valeurs (JAMAIS commiter .env)
psql $DATABASE_URL -f schema.sql
npm start
```

## Sécurité déjà en place
- Mots de passe hashés avec **bcrypt** (12 rounds), jamais stockés en clair
- Tokens de réinitialisation de mot de passe **hashés en base** (SHA-256), à usage unique, expirant après 1h
- Réponses **génériques** sur login/forgot-password pour empêcher l'énumération des comptes existants
- **Verrouillage temporaire** du compte après 5 échecs de connexion successifs (15 min)
- **Rate limiting** sur toutes les routes sensibles (10 requêtes / 15 min)
- Sessions client (2h) et staff (8h) séparées via JWT, avec rôles distincts (admin, conseiller, mécanicien, carrossier)
- `helmet` pour les en-têtes HTTP, CORS restreint au domaine officiel, HTTPS forcé en production
- Journal d'audit (`audit_log`, `appointment_status_log`) pour tracer les actions sensibles

## Restant à brancher (prochaines étapes)
1. Envoi d'emails/SMS réels (confirmation RDV, rappel avant RDV, réinitialisation mot de passe) — SMTP à configurer dans `.env`
2. Intégration paiement : myPOS (en ligne + TPE), TWINT, génération de QR-factures (IBAN à renseigner)
3. Endpoints catalogue véhicules (vente/leasing/location/abonnement) — tables déjà prêtes dans `schema.sql`
4. Endpoint déclaration de sinistre côté client (upload photos)
5. Endpoint demande d'assistance immatriculation / permis de circulation côté client
6. Traduction FR/DE/EN des contenus et des emails automatiques
7. Tests automatisés + déploiement sur l'infrastructure Infomaniak (Cloud Public / Jelastic pour Node.js + PostgreSQL)

## Règle métier clé : annulation/déplacement de rendez-vous
Un client ne peut annuler ou déplacer un rendez-vous que si celui-ci est prévu **dans plus de 48h**. Passé ce délai, l'API renvoie une erreur explicite invitant à contacter le garage directement (032 725 50 60). Cette logique est centralisée dans `appointments.js` (constante `MIN_HOURS_BEFORE_CHANGE`).
