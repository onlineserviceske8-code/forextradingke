let sqlClient = null;
function getSql() {
  if (!sqlClient && process.env.DATABASE_URL) {
    const { neon } = require('@neondatabase/serverless');
    sqlClient = neon(process.env.DATABASE_URL);
  }
  return sqlClient;
}

async function readAccount() {
  const sql = getSql();
  if (!sql) return { watchlist: ['EUR/USD','GBP/USD','USD/JPY','AUD/USD'] };
  const rows = await sql`SELECT watchlist FROM accounts LIMIT 1`;
  return rows[0] || { watchlist: ['EUR/USD','GBP/USD','USD/JPY','AUD/USD'] };
}

async function saveAccount(account) {
  const sql = getSql();
  if (!sql) return;
  await sql`
    UPDATE accounts SET watchlist = ${account.watchlist}, updated_at = NOW()
    WHERE id = (SELECT id FROM accounts LIMIT 1)
  `;
}

module.exports = async (req, res) => {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    try {
      const account = await readAccount();
      return res.json({ watchlist: account.watchlist || [] });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to fetch account' });
    }
  }

  if (req.method === 'PATCH') {
    try {
      const symbol = req.url.split('/').pop();
      const pairs = ['EUR/USD','GBP/USD','USD/JPY','USD/CHF','AUD/USD','USD/CAD','NZD/USD','EUR/GBP'];
      if (!pairs.includes(symbol)) return res.status(404).json({ error: 'Currency pair not found.' });
      
      const { saved } = req.body;
      const account = await readAccount();
      account.watchlist = account.watchlist || [];
      account.watchlist = saved ? [...new Set([...account.watchlist, symbol])] : account.watchlist.filter(s => s !== symbol);
      await saveAccount(account);
      return res.json({ watchlist: account.watchlist });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
};