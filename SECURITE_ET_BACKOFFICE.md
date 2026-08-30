# Garage Elite-Auto — Analyse de sécurité & Guide back-office

## 1. Ce qui a été corrigé dans cette livraison

**Problème critique trouvé dans votre ZIP (`Bakup-V-2.zip`)** : le frontend (public) et le backend (privé, avec vos secrets réels) étaient mélangés dans un seul dossier. Si ce dossier avait été déployé tel quel comme racine web sur Infomaniak, les fichiers suivants auraient été **accessibles publiquement depuis Internet** :
- `.env` → mot de passe réel de votre base de données MySQL
- `src/` → tout le code serveur (logique métier, structure de l'API)
- `migrations/*.sql`, `schema_mysql.sql` → structure complète de votre base de données
- `package.json` → liste des dépendances (facilite la recherche de vulnérabilités connues)

**Correction** : deux dossiers strictement séparés dans cette livraison :
- `garage-frontend/` → **seul celui-ci va sur votre hébergement web public** (Infomaniak, racine du site)
- `garage-backend/` → reste sur un serveur Node.js séparé (jamais dans la racine web publique), ou déployé comme application backend distincte

**Règle à respecter absolument** : ne jamais copier `garage-backend/` (ni son contenu) dans le même répertoire que `garage-frontend/` sur votre hébergement web.

## 2. État actuel de la sécurité (ce qui est déjà en place)

| Aspect | État | Détail |
|---|---|---|
| Mots de passe | ✅ | bcrypt (12 rounds), jamais stockés en clair |
| Réinitialisation mot de passe | ✅ | Token à usage unique, hashé en base, expire après 1h |
| Anti-énumération de comptes | ✅ | Réponses génériques sur login/mot de passe oublié |
| Anti brute-force | ✅ | Verrouillage 15 min après 5 échecs ; rate limiting sur les routes sensibles |
| Sessions | ✅ | JWT signé, expiration courte (2h client / 8h staff), séparation client/staff |
| Permissions | ✅ | Système granulaire par rôle ; le rôle admin a un accès total non contournable par erreur de config |
| Transport | ✅ | HTTPS forcé en production, en-têtes sécurisés (Helmet), CORS restreint au domaine officiel |
| Audit | ✅ | Journal des actions sensibles (`audit_log`, `appointment_status_log`) |
| Isolation des données client | ✅ | Un client ne peut lire/modifier que ses propres véhicules, rendez-vous, notifications |

## 3. Points restants à traiter avant mise en production

1. **`.env` en clair dans cette livraison** — c'est volontaire pour que la config fonctionne immédiatement, mais **ce fichier ne doit jamais être poussé sur un dépôt Git public**. Ajoutez `.env` à un `.gitignore` dès que vous versionnez le projet.
2. **Aucun compte administrateur n'existe encore** — voir section 4 ci-dessous, un script de démarrage est fourni.
3. **`JWT_SECRET`** dans `.env` est une valeur générique (`change_this_to_a_long_random_string`) — à remplacer par une chaîne aléatoire longue avant mise en production (ex. `openssl rand -hex 32`).
4. **SMTP non configuré** — l'envoi d'email (confirmation RDV, réinitialisation mot de passe, factures) échouera tant que `SMTP_HOST`/`SMTP_USER`/`SMTP_PASSWORD` ne sont pas renseignés.
5. **Pas encore de sauvegardes automatisées** de la base de données — à activer côté Infomaniak (sauvegarde MySQL programmée).
6. **Pas de limitation de débit dédiée sur `/backoffice/billing`** (facturation) — recommandé d'ajouter un rate-limit spécifique vu la sensibilité (déjà protégé par authentification + permission, mais une limite d'appels supplémentaire est une bonne pratique).
7. **Chiffrement de la base au repos** — dépend de l'offre Infomaniak ; à vérifier auprès d'eux (les offres Cloud/Managed incluent généralement le chiffrement disque).

## 4. Comment se connecter au back-office administrateur

**Important : il n'existe pas encore d'interface visuelle (dashboard) pour le back-office.** Ce qui existe aujourd'hui est une **API** — toutes les actions (confirmer un rendez-vous, gérer les rôles, créer une facture...) se font par des requêtes HTTP, pas encore par des écrans cliquables. C'est le prochain chantier logique (voir section 5).

### Étape 1 — Créer le tout premier compte administrateur

Aucune route API ne permet de créer le tout premier admin (volontairement, pour la sécurité — seul un admin peut en créer un autre). Utilisez le script fourni, une seule fois :

```bash
cd garage-backend
npm install
node scripts/create-first-admin.js "votre-email@garage-elite-ne.ch" "UnMotDePasseTresSolide123!" "Votre Nom"
```

### Étape 2 — Se connecter (obtenir un jeton de session)

```bash
curl -X POST https://votre-api.garage-elite-ne.ch/backoffice/login \
  -H "Content-Type: application/json" \
  -d '{"email":"votre-email@garage-elite-ne.ch","password":"UnMotDePasseTresSolide123!"}'
```

Réponse : `{ "token": "eyJhbGciOi...", "staff": { ... } }`

### Étape 3 — Utiliser ce jeton pour toutes les actions admin

```bash
curl https://votre-api.garage-elite-ne.ch/backoffice/appointments \
  -H "Authorization: Bearer eyJhbGciOi..."
```

Tant que le dashboard visuel n'existe pas, un outil comme **Postman** ou **Insomnia** permet de tester confortablement toutes les routes `/backoffice/*` sans ligne de commande.

## 5. Le plus gros chantier restant : le dashboard back-office visuel

Toutes les fonctionnalités demandées (facturation, bannières, permissions, fidélité, parrainage, notifications véhicule) existent **côté API et base de données**, mais votre équipe ne peut pas encore les utiliser sans écrans. C'est, de loin, le morceau le plus important qu'il reste à construire — une vraie application web (login, tableaux de bord, formulaires) consommant cette API.

Je recommande qu'on s'attaque à ça en prochaine étape dédiée plutôt que de l'ajouter superficiellement ici.
