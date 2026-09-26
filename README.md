# Forex Trading Dashboard

A full-stack foreign exchange dashboard with simulated trading account, registration, and M-Pesa payment integration.

## Local Development

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your values (DATABASE_URL optional for local dev)
# Start server
npm run dev
```

Server runs at `http://localhost:3000`

## Deploy to Render (Recommended)

Render runs the **exact same `server.js`** locally and in production.

### One-click Deploy

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/yourusername/forex-kenya)

### Manual Deploy

1. **Push to GitHub**
   ```bash
   git init && git add . && git commit -m "Initial commit"
   git remote add origin https://github.com/yourusername/forex-kenya.git
   git push -u origin main
   ```

2. **Create Render account** → [render.com](https://render.com)

3. **New Blueprint** → Connect your GitHub repo → Render detects `render.yaml`

4. **Add Environment Variables** in Render dashboard:
   - `PAYWAVE_API_KEY` = your key
   - `PAYWAVE_EMAIL` = your email
   - `ALLOWED_ORIGIN` = your Render URL (e.g., `https://forex-trading.onrender.com`)

5. **Deploy** - Render creates PostgreSQL database automatically via blueprint

### After Deploy

- Update `ALLOWED_ORIGIN` to your actual Render URL
- Test registration/payment flow

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Auto (Render) | PostgreSQL connection string |
| `PAYWAVE_API_KEY` | Yes | Paywave Xpress API key |
| `PAYWAVE_EMAIL` | Yes | Paywave account email |
| `ALLOWED_ORIGIN` | Yes | Your production URL for CORS |
| `NODE_ENV` | Auto | `production` on Render |

## Project Structure

```
├── server.js          # Main HTTP server (local + production)
├── lib/db.js          # Database layer (PostgreSQL via pg)
├── public/            # Static frontend
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── render.yaml        # Render Blueprint config
├── package.json
└── .env.example
```

## API Endpoints

- `GET /api/markets` - Live currency rates
- `GET /api/account` - User watchlist
- `PATCH /api/watchlist/:symbol` - Toggle watchlist
- `GET /api/registration/me` - Current user
- `POST /api/register` - Create account
- `POST /api/login` - Sign in
- `POST /api/logout` - Sign out
- `POST /api/payments/stkpush` - M-Pesa STK Push