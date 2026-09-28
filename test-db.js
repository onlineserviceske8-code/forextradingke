const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
pool.query('SELECT * FROM registrations')
  .then(r => console.log('Rows:', JSON.stringify(r.rows, null, 2)))
  .catch(e => console.error('Error:', e))
  .finally(() => pool.end());