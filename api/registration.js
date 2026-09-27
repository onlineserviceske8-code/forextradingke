const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

let sqlClient = null;
function getSql() {
  if (!sqlClient && process.env.DATABASE_URL) {
    const { neon } = require('@neondatabase/serverless');
    sqlClient = neon(process.env.DATABASE_URL);
  }
  return sqlClient;
}

function normalizePhone(value) {
  const raw = String(value || '').replace(/[\s()-]/g, '');
  const phone = raw.startsWith('+254') ? raw.slice(1) : raw.startsWith('0') ? `254${raw.slice(1)}` : raw;
  return /^254[17]\d{8}$/.test(phone) ? phone : null;
}

function isPaywaveSuccess(response, result) {
  if (!response.ok) return false;
  const code = result.ResponseCode || result.responseCode || result.code || result.resultCode || result.ResultCode;
  const status = result.status || result.Status || result.responseStatus;
  const success = result.success || result.Success;
  const message = result.message || result.Message || result.responseDescription || result.ResponseDescription;
  
  return (code === 0 || code === '0' || code === 200 || code === '200') ||
         (status === 'success' || status === 'Success') ||
         (success === true || success === 'true' || success === 200 || success === '200') ||
         (typeof message === 'string' && message.toLowerCase().includes('success'));
}

async function findRegistrationByEmail(email) {
  const sql = getSql();
  if (!sql) return null;
  const rows = await sql`SELECT * FROM registrations WHERE email = ${email} LIMIT 1`;
  if (!rows[0]) return null;
  const r = rows[0];
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
  const sql = getSql();
  if (!sql) return null;
  const rows = await sql`SELECT * FROM registrations WHERE session_token_hash = ${tokenHash} AND session_expires_at > NOW() LIMIT 1`;
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    id: r.id, fullName: r.full_name, email: r.email, phone: r.phone,
    passwordSalt: r.password_salt, passwordHash: r.password_hash,
    sessionTokenHash: r.session_token_hash,
    sessionExpiresAt: r.session_expires_at ? new Date(r.session_expires_at).getTime() : 0,
    createdAt: r.created_at, paymentStatus: r.payment_status,
    paymentReference: r.payment_reference, transactionRequestId: r.transaction_request_id
  };
}

async function upsertRegistration(user) {
  const sql = getSql();
  if (!sql) return;
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
}

async function updateRegistrationSession(userId, sessionTokenHash, sessionExpiresAt) {
  const sql = getSql();
  if (!sql) return;
  await sql`
    UPDATE registrations SET session_token_hash = ${sessionTokenHash}, session_expires_at = ${sessionExpiresAt ? new Date(sessionExpiresAt).toISOString() : null} WHERE id = ${userId}
  `;
}

async function updateRegistrationPayment(userId, paymentStatus, paymentReference, transactionRequestId) {
  const sql = getSql();
  if (!sql) return;
  await sql`
    UPDATE registrations SET payment_status = ${paymentStatus}, payment_reference = ${paymentReference}, transaction_request_id = ${transactionRequestId} WHERE id = ${userId}
  `;
}

