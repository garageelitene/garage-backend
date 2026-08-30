const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : undefined
});

// Wrapper qui imite l'API `{ rows }` utilisée dans les routes (comme avec `pg`),
// pour garder les mêmes noms de propriétés partout dans le code.
async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return { rows };
}

module.exports = { query, pool };
