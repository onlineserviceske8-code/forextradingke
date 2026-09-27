const { Pool } = require('pg');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const REG_FILE = path.join(DATA_DIR, 'registrations.json');
const ACC_FILE = path.join(DATA_DIR, 'account.json');

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

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

async function initDb() {
  const pool = getPool();
  if (pool) {
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
  } else {
    if (!fs.existsSync(REG_FILE)) writeJson(REG_FILE, []);
    if (!fs.existsSync(ACC_FILE)) writeJson(ACC_FILE, { watchlist: ['EUR/USD','GBP/USD','USD/JPY','AUD/USD'] });
  }
}

async function readAccount() {
  const pool = getPool();
  if (pool) {
    const result = await pool.query(`SELECT watchlist FROM accounts LIMIT 1`);
    return result.rows[0] || { watchlist: ['EUR/USD','GBP/USD','USD/JPY','AUD/USD'] };
  }
  return readJson(ACC_FILE, { watchlist: ['EUR/USD','GBP/USD','USD/JPY','AUD/USD'] });
}

async function saveAccount(account) {
  const pool = getPool();
  if (pool) {
    await pool.query(
      `UPDATE accounts SET watchlist = $1, updated_at = NOW() WHERE id = (SELECT id FROM accounts LIMIT 1)`,
      [account.watchlist]
    );
  } else {
    writeJson(ACC_FILE, account);
  }
}

async function readRegistrations() {
  const pool = getPool();
  if (pool) {
    const result = await pool.query(`SELECT * FROM registrations ORDER BY created_at DESC`);
    return result.rows.map(r => ({
      id: r.id, fullName: r.full_name, email: r.email, phone: r.phone,
      passwordSalt: r.password_salt, passwordHash: r.password_hash,
      sessionTokenHash: r.session_token_hash,
      sessionExpiresAt: r.session_expires_at ? new Date(r.session_expires_at).getTime() : 0,
      createdAt: r.created_at, paymentStatus: r.payment_status,
      paymentReference: r.payment_reference, transactionRequestId: r.transaction_request_id
    }));
  }
  return readJson(REG_FILE, []).map(r => ({
    ...r, sessionExpiresAt: r.sessionExpiresAt || 0
  }));
}

async function upsertRegistration(user) {
  const pool = getPool();
  if (pool) {
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
  } else {
    const regs = readJson(REG_FILE, []);
    const idx = regs.findIndex(r => r.email === user.email);
    const record = {
      id: user.id, fullName: user.fullName, email: user.email, phone: user.phone,
      passwordSalt: user.passwordSalt, passwordHash: user.passwordHash,
      sessionTokenHash: user.sessionTokenHash, sessionExpiresAt: user.sessionExpiresAt,
      createdAt: user.createdAt, paymentStatus: user.paymentStatus,
      paymentReference: user.paymentReference, transactionRequestId: user.transactionRequestId
    };
    if (idx >= 0) regs[idx] = record; else regs.push(record);
    writeJson(REG_FILE, regs);
  }
}

async function findRegistrationByEmail(email) {
  const pool = getPool();
  if (pool) {
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
  const regs = readJson(REG_FILE, []);
  const r = regs.find(r => r.email === email);
  if (!r) return null;
  return { ...r, sessionExpiresAt: r.sessionExpiresAt || 0 };
}

async function findRegistrationBySessionTokenHash(tokenHash) {
  const pool = getPool();
  if (pool) {
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
  const regs = readJson(REG_FILE, []);
  const r = regs.find(r => r.sessionTokenHash === tokenHash && (r.sessionExpiresAt || 0) > Date.now());
  if (!r) return null;
  return { ...r, sessionExpiresAt: r.sessionExpiresAt || 0 };
}

async function updateRegistrationSession(userId, sessionTokenHash, sessionExpiresAt) {
  const pool = getPool();
  if (pool) {
    await pool.query(
      `UPDATE registrations SET session_token_hash = $1, session_expires_at = $2 WHERE id = $3`,
      [sessionTokenHash, sessionExpiresAt ? new Date(sessionExpiresAt).toISOString() : null, userId]
    );
  } else {
    const regs = readJson(REG_FILE, []);
    const idx = regs.findIndex(r => r.id === userId);
    if (idx >= 0) {
      regs[idx].sessionTokenHash = sessionTokenHash;
      regs[idx].sessionExpiresAt = sessionExpiresAt;
      writeJson(REG_FILE, regs);
    }
  }
}

async function updateRegistrationPayment(userId, paymentStatus, paymentReference, transactionRequestId) {
  const pool = getPool();
  if (pool) {
    await pool.query(
      `UPDATE registrations SET payment_status = $1, payment_reference = $2, transaction_request_id = $3 WHERE id = $4`,
      [paymentStatus, paymentReference, transactionRequestId, userId]
    );
  } else {
    const regs = readJson(REG_FILE, []);
    const idx = regs.findIndex(r => r.id === userId);
    if (idx >= 0) {
      regs[idx].paymentStatus = paymentStatus;
      regs[idx].paymentReference = paymentReference;
      regs[idx].transactionRequestId = transactionRequestId;
      writeJson(REG_FILE, regs);
    }
  }
}

module.exports = {
  initDb,
  readAccount,
  saveAccount,
  readRegistrations,
  upsertRegistration,
  findRegistrationByEmail,
  findRegistrationBySessionTokenHash,
  updateRegistrationSession,
  updateRegistrationPayment
};