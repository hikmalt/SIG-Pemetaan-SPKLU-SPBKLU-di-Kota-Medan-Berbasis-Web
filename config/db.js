// ============================================================
// Koneksi Database PostgreSQL + PostGIS
// Menggunakan library 'pg' (node-postgres)
// ============================================================

const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME     || 'sig_ev_medan',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || '1',
  max: 10,              // maksimal 10 koneksi dalam pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test koneksi saat startup
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Gagal konek ke PostgreSQL:', err.message);
    return;
  }
  client.query('SELECT PostGIS_Version()', (err, result) => {
    release();
    if (err) {
      console.error('❌ PostGIS tidak tersedia:', err.message);
    } else {
      console.log('✅ PostgreSQL + PostGIS terhubung. Versi:', result.rows[0].postgis_version);
    }
  });
});

// Helper query dengan parameterized (anti SQL injection)
const query = (text, params) => pool.query(text, params);

module.exports = { pool, query };