const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { URL } = require('node:url');
const scrypt = promisify(crypto.scrypt);

require('dotenv').config({ path: path.join(__dirname, '.env') });

const {
  initDb,
  readAccount,
  saveAccount,
  readRegistrations,
  upsertRegistration,
  findRegistrationByEmail,
  findRegistrationBySessionTokenHash,
  updateRegistrationSession,
  updateRegistrationPayment
} = require('./lib/db');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');

const pairs = [
  { symbol:'EUR/USD', base:'EUR', quote:'USD', name:'Euro / US Dollar', price:1.08432, change:0.42, spread:0.8, flag:'🇪🇺' },
  { symbol:'GBP/USD', base:'GBP', quote:'USD', name:'British Pound / US Dollar', price:1.27186, change:-0.18, spread:1.1, flag:'🇬🇧' },
  { symbol:'USD/JPY', base:'USD', quote:'JPY', name:'US Dollar / Japanese Yen', price:149.824, change:0.31, spread:0.9, flag:'🇯🇵' },
  { symbol:'USD/CHF', base:'USD', quote:'CHF', name:'US Dollar / Swiss Franc', price:0.88342, change:-0.26, spread:1.2, flag:'🇨🇭' },
  { symbol:'AUD/USD', base:'AUD', quote:'USD', name:'Australian Dollar / US Dollar', price:0.65217, change:0.57, spread:1.0, flag:'🇦🇺' },
  { symbol:'USD/CAD', base:'USD', quote:'CAD', name:'US Dollar / Canadian Dollar', price:1.36195, change:-0.09, spread:1.3, flag:'🇨🇦' },
  { symbol:'NZD/USD', base:'NZD', quote:'USD', name:'New Zealand Dollar / US Dollar', price:0.60983, change:0.14, spread:1.4, flag:'🇳🇿' },
  { symbol:'EUR/GBP', base:'EUR', quote:'GBP', name:'Euro / British Pound', price:0.85294, change:0.23, spread:1.1, flag:'🇪🇺' },
];
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml' };

function normalizePhone(value) {
  const raw = String(value || '').replace(/[\s()-]/g, '');
  const phone = raw.startsWith('+254') ? raw.slice(1) : raw.startsWith('0') ? `254${raw.slice(1)}` : raw;
  return /^254[17]\d{8}$/.test(phone) ? phone : null;
}

async function registrationSession(req) {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(part => part.trim().split('=').map(decodeURIComponent)));
  const token = cookies.registration_session;
  if (!token) return null;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  console.log('Session lookup:', { token: token.slice(0,8), tokenHash: tokenHash.slice(0,16) });
  const result = await findRegistrationBySessionTokenHash(tokenHash);
  console.log('Session result:', result ? { id: result.id, email: result.email, expiresAt: result.sessionExpiresAt } : 'null');
  return result;
}

function json(res, status, payload, extraHeaders={}) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'Access-Control-Allow-Origin':allowedOrigin, 'Access-Control-Allow-Credentials':'true', ...extraHeaders });
  res.end(JSON.stringify(payload));
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

