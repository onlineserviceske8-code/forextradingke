const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (!pool && process.env.DATABASE_URL) {
    pool = new Pool({ 
      connectionString: process.env.DATABASE_URL, 
      max: 1,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
  }
  return pool;
}

async function initDb() {
  const pool = getPool();
  if (!pool) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      watchlist TEXT[] NOT NULL DEFAULT ARRAY['EUR/USD','GBP/USD','USD/JPY','AUD/USD'],
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS registrations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      session_token_hash TEXT,
      session_expires_at TIMESTAMPTZ,
      payment_status TEXT NOT NULL DEFAULT 'unpaid',
      payment_reference TEXT,
      transaction_request_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_registrations_email ON registrations(email);
    CREATE INDEX IF NOT EXISTS idx_registrations_session ON registrations(session_token_hash) WHERE session_token_hash IS NOT NULL;
  `);

  const existing = await pool.query(`SELECT 1 FROM accounts LIMIT 1`);
  if (existing.rows.length === 0) {
    await pool.query(`INSERT INTO accounts (watchlist) VALUES (ARRAY['EUR/USD','GBP/USD','USD/JPY','AUD/USD'])`);
  }
}

async function readAccount() {
  const pool = getPool();
  if (!pool) return { watchlist: ['EUR/USD','GBP/USD','USD/JPY','AUD/USD'] };
  const result = await pool.query(`SELECT watchlist FROM accounts LIMIT 1`);
  return result.rows[0] || { watchlist: ['EUR/USD','GBP/USD','USD/JPY','AUD/USD'] };
}

async function saveAccount(account) {
  const pool = getPool();
  if (!pool) return;
  await pool.query(
    `UPDATE accounts SET watchlist = $1, updated_at = NOW() WHERE id = (SELECT id FROM accounts LIMIT 1)`,
    [account.watchlist]
  );
}

async function readRegistrations() {
  const pool = getPool();
  if (!pool) return [];
  const result = await pool.query(`SELECT * FROM registrations ORDER BY created_at DESC`);
  return result.rows.map(r => ({
    id: r.id,
    fullName: r.full_name,
    email: r.email,
    phone: r.phone,
    passwordSalt: r.password_salt,
    passwordHash: r.password_hash,
    sessionTokenHash: r.session_token_hash,
    sessionExpiresAt: r.session_expires_at ? new Date(r.session_expires_at).getTime() : 0,
    createdAt: r.created_at,
    paymentStatus: r.payment_status,
    paymentReference: r.payment_reference,
    transactionRequestId: r.transaction_request_id
  }));
}

async function saveRegistrations(registrations) {
  // Kept for compatibility but not used with DB
}

async function upsertRegistration(user) {
  const pool = getPool();
  if (!pool) return;
  await pool.query(`
    INSERT INTO registrations (id, full_name, email, phone, password_salt, password_hash, session_token_hash, session_expires_at, payment_status, payment_reference, transaction_request_id, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    ON CONFLICT (email) DO UPDATE SET
      full_name = EXCLUDED.full_name,
      phone = EXCLUDED.phone,
      password_salt = EXCLUDED.password_salt,
      password_hash = EXCLUDED.password_hash,
      session_token_hash = EXCLUDED.session_token_hash,
      session_expires_at = EXCLUDED.session_expires_at,
      payment_status = EXCLUDED.payment_status,
      payment_reference = EXCLUDED.payment_reference,
      transaction_request_id = EXCLUDED.transaction_request_id
  `, [
    user.id, user.fullName, user.email, user.phone, user.passwordSalt, user.passwordHash,
    user.sessionTokenHash, user.sessionExpiresAt ? new Date(user.sessionExpiresAt).toISOString() : null,
    user.paymentStatus, user.paymentReference, user.transactionRequestId, user.createdAt
  ]);
}

async function findRegistrationByEmail(email) {
  const pool = getPool();
  if (!pool) return null;
  const result = await pool.query(`SELECT * FROM registrations WHERE email = $1 LIMIT 1`, [email]);
  if (!result.rows[0]) return null;
  const r = result.rows[0];
  return {
    id: r.id, fullName: r.full_name, email: r.email, phone: r.phone,
    passwordSalt: r.password_salt, passwordHash: r.password_hash,
    sessionTokenHash: r.session_token_hash,
    sessionExpiresAt: r.session_expires_at ? new Date(r.session_expires_at).getTime() : 0,
    createdAt: r.created_at, paymentStatus: r.payment_status,
    paymentReference: r.payment_reference, transactionRequestId: r.transaction_request_id
  };
}

async function findRegistrationBySessionTokenHash(tokenHash) {
  const pool = getPool();
  if (!pool) return null;
  const result = await pool.query(`SELECT * FROM registrations WHERE session_token_hash = $1 AND session_expires_at > NOW() LIMIT 1`, [tokenHash]);
  if (!result.rows[0]) return null;
  const r = result.rows[0];
  return {
    id: r.id, fullName: r.full_name, email: r.email, phone: r.phone,
    passwordSalt: r.password_salt, passwordHash: r.password_hash,
    sessionTokenHash: r.session_token_hash,
    sessionExpiresAt: r.session_expires_at ? new Date(r.session_expires_at).getTime() : 0,
    createdAt: r.created_at, paymentStatus: r.payment_status,
    paymentReference: r.payment_reference, transactionRequestId: r.transaction_request_id
  };
}

async function updateRegistrationSession(userId, sessionTokenHash, sessionExpiresAt) {
  const pool = getPool();
  if (!pool) return;
  await pool.query(
    `UPDATE registrations SET session_token_hash = $1, session_expires_at = $2 WHERE id = $3`,
    [sessionTokenHash, sessionExpiresAt ? new Date(sessionExpiresAt).toISOString() : null, userId]
  );
}

async function updateRegistrationPayment(userId, paymentStatus, paymentReference, transactionRequestId) {
  const pool = getPool();
  if (!pool) return;
  await pool.query(
    `UPDATE registrations SET payment_status = $1, payment_reference = $2, transaction_request_id = $3 WHERE id = $4`,
    [paymentStatus, paymentReference, transactionRequestId, userId]
  );
}

module.exports = {
  initDb,
  readAccount,
  saveAccount,
  readRegistrations,
  saveRegistrations,
  upsertRegistration,
  findRegistrationByEmail,
  findRegistrationBySessionTokenHash,
  updateRegistrationSession,
  updateRegistrationPayment
};