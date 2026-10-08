const { readSettings } = require('./db');

const HOSTS = {
  practice: 'https://api-fxpractice.oanda.com',
  live: 'https://api-fxtrade.oanda.com'
};
const PRICE_TTL_MS = 4000;
const priceCache = new Map();

function config(settings) {
  const apiKey = (settings && settings.oandaApiKey) || process.env.OANDA_API_KEY || '';
  const accountId = (settings && settings.oandaAccountId) || process.env.OANDA_ACCOUNT_ID || '';
  const env = ((settings && settings.oandaEnv) === 'live' || process.env.OANDA_ENV === 'live') ? 'live' : 'practice';
  return { apiKey: String(apiKey).trim(), accountId: String(accountId).trim(), env, base: HOSTS[env] };
}

async function currentConfig() {
  return config(await readSettings());
}

function instrumentOf(symbol) {
  return String(symbol).replace(/[^A-Za-z0-9_]/g, '_').toUpperCase();
}

function maskKey(key) {
  const s = String(key || '');
  if (!s) return '';
  return s.length <= 8 ? '********' : '****' + s.slice(-4);
}

async function oandaFetch(cfg, path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${cfg.base}${path}`, {
      method: options.method || 'GET',
      headers: {
        'Authorization': `Bearer ${cfg.apiKey}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    });
    if (!res.ok) {
      let message = `OANDA returned ${res.status}`;
      try { const data = await res.json(); if (data.errorMessage) message = data.errorMessage; else if (data.error) message = String(data.error); } catch {}
      const err = new Error(message); err.status = res.status; throw err;
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function getPricing(settings) {
  const cfg = config(settings);
  if (!cfg.apiKey || !cfg.accountId) return null;
  const hit = priceCache.get(cfg.accountId);
  if (hit && Date.now() < hit.expires) return hit.prices;
  const instruments = 'EUR_USD,GBP_USD,USD_JPY,USD_CHF,AUD_USD,USD_CAD,NZD_USD,EUR_GBP';
  const data = await oandaFetch(cfg, `/v3/accounts/${encodeURIComponent(cfg.accountId)}/pricing?instruments=${instruments}`);
  const prices = {};
  for (const p of data.prices || []) {
    if (!p.bids || !p.asks || !p.bids.length || !p.asks.length || p.status !== 'tradeable') continue;
    const bid = Number(p.bids[0].price), ask = Number(p.asks[0].price);
    if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) continue;
    const symbol = p.instrument.replace('_', '/');
    const pip = symbol.endsWith('JPY') ? 0.01 : 0.0001;
    prices[symbol] = { bid, ask, mid: (bid + ask) / 2, spreadPips: Math.max(0.05, (ask - bid) / pip) };
  }
  priceCache.set(cfg.accountId, { prices, expires: Date.now() + PRICE_TTL_MS });
  return prices;
}

async function getSummary(settings) {
  const cfg = config(settings);
  const data = await oandaFetch(cfg, `/v3/accounts/${encodeURIComponent(cfg.accountId)}/summary`);
  return data.account || null;
}

async function getOpenTrades(settings) {
  const cfg = config(settings);
  const data = await oandaFetch(cfg, `/v3/accounts/${encodeURIComponent(cfg.accountId)}/openTrades`);
  return (data.trades || []).map(t => ({
    id: t.id,
    instrument: String(t.instrument || '').replace('_', '/'),
    units: Number(t.initialUnits || t.currentUnits || 0),
    price: Number(t.price || 0),
    unrealizedPL: Number(t.unrealizedPL || 0),
    openTime: t.openTime || null
  }));
}

async function getClosedTrades(settings, count = 20) {
  const cfg = config(settings);
  const data = await oandaFetch(cfg, `/v3/accounts/${encodeURIComponent(cfg.accountId)}/trades?state=CLOSED&count=${count}`);
  return (data.trades || []).map(t => ({
    id: t.id,
    instrument: String(t.instrument || '').replace('_', '/'),
    units: Number(t.initialUnits || 0),
    price: Number(t.price || 0),
    realizedPL: Number(t.realizedPL || 0),
    closeTime: t.closeTime || null
  }));
}

async function placeOrder(settings, symbol, units) {
  const cfg = config(settings);
  const instrument = instrumentOf(symbol);
  const total = Math.round(Number(units));
  if (!Number.isFinite(total) || total === 0) throw new Error('Order size must be a non-zero number.');
  const data = await oandaFetch(cfg, `/v3/accounts/${encodeURIComponent(cfg.accountId)}/orders`, {
    method: 'POST',
    body: { order: { type: 'MARKET', instrument, units: String(total), timeInForce: 'FOK' } }
  });
  const fill = data.orderFillTransaction || {};
  return {
    tradeId: fill.id || null,
    instrument: String(fill.instrument || instrument).replace('_', '/'),
    units: Number(fill.units || total),
    price: Number(fill.price || 0),
    realizedPL: Number(fill.realizedPL || 0)
  };
}

async function closeTrade(settings, tradeId) {
  const cfg = config(settings);
  const data = await oandaFetch(cfg, `/v3/accounts/${encodeURIComponent(cfg.accountId)}/trades/${encodeURIComponent(String(tradeId))}/close`, {
    method: 'PUT',
    body: {}
  });
  const fill = data.orderFillTransaction || {};
  return {
    tradeId,
    instrument: String(fill.instrument || '').replace('_', '/'),
    units: Number(fill.units || 0),
    price: Number(fill.price || 0),
    realizedPL: Number(fill.realizedPL || 0)
  };
}

module.exports = {
  config,
  currentConfig,
  instrumentOf,
  maskKey,
  getPricing,
  getSummary,
  getOpenTrades,
  getClosedTrades,
  placeOrder,
  closeTrade
};