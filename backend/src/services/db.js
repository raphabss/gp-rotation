'use strict';
// services/db.js — pool de conexões PostgreSQL (gp_rotation no link limpo .2)
// Reaproveitado por toda a app; NUNCA abrir conexão por request.
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // postgresql://gp:***@10.88.88.2:5432/gp_rotation
  max: parseInt(process.env.PG_POOL_MAX || '10', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => console.error('[PG] erro no pool:', err.message));

// Resolve um cartão -> GP (normaliza caixa/espaços do barcode: P01K == p01k == " P01K ")
async function resolveCard(code) {
  const norm = String(code == null ? '' : code).trim().toUpperCase();
  if (!norm) return null;
  const { rows } = await pool.query(
    'SELECT barcode, nick, name, position, team FROM gp.card_lookup WHERE barcode = $1',
    [norm]
  );
  return rows[0] || null;
}

// healthcheck simples (útil pro /health)
async function ping() {
  const { rows } = await pool.query('SELECT 1 AS ok');
  return rows[0] && rows[0].ok === 1;
}

module.exports = { pool, resolveCard, ping };
