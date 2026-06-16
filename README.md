# Polymarket Telegram Alerts Bot

A Telegram bot that sends real-time Polymarket alerts -- probability spikes, price movements, new trades, and more -- powered by [Struct](https://struct.to) webhooks and running on Cloudflare Workers.

> **Note:** This codebase has not been tested thoroughly and may include bugs. It is best used as a reference or starting point to build from.

## Features

### Market Monitoring

Send any Polymarket URL to the bot and choose from:

- **Probability Spike** -- rapid probability changes on an outcome. Filter by minimum change %, direction (up/down), and time window.
- **Price Spike** -- rapid price movements. Filter by minimum change %, direction, time window, and a min/max price band so low-price markets (where a 1¢ move is a huge %) don't spam you.
- **Price Threshold** -- an outcome's price crosses a target level. Filter by min/max price.
- **Market Metrics** -- periodic activity summaries (volume, fees, transactions). Filter by volume range, min fees, min transactions, and timeframes (1m to 30d).
- **Volume Spike** -- a market's volume grows by a configured multiple within a window. Filter by minimum spike multiple and timeframes.
- **Volume Milestone** -- a market's cumulative volume crosses a USD milestone. Filter by timeframes.
- **Close-to-Bond Trade** -- trades near bond price levels. Filter by probability range.

Price Spike, Price Threshold, and Close-to-Bond also support **Tag** and **Series** filters (comma-separated lists) to scope alerts to markets carrying specific tags/categories or belonging to a series.

### Trader Monitoring

Use `/trader <wallet_address>` to watch any wallet:

- **First Trade** -- first-ever transaction from the wallet.
- **New Market Entry** -- wallet enters a market it hasn't traded before.
- **All Trades** -- every fill-style trade by the wallet. Raise the min USD filter to get whale-sized trades only.
- **Global PnL** -- the wallet's overall realized PnL crosses a threshold over a timeframe. Filter by min PnL, min volume, and timeframe.

First Trade and All Trades support min USD amount (minimum $1) and probability range filters.

### Tag & Series Monitoring

Use `/tag <tag>` or `/series <slug>` to alert across **all** markets carrying a tag/category or belonging to a series -- no specific market required:

- **`/tag Sports`** -- monitor every market in the `Sports` tag/category (e.g. `/tag "FIFA World Cup"`).
- **`/series nfl`** -- monitor every market in the `nfl` series (use the series slug from the Polymarket URL, e.g. `nfl`, `epl`).

Pick **Price Spike**, **Price Threshold**, or **Close-to-Bond** as the event type, then configure the same filters as the market flow. The tag/series itself is the scope, so those filter buttons are hidden.

### How It Works

The bot uses an interactive conversation flow -- after you send a market URL, wallet address, or a `/tag`/`/series` command, it presents inline keyboards to pick an event type, configure optional filters, and confirm. Each monitor registers a webhook through the Struct API, with alerts delivered to your Telegram chat in real time.

## Tech Stack

- **Cloudflare Workers** -- serverless runtime
- **Cloudflare D1** -- SQLite database at the edge
- **grammY** -- Telegram bot framework
- **@structbuild/sdk** -- Struct API client
- **TypeScript**

## Prerequisites

- Node.js 18+
- A Cloudflare account (free tier works)
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))
- A Struct API key (from [struct.to](https://struct.to))

## Setup

```bash
git clone https://github.com/structbuild/polymarket-telegram-alerts-bot.git
cd polymarket-telegram-alerts-bot
npm install
```

Copy the example config files and fill in your credentials:

```bash
cp wrangler.toml.example wrangler.toml
cp .dev.vars.example .dev.vars
```

```
BOT_TOKEN=your-telegram-bot-token
STRUCT_API_KEY=your-struct-api-key
STRUCT_WEBHOOK_SECRET=your-webhook-signing-secret
```

`STRUCT_WEBHOOK_SECRET` is a random string you generate yourself -- used to verify incoming webhook payloads via HMAC-SHA256:

```bash
openssl rand -hex 32
```

Then run the automated setup:

```bash
npm run setup
```

This single command:
1. Validates your `.dev.vars` credentials
2. Fetches bot metadata from the Telegram API
3. Creates the D1 database
4. Runs the schema migration
5. Pushes secrets to Cloudflare
6. Deploys the Worker
7. Sets the Telegram webhook to your Worker URL

### Manual Setup

If you prefer full control over each step:

**1.** Fill in `.dev.vars` with your `BOT_TOKEN`, `STRUCT_API_KEY`, and `STRUCT_WEBHOOK_SECRET`.

**2.** Get bot info and add it to `wrangler.toml` under `[vars]`:

```bash
curl https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getMe
```

Copy the `result` JSON into `wrangler.toml` as `BOT_INFO = '<JSON>'`.

**3.** Create the D1 database and update `database_id` in `wrangler.toml`:

```bash
npx wrangler d1 create polymarket-alerts
```

**4.** Run the schema migration:

```bash
npx wrangler d1 execute polymarket-alerts --remote --file=./src/db/schema.sql
```

**5.** Push secrets:

```bash
npx wrangler secret put BOT_TOKEN
npx wrangler secret put STRUCT_API_KEY
npx wrangler secret put STRUCT_WEBHOOK_SECRET
```

**6.** Update `WEBHOOK_BASE_URL` in `wrangler.toml` to your Worker URL.

**7.** Deploy:

```bash
npx wrangler deploy
```

**8.** Set the Telegram webhook:

```bash
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://<YOUR_WORKER>.workers.dev/telegram"
```

## Bot Commands

Telegram's command menu/autocomplete is synced when you run `npm run setup`, `npm run webhook:prod`, or `npm run dev`.

| Command | Description |
|---|---|
| `/start` | Register and show the main menu |
| `/help` | Show available alert types |
| `/list` | View your active monitors |
| `/unsubscribe` | Remove monitors via inline buttons |
| `/trader <address>` | Start monitoring a wallet |
| `/tag <tag>` | Monitor all markets with a tag/category |
| `/series <slug>` | Monitor all markets in a series |
| `/example [1-11]` | Preview each alert format |

You can also send a **Polymarket URL** directly to start setting up a market monitor, or a **wallet address** (`0x...`) to start setting up a trader monitor.

## Development

### Local dev server

```bash
npm run dev
```

This:
1. Starts the Wrangler dev server (connected to your real D1 database, secrets from `.dev.vars`)
2. Opens a cloudflared tunnel to expose it publicly
3. Temporarily updates `.dev.vars` so `WEBHOOK_BASE_URL` points to the tunnel
4. Points the Telegram webhook to the tunnel URL

When you press Ctrl+C, it automatically restores the production Telegram webhook and resets the temporary `WEBHOOK_BASE_URL` override.

Requires `cloudflared` -- install with `npm i -g cloudflared`.

For a fully local D1 (no remote calls), run `npm run db:migrate:local` first, then `npm run dev:local`.

### Deploying updates

```bash
npm run deploy
```

Secrets, D1, and the Telegram webhook persist across deploys. Only re-run `npm run setup` if you need to change your bot token, recreate the database, or start fresh.

### Schema migrations

```bash
npm run db:migrate          # remote D1
npm run db:migrate:local    # local D1
```

## Architecture

The Worker exposes three endpoints:

- **`POST /telegram`** -- Telegram updates via grammY's webhook callback
- **`POST /struct/webhook`** -- event payloads from Struct
- **`GET /health`** -- uptime check

### Event Flow

```
Struct fires webhook
  -> POST /struct/webhook
  -> Verify HMAC signature (x-struct-signature header)
  -> Detect event type
  -> Enrich with market data from Struct SDK
  -> Query D1 for matching monitors (by condition_id or wallet_address)
  -> Format alert message
  -> Send Telegram messages to all matched users
```

## Project Structure

```
src/
├── index.ts                          # Worker entry point, request routing
├── env.ts                            # Environment type definitions
├── bot/
│   ├── setup.ts                      # Bot creation and command registration
│   ├── commands/
│   │   ├── start.ts                  # /start
│   │   ├── help.ts                   # /help
│   │   ├── trader.ts                 # /trader <address>
│   │   ├── list.ts                   # /list
│   │   ├── unsubscribe.ts            # /unsubscribe
│   │   └── example.ts                # /example
│   ├── handlers/
│   │   └── text.ts                   # Parses Polymarket URLs and wallet addresses
│   ├── callbacks/
│   │   └── handler.ts                # Inline keyboard callback handler
│   ├── menus/
│   │   └── main.ts                   # Main menu and submenus
│   └── keyboards/
│       └── filters.ts                # Filter definitions and keyboard builders
├── db/
│   ├── schema.sql                    # D1 database schema
│   ├── users.ts                      # User upsert/queries
│   ├── monitors.ts                   # Monitor CRUD and subscriber lookups
│   └── drafts.ts                     # Draft state for monitor creation flow
├── services/
│   ├── market-lookup.ts              # Market data via Struct SDK
│   ├── message-builder.ts            # Alert message formatting
│   └── notification.ts               # Telegram message delivery
├── struct/
│   ├── client.ts                     # Struct SDK client factory
│   ├── event-handler.ts              # Incoming webhook processing
│   └── webhook-manager.ts            # Webhook lifecycle management
├── types/
│   └── database.ts                   # D1 row type definitions
└── utils/
    ├── formatting.ts                 # HTML formatting helpers
    └── hmac.ts                       # HMAC signature verification
```

## License

MIT