function setCookie(res, token, isProduction) {
  const secure = isProduction ? '; Secure' : '';
  const cookie = token
    ? `registration_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400${secure}`
    : `registration_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
  res.setHeader('Set-Cookie', cookie);
}

module.exports = async (req, res) => {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(204).end();

  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(part => part.trim().split('=').map(decodeURIComponent)));
  const token = cookies.registration_session;
  const isProduction = process.env.NODE_ENV === 'production';

  if (req.method === 'GET' && req.url === '/api/registration/me') {
    if (!token) return res.status(401).json({ error: 'No active registration.' });
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const user = await findRegistrationBySessionTokenHash(tokenHash);
    return user ? res.json({ registration: { id: user.id, fullName: user.fullName, email: user.email, phone: user.phone, paymentStatus: user.paymentStatus } }) : res.status(401).json({ error: 'No active registration.' });
  }

  if (req.method === 'POST' && req.url === '/api/login') {
    try {
      const { email, password } = req.body;
      const emailNorm = String(email || '').trim().toLowerCase();
      const passwordStr = String(password || '');
      const user = await findRegistrationByEmail(emailNorm);
      if (!user || passwordStr.length > 128) return res.status(401).json({ error: 'Email or password is incorrect.' });
      const candidate = await scrypt(passwordStr, user.passwordSalt, 64);
      const expected = Buffer.from(user.passwordHash, 'hex');
      if (candidate.length !== expected.length || !crypto.timingSafeEqual(candidate, expected)) return res.status(401).json({ error: 'Email or password is incorrect.' });
      const newToken = crypto.randomBytes(32).toString('hex');
      const sessionTokenHash = crypto.createHash('sha256').update(newToken).digest('hex');
      const sessionExpiresAt = Date.now() + 24 * 60 * 60 * 1000;
      await updateRegistrationSession(user.id, sessionTokenHash, sessionExpiresAt);
      setCookie(res, newToken, isProduction);
      return res.json({ registration: { id: user.id, fullName: user.fullName, email: user.email, phone: user.phone, paymentStatus: user.paymentStatus } });
    } catch { return res.status(400).json({ error: 'Unable to sign in. Please try again.' }); }
  }

  if (req.method === 'POST' && req.url === '/api/logout') {
    if (token) {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const user = await findRegistrationBySessionTokenHash(tokenHash);
      if (user) await updateRegistrationSession(user.id, null, 0);
    }
    setCookie(res, null, isProduction);
    return res.json({ message: 'You are signed out.' });
  }

  if (req.method === 'POST' && req.url === '/api/register') {
    try {
      const { fullName, email, phone, password } = req.body;
      const fullNameTrim = String(fullName || '').trim();
      const emailNorm = String(email || '').trim().toLowerCase();
      const phoneNorm = normalizePhone(phone);
      const passwordStr = String(password || '');
      if (fullNameTrim.length < 2 || fullNameTrim.length > 100) return res.status(400).json({ error: 'Enter your full name.' });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm) || emailNorm.length > 254) return res.status(400).json({ error: 'Enter a valid email address.' });
      if (!phoneNorm) return res.status(400).json({ error: 'Enter a valid Kenyan M-Pesa phone number.' });
      if (passwordStr.length < 8 || passwordStr.length > 128) return res.status(400).json({ error: 'Password must be between 8 and 128 characters.' });
      const existing = await findRegistrationByEmail(emailNorm);
      if (existing) return res.status(409).json({ error: 'An account with this email is already registered.' });
      const salt = crypto.randomBytes(16).toString('hex');
      const passwordHash = await scrypt(passwordStr, salt, 64);
      const newToken = crypto.randomBytes(32).toString('hex');
      const sessionTokenHash = crypto.createHash('sha256').update(newToken).digest('hex');
      const sessionExpiresAt = Date.now() + 24 * 60 * 60 * 1000;
      const user = { id: crypto.randomUUID(), fullName: fullNameTrim, email: emailNorm, phone: phoneNorm, passwordSalt: salt, passwordHash: passwordHash.toString('hex'), sessionTokenHash, sessionExpiresAt, createdAt: new Date().toISOString(), paymentStatus: 'unpaid', paymentReference: null, transactionRequestId: null };
      await upsertRegistration(user);
      setCookie(res, newToken, isProduction);
      return res.status(201).json({ registration: { id: user.id, fullName: user.fullName, email: user.email }, message: 'Registration complete. You can now continue to payment.' });
    } catch { return res.status(400).json({ error: 'Unable to complete registration. Please check your details and try again.' }); }
  }

  if (req.method === 'POST' && req.url === '/api/payments/stkpush') {
    try {
      if (!token) return res.status(401).json({ error: 'Register first to continue to payment.' });
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const registrant = await findRegistrationBySessionTokenHash(tokenHash);
      if (!registrant) return res.status(401).json({ error: 'Register first to continue to payment.' });
      const apiKey = process.env.PAYWAVE_API_KEY;
      const email = process.env.PAYWAVE_EMAIL;
      if (!apiKey || !email) return res.status(503).json({ error: 'Payments are not configured on the server yet.' });
      const phone = registrant.phone;
      const reference = `FX-${Date.now()}-${Math.random().toString(36).slice(2,7).toUpperCase()}`;
      const tillNumber = process.env.PAYWAVE_TILL_NUMBER || '6446427';
      function isPaywaveSuccess(response, result) {
    if (!response.ok) return false;
    const code = result.ResponseCode || result.responseCode || result.code || result.resultCode || result.ResultCode;
    const status = result.status || result.Status || result.responseStatus;
    const success = result.success || result.Success;
    const message = result.message || result.Message || result.responseDescription || result.ResponseDescription;
    
    return (code === 0 || code === '0' || code === 200 || code === '200') ||
           (status === 'success' || status === 'Success') ||
           (success === true || success === 'true' || success === 200 || success === '200') ||
           (typeof message === 'string' && message.toLowerCase().includes('success'));
  }

      const response = await fetch('https://paywavexpress.co.ke/v1/stkpush', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey, email, amount: '2000', msisdn: phone, reference, till_number: tillNumber }),
        signal: AbortSignal.timeout(15000)
      });
      let result;
      try { result = await response.json(); } catch { result = {}; }
      const accepted = isPaywaveSuccess(response, result);
      if (!accepted) return res.status(502).json({ error: result.errorMessage || result.message || result.ResponseDescription || result.responseDescription || 'The payment provider could not start the STK Push. Try again later.' });
      await updateRegistrationPayment(registrant.id, 'pending', reference, result.transaction_request_id || null);
      return res.json({ message: result.message || 'STK Push request sent. Check your phone and complete the M-Pesa prompt.', reference, transactionRequestId: result.transaction_request_id || null });
    } catch (error) {
      const message = error.name === 'TimeoutError' ? 'The payment provider did not respond in time. Check your phone before retrying.' : 'Unable to reach the payment provider. Please try again later.';
      return res.status(502).json({ error: message });
    }
  }

  res.status(404).json({ error: 'API route not found.' });
};