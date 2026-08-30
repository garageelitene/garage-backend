// ============================================================
// Crée le tout premier compte administrateur du back-office.
// À exécuter UNE SEULE FOIS, en local, après avoir importé le schéma
// et les migrations. Aucune route API ne permet de créer le premier
// admin (volontairement : seul un admin peut créer un autre admin).
//
// Usage :
//   node scripts/create-first-admin.js "admin@garage-elite-ne.ch" "MotDePasseTresSolide123!" "Prénom Nom"
// ============================================================

require('dotenv').config();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const db = require('../src/db');

async function main() {
  const [, , email, password, fullName] = process.argv;
  if (!email || !password || !fullName) {
    console.error('Usage: node scripts/create-first-admin.js <email> <mot_de_passe> "<Prénom Nom>"');
    process.exit(1);
  }
  if (password.length < 12) {
    console.error('Le mot de passe du personnel doit contenir au moins 12 caractères.');
    process.exit(1);
  }

  const existing = await db.query('SELECT id FROM staff WHERE email = ?', [email]);
  if (existing.rows.length) {
    console.error('Un compte staff existe déjà avec cet email.');
    process.exit(1);
  }

  const password_hash = await bcrypt.hash(password, 12);
  const id = crypto.randomUUID();
  await db.query(
    'INSERT INTO staff (id, email, password_hash, full_name, role, active) VALUES (?,?,?,?,\'admin\',1)',
    [id, email, password_hash, fullName]
  );

  console.log(`Compte administrateur créé : ${email} (id: ${id})`);
  console.log('Connectez-vous ensuite via POST /backoffice/login avec cet email et ce mot de passe.');
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
