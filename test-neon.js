const { neon } = require('@neondatabase/serverless');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const sql = neon(process.env.DATABASE_URL);
sql`SELECT 1`
  .then(r => console.log('Success:', r))
  .catch(err => console.error('Failed:', err.message, err.code));