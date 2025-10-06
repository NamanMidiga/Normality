# Normality
Hyper-local anonymous chat with discussion rooms and dynamic, worldwide trending topics (movies + memes).

## Run
- Development
  - Backend: `npm run dev` (Express + WebSocket on http://localhost:4322)
  - Frontend: `npm run client` (Vite on http://localhost:5175)
- Production-like
  - Build: `npm run client:build`
  - Start: `npm start` (serves `dist/` on http://localhost:4322)

## Discussion topics (pinned)
- Server rotates a pinned question per room every 5 minutes and on negative feedback (>60%).
- Topics are synthesized from worldwide trends (English movies + global memes) and Indian movies.

## Worldwide trends module
- File: `server/trends.js`
- Sources:
  - TMDB trending movies (daily)
  - Reddit top memes (daily)
  - Curated fallback prompts
  - Instagram is stubbed (add token to enable)
- Scheduler: refreshes daily by default.
- Debug: GET `/trends/status` (proxied in dev via Vite).

## Environment variables
- `TMDB_API_KEY` (required to pull trending movies)
- `TRENDS_REFRESH_MS` (optional; default 24h)
  - Example: `TRENDS_REFRESH_MS=3600000` refreshes hourly
- Instagram integration (optional): provide a Graph API token and we can wire an endpoint.

## Ports and endpoints
- Backend: http://localhost:4322
  - Health: `/health`
  - trends Status: `/trends/status`
  - WebSocket: `/ws`
- Frontend dev: http://localhost:5175 (proxies `/ws`, `/health`, `/trends`)

## Features
- Join Chat / Spectate
- Join Discussion: pinned topic banner, worldwide movies + memes, Indian cinema retained
- Real-time sentiment: auto-rotate topic if >60% express negative sentiment
- On-topic guardrails: only movies/cinema and memes conversation in discussion rooms

## Deploy to Render (recommended)

Render supports Blueprint deploys from `render.yaml`.

**One-click:**

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/NamanMidiga/Normality)

1) Push this repo to GitHub.
2) In Render Dashboard: New → Blueprint → pick this repo.
3) Confirm service settings (already defined in `render.yaml`):
   - Build Command: `npm ci && npm run client:build`
   - Start Command: `node server/index.js`
   - Health Check: `/health`
   - WebSocket endpoint: `/ws`
   - Node version: 20
4) Environment variables (optional but recommended):
   - `TMDB_API_KEY`: enables TMDB trending movies.
   - `TRENDS_REFRESH_MS`: override refresh interval.
   - Instagram Graph API (optional): `IG_ACCESS_TOKEN`, `IG_BUSINESS_USER_ID`, `IG_HASHTAGS`.

Notes:
- The server binds `process.env.PORT` (injected by Render) or 4322.
- Static assets are served from `dist/` by Express.
- WebSockets work on the same Render origin (`/ws`).

## Docker (optional)

This repo includes a `Dockerfile` for container-based platforms (Fly.io, Railway, VPS):

Build and run locally:

```bash
docker build -t normality:latest .
docker run -p 4322:4322 -e PORT=4322 normality:latest
```

On Fly.io:

```bash
fly launch  # accept defaults, creates fly.toml
fly deploy
```