function body(req) {
  return new Promise((resolve, reject) => {
    let data = ''; req.on('data', chunk => { data += chunk; if (data.length > 1e6) reject(new Error('Request too large')); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { reject(new Error('Invalid JSON')); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
  if (req.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '86400'
    });
    return res.end();
  }
  if (url.pathname.startsWith('/api/')) {
    if (req.method === 'GET' && url.pathname === '/api/markets') {
      const now = Date.now();
      return json(res, 200, { asOf: now, markets: pairs.map((p, i) => {
        const pulse = Math.sin(now / 70000 + i * 2.3) * 0.000035 + Math.sin(now / 17000 + i) * 0.000012;
        return { ...p, price: +(p.price + pulse).toFixed(p.quote === 'JPY' ? 3 : 5), change: +(p.change + Math.sin(now / 100000 + i) * 0.025).toFixed(2) };
      }) });
    }
    if (req.method === 'GET' && url.pathname === '/api/account') {
      const account = await readAccount();
      return json(res, 200, { watchlist: account.watchlist || [] });
    }
    if (req.method === 'GET' && url.pathname === '/api/registration/me') {
      const user = await registrationSession(req);
      return user ? json(res, 200, { registration:{ id:user.id, fullName:user.fullName, email:user.email, phone:user.phone, paymentStatus:user.paymentStatus } }) : json(res, 401, { error:'No active registration.' });
    }
    if (req.method === 'POST' && url.pathname === '/api/login') {
      try {
        const input = await body(req), email = String(input.email || '').trim().toLowerCase(), password = String(input.password || '');
        const user = await findRegistrationByEmail(email);
        if (!user || password.length > 128) return json(res, 401, { error:'Email or password is incorrect.' });
        const candidate = await scrypt(password, user.passwordSalt, 64), expected = Buffer.from(user.passwordHash, 'hex');
        if (candidate.length !== expected.length || !crypto.timingSafeEqual(candidate, expected)) return json(res, 401, { error:'Email or password is incorrect.' });
        const token = crypto.randomBytes(32).toString('hex');
        const sessionTokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const sessionExpiresAt = Date.now() + 24 * 60 * 60 * 1000;
        await updateRegistrationSession(user.id, sessionTokenHash, sessionExpiresAt);
        const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
        return json(res, 200, { registration:{ id:user.id, fullName:user.fullName, email:user.email, phone:user.phone, paymentStatus:user.paymentStatus } }, { 'Set-Cookie':`registration_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400${secure}` });
      } catch { return json(res, 400, { error:'Unable to sign in. Please try again.' }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/logout') {
      const user = await registrationSession(req);
      if (user) {
        await updateRegistrationSession(user.id, null, 0);
      }
      const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
      return json(res, 200, { message:'You are signed out.' }, { 'Set-Cookie':`registration_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}` });
    }
    if (req.method === 'POST' && url.pathname === '/api/register') {
      try {
        const input = await body(req);
        const fullName = String(input.fullName || '').trim(), email = String(input.email || '').trim().toLowerCase();
        const phone = normalizePhone(input.phone), password = String(input.password || '');
        if (fullName.length < 2 || fullName.length > 100) return json(res, 400, { error:'Enter your full name.' });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return json(res, 400, { error:'Enter a valid email address.' });
        if (!phone) return json(res, 400, { error:'Enter a valid Kenyan M-Pesa phone number.' });
        if (password.length < 8 || password.length > 128) return json(res, 400, { error:'Password must be between 8 and 128 characters.' });
        const existing = await findRegistrationByEmail(email);
        if (existing) return json(res, 409, { error:'An account with this email is already registered.' });
        const salt = crypto.randomBytes(16).toString('hex'), passwordHash = await scrypt(password, salt, 64);
        const token = crypto.randomBytes(32).toString('hex'), sessionExpiresAt = Date.now() + 24 * 60 * 60 * 1000;
        const sessionTokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const user = { id:crypto.randomUUID(), fullName, email, phone, passwordSalt:salt, passwordHash:passwordHash.toString('hex'), sessionTokenHash, sessionExpiresAt, createdAt:new Date().toISOString(), paymentStatus:'unpaid', paymentReference: null, transactionRequestId: null };
        await upsertRegistration(user);
        const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
        return json(res, 201, { registration:{ id:user.id, fullName:user.fullName, email:user.email }, message:'Registration complete. You can now continue to payment.' }, { 'Set-Cookie':`registration_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400${secure}` });
      } catch (error) { return json(res, 400, { error:'Unable to complete registration. Please check your details and try again.' }); }
    }
if (req.method === 'POST' && url.pathname === '/api/payments/stkpush') {
      try {
        const registrant = await registrationSession(req);
        if (!registrant) return json(res, 401, { error:'Register first to continue to payment.' });
        const apiKey = process.env.LIPAWIN_API_KEY;
        const businessId = process.env.LIPAWIN_BUSINESS_ID;
        if (!apiKey || !businessId) return json(res, 503, { error:'Payments are not configured on the server yet.' });
        const input = await body(req);
        const phone = normalizePhone(input.phone) || registrant.phone;
        if (!phone) return json(res, 400, { error: 'Enter a valid M-Pesa phone number.' });
        const reference = `FX-${Date.now()}-${Math.random().toString(36).slice(2,7).toUpperCase()}`;
        const payload = {
          amount: 2000,
          msisdn: phone,
          business_id: Number(businessId),
          reference
        };
        console.log('LipaWin STK Push payload:', JSON.stringify(payload));
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 15000);
        const response = await fetch('https://lipawin.com/api/stk_push.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
          body: JSON.stringify(payload),
          signal: ctrl.signal
        });
        clearTimeout(to);
        const responseText = await response.text();
        console.log('LipaWin response:', response.status, responseText);
        let result = {};
        try { result = JSON.parse(responseText); } catch { result = {}; }
        const isSuccess = response.ok && (result.success === true || result.success === 1 || result.status === 'success');
        if (!isSuccess) {
          const errorMsg = result.message || result.error || result.ResponseDescription || 'The payment provider could not start the STK Push. Try again later.';
          return json(res, 502, { error: errorMsg });
        }
        await updateRegistrationPayment(registrant.id, 'pending', reference, result.transaction_id || null);
        return json(res, 200, { message: result.message || 'STK Push request sent. Check your phone and complete the M-Pesa prompt.', reference, transactionRequestId: result.transaction_id || null });
      } catch (error) {
        const message = error.name === 'AbortError' ? 'Request timed out. Please try again.' : error.name === 'TimeoutError' ? 'The payment provider did not respond in time. Check your phone before retrying.' : 'Unable to reach the payment provider. Please try again later.';
        return json(res, 502, { error: message });
      }
    }
    if (req.method === 'PATCH' && url.pathname.startsWith('/api/watchlist/')) {
      try {
        const symbol = decodeURIComponent(url.pathname.split('/').pop());
        if (!pairs.some(p => p.symbol === symbol)) return json(res, 404, { error:'Currency pair not found.' });
        const input = await body(req), account = await readAccount();
        account.watchlist = account.watchlist || [];
        account.watchlist = input.saved ? [...new Set([...account.watchlist, symbol])] : account.watchlist.filter(s => s !== symbol);
        await saveAccount(account); return json(res, 200, { watchlist:account.watchlist });
      } catch (error) { return json(res, 400, { error:error.message }); }
    }
    if (req.method === 'GET' && url.pathname === '/api/debug/db') {
      const fs = require('node:fs');
      const path = require('node:path');
      const dbPath = path.join(__dirname, 'data', 'app.db');
      return json(res, 200, { 
        dbPath, 
        exists: fs.existsSync(dbPath),
        dirExists: fs.existsSync(path.join(__dirname, 'data')),
        cwd: process.cwd(),
        dataDir: path.join(__dirname, 'data')
      });
    }
    return json(res, 404, { error:'API route not found.' });
  }
  const requested = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const file = path.resolve(PUBLIC, `.${requested}`);
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (error, content) => {
    if (error) { res.writeHead(404, { 'Content-Type':'text/plain; charset=utf-8' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type':mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-cache' }); res.end(content);
  });
});

initDb().then(() => {
  server.listen(PORT, () => console.log(`Forex Trading is running at http://localhost:${PORT}`));
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});