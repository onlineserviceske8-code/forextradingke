const { neon } = require('@neondatabase/serverless');

let sqlClient = null;
function getSql() {
  if (!sqlClient && process.env.DATABASE_URL) {
    sqlClient = neon(process.env.DATABASE_URL);
  }
  return sqlClient;
}

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

async function readAccount() {
  const sql = getSql();
  if (!sql) return { watchlist: ['EUR/USD','GBP/USD','USD/JPY','AUD/USD'] };
  const rows = await sql`SELECT watchlist FROM accounts LIMIT 1`;
  return rows[0] || { watchlist: ['EUR/USD','GBP/USD','USD/JPY','AUD/USD'] };
}

module.exports = async (req, res) => {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const now = Date.now();
    const markets = pairs.map((p, i) => {
      const pulse = Math.sin(now / 70000 + i * 2.3) * 0.000035 + Math.sin(now / 17000 + i) * 0.000012;
      return { ...p, price: +(p.price + pulse).toFixed(p.quote === 'JPY' ? 3 : 5), change: +(p.change + Math.sin(now / 100000 + i) * 0.025).toFixed(2) };
    });
    res.json({ asOf: now, markets });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch markets' });
  }
};