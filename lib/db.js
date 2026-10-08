const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SQLITE_FILE = path.join(DATA_DIR, 'app.db');

let sqlClient = null;
let sqliteDb = null;

function getSql() {
  if (!sqlClient && process.env.DATABASE_URL) {
    const { neon } = require('@neondatabase/serverless');
    sqlClient = neon(process.env.DATABASE_URL);
  }
  return sqlClient;
}

function getSqliteDb() {
  if (!sqliteDb) {
    const Database = require('better-sqlite3');
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    sqliteDb = new Database(SQLITE_FILE);
    sqliteDb.pragma('journal_mode = WAL');
    initSqliteTables();
  }
  return sqliteDb;
}

const DEFAULT_SETTINGS = {
  siteTitle: 'Forex Trading',
  siteTagline: 'Your clear view of the currency markets.',
  paymentAmount: 2000,
  announcement: ''
};

function initSqliteTables() {
  const db = getSqliteDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      watchlist TEXT NOT NULL DEFAULT '["EUR/USD","GBP/USD","USD/JPY","AUD/USD"]',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS registrations (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      session_token_hash TEXT,
      session_expires_at DATETIME,
      payment_status TEXT NOT NULL DEFAULT 'unpaid',
      payment_reference TEXT,
      transaction_request_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE INDEX IF NOT EXISTS idx_registrations_email ON registrations(email);
    CREATE INDEX IF NOT EXISTS idx_registrations_session ON registrations(session_token_hash) WHERE session_token_hash IS NOT NULL;

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  
  const existing = db.prepare(`SELECT 1 FROM accounts LIMIT 1`).get();
  if (!existing) {
    db.prepare(`INSERT INTO accounts (id, watchlist) VALUES (1, '["EUR/USD","GBP/USD","USD/JPY","AUD/USD"]')`).run();
  }
  const settingsRow = db.prepare(`SELECT 1 FROM settings LIMIT 1`).get();
  if (!settingsRow) {
    db.prepare(`INSERT INTO settings (id, data) VALUES (1, ?)`).run(JSON.stringify(DEFAULT_SETTINGS));
  }
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

async function initDb() {
  const sql = getSql();
  if (sql) {
    await sql`
      CREATE TABLE IF NOT EXISTS accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        watchlist TEXT[] NOT NULL DEFAULT ARRAY['EUR/USD','GBP/USD','USD/JPY','AUD/USD'],
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;
    await sql`
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
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_registrations_email ON registrations(email)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_registrations_session ON registrations(session_token_hash) WHERE session_token_hash IS NOT NULL`;
    await sql`
      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;
    const existing = await sql`SELECT 1 FROM accounts LIMIT 1`;
    if (existing.length === 0) {
      await sql`INSERT INTO accounts (watchlist) VALUES (ARRAY['EUR/USD','GBP/USD','USD/JPY','AUD/USD'])`;
    }
    const settingsRow = await sql`SELECT 1 FROM settings LIMIT 1`;
    if (settingsRow.length === 0) {
      await sql`INSERT INTO settings (id, data) VALUES (1, ${JSON.stringify(DEFAULT_SETTINGS)}::jsonb)`;
    }
  } else {
    getSqliteDb();
  }
}

async function readAccount() {
  const sql = getSql();
  if (sql) {
    const result = await sql`SELECT watchlist FROM accounts LIMIT 1`;
    return result[0] || { watchlist: ['EUR/USD','GBP/USD','USD/JPY','AUD/USD'] };
  }
  const db = getSqliteDb();
  const row = db.prepare(`SELECT watchlist FROM accounts WHERE id = 1`).get();
  return row ? { watchlist: JSON.parse(row.watchlist) } : { watchlist: ['EUR/USD','GBP/USD','USD/JPY','AUD/USD'] };
}

async function saveAccount(account) {
  const sql = getSql();
  if (sql) {
    await sql`
      UPDATE accounts SET watchlist = ${account.watchlist}, updated_at = NOW() 
      WHERE id = (SELECT id FROM accounts LIMIT 1)
    `;
  } else {
    const db = getSqliteDb();
    db.prepare(`UPDATE accounts SET watchlist = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`).run(JSON.stringify(account.watchlist));
  }
}

function mapRegistrationRow(r) {
  return {
    id: r.id, fullName: r.full_name, email: r.email, phone: r.phone,
    passwordSalt: r.password_salt, passwordHash: r.password_hash,
    sessionTokenHash: r.session_token_hash,
    sessionExpiresAt: r.session_expires_at ? new Date(r.session_expires_at).getTime() : 0,
    createdAt: r.created_at, paymentStatus: r.payment_status,
    paymentReference: r.payment_reference, transactionRequestId: r.transaction_request_id
  };
}

async function readRegistrations() {
  const sql = getSql();
  if (sql) {
    const result = await sql`SELECT * FROM registrations ORDER BY created_at DESC`;
    return result.map(mapRegistrationRow);
  }
  const db = getSqliteDb();
  const rows = db.prepare(`SELECT * FROM registrations ORDER BY created_at DESC`).all();
  return rows.map(mapRegistrationRow);
}

async function upsertRegistration(user) {
  const sql = getSql();
  if (sql) {
    await sql`
      INSERT INTO registrations (id, full_name, email, phone, password_salt, password_hash, session_token_hash, session_expires_at, payment_status, payment_reference, transaction_request_id, created_at)
      VALUES (${user.id}, ${user.fullName}, ${user.email}, ${user.phone}, ${user.passwordSalt}, ${user.passwordHash}, ${user.sessionTokenHash}, ${user.sessionExpiresAt ? new Date(user.sessionExpiresAt).toISOString() : null}, ${user.paymentStatus}, ${user.paymentReference}, ${user.transactionRequestId}, ${user.createdAt})
      ON CONFLICT (email) DO UPDATE SET
        full_name = EXCLUDED.full_name, phone = EXCLUDED.phone,
        password_salt = EXCLUDED.password_salt, password_hash = EXCLUDED.password_hash,
        session_token_hash = EXCLUDED.session_token_hash, session_expires_at = EXCLUDED.session_expires_at,
        payment_status = EXCLUDED.payment_status, payment_reference = EXCLUDED.payment_reference,
        transaction_request_id = EXCLUDED.transaction_request_id
    `;
  } else {
    const db = getSqliteDb();
    db.prepare(`
      INSERT INTO registrations (id, full_name, email, phone, password_salt, password_hash, session_token_hash, session_expires_at, payment_status, payment_reference, transaction_request_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET
        full_name = excluded.full_name,
        phone = excluded.phone,
        password_salt = excluded.password_salt,
        password_hash = excluded.password_hash,
        session_token_hash = excluded.session_token_hash,
        session_expires_at = excluded.session_expires_at,
        payment_status = excluded.payment_status,
        payment_reference = excluded.payment_reference,
        transaction_request_id = excluded.transaction_request_id
    `).run(
      user.id, user.fullName, user.email, user.phone, user.passwordSalt, user.passwordHash,
      user.sessionTokenHash, user.sessionExpiresAt ? new Date(user.sessionExpiresAt).toISOString() : null,
      user.paymentStatus, user.paymentReference, user.transactionRequestId, user.createdAt
    );
  }
}

async function findRegistrationByEmail(email) {
  const sql = getSql();
  if (sql) {
    const result = await sql`SELECT * FROM registrations WHERE email = ${email} LIMIT 1`;
    if (!result[0]) return null;
    return mapRegistrationRow(result[0]);
  }
  const db = getSqliteDb();
  const row = db.prepare(`SELECT * FROM registrations WHERE email = ? LIMIT 1`).get(email);
  return row ? mapRegistrationRow(row) : null;
}

async function findRegistrationBySessionTokenHash(tokenHash) {
  const sql = getSql();
  if (sql) {
    const result = await sql`SELECT * FROM registrations WHERE session_token_hash = ${tokenHash} AND session_expires_at > NOW() LIMIT 1`;
    if (!result[0]) return null;
    return mapRegistrationRow(result[0]);
  }
  const db = getSqliteDb();
  const row = db.prepare(`SELECT * FROM registrations WHERE session_token_hash = ? AND session_expires_at > datetime('now') LIMIT 1`).get(tokenHash);
  return row ? mapRegistrationRow(row) : null;
}

async function updateRegistrationSession(userId, sessionTokenHash, sessionExpiresAt) {
  const sql = getSql();
  if (sql) {
    await sql`
      UPDATE registrations SET session_token_hash = ${sessionTokenHash}, session_expires_at = ${sessionExpiresAt ? new Date(sessionExpiresAt).toISOString() : null} WHERE id = ${userId}
    `;
  } else {
    const db = getSqliteDb();
    db.prepare(`UPDATE registrations SET session_token_hash = ?, session_expires_at = ? WHERE id = ?`).run(
      sessionTokenHash, sessionExpiresAt ? new Date(sessionExpiresAt).toISOString() : null, userId
    );
  }
}

async function updateRegistrationPayment(userId, paymentStatus, paymentReference, transactionRequestId) {
  const sql = getSql();
  if (sql) {
    await sql`
      UPDATE registrations SET payment_status = ${paymentStatus}, payment_reference = ${paymentReference}, transaction_request_id = ${transactionRequestId} WHERE id = ${userId}
    `;
  } else {
    const db = getSqliteDb();
    db.prepare(`UPDATE registrations SET payment_status = ?, payment_reference = ?, transaction_request_id = ? WHERE id = ?`).run(
      paymentStatus, paymentReference, transactionRequestId, userId
    );
  }
}

async function readSettings() {
  const sql = getSql();
  if (sql) {
    const result = await sql`SELECT data FROM settings WHERE id = 1 LIMIT 1`;
    return { ...DEFAULT_SETTINGS, ...(result[0] ? result[0].data : {}) };
  }
  const db = getSqliteDb();
  const row = db.prepare(`SELECT data FROM settings WHERE id = 1`).get();
  let stored = {};
  try { stored = row ? JSON.parse(row.data) : {}; } catch { stored = {}; }
  return { ...DEFAULT_SETTINGS, ...stored };
}

async function saveSettings(settings) {
  const sql = getSql();
  if (sql) {
    await sql`
      INSERT INTO settings (id, data, updated_at) VALUES (1, ${JSON.stringify(settings)}::jsonb, NOW())
      ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
    `;
  } else {
    const db = getSqliteDb();
    db.prepare(`
      INSERT INTO settings (id, data, updated_at) VALUES (1, ?, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = CURRENT_TIMESTAMP
    `).run(JSON.stringify(settings));
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
  updateRegistrationPayment,
  readSettings,
  saveSettings,
  DEFAULT_SETTINGS
};