# OpenClaw Integration Guide for NoFx

**AI-Powered Trading Without API Costs**

This guide explains how to integrate NoFx with OpenClaw, using Leeloo (Claude Opus) as the AI decision engine. This eliminates external LLM API costs while providing sophisticated trading analysis.

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Installation](#installation)
4. [Configuration](#configuration)
5. [Usage](#usage)
6. [Testing](#testing)
7. [Troubleshooting](#troubleshooting)
8. [Architecture](#architecture)

---

## Overview

### What is OpenClaw Integration?

OpenClaw integration allows NoFx to use Leeloo (an AI agent running on Claude Opus via OpenClaw) as the trading decision engine instead of making direct API calls to external LLM providers.

### Benefits

✅ **Zero LLM API costs** - Uses Claude Max subscription (no per-token charges)  
✅ **Full reasoning transparency** - Chain of Thought logged for every decision  
✅ **Code-enforced risk limits** - Safety constraints not AI-decided  
✅ **Complete audit trail** - Every decision recorded with reasoning  
✅ **Low latency** - Local communication, <15s decision time  
✅ **High intelligence** - Full Claude Opus 4 capabilities

### Architecture Flow

```
NoFx Trading Bot
    ↓ HTTP POST
OpenClaw Trading Adapter (Node.js)
    ↓ OpenClaw CLI
Leeloo Trading Session (Claude Opus)
    ↓ Analysis & Decision
Trading Adapter → NoFx
    ↓ Execute Trades
Exchange (Binance/Bybit/OKX/etc.)
```

---

## Prerequisites

### Required

1. **OpenClaw Gateway** running and accessible
   - Install from: https://github.com/OpenClaw/openclaw
   - Status check: `openclaw status`

2. **OpenClaw Trading Adapter** running
   - Location: `~/.openclaw/workspace-opus/trading/`
   - Documentation: See `trading/README.md` in OpenClaw workspace
   - Default URL: `http://localhost:8888`

3. **NoFx** installed
   - This repository

4. **Claude Max Subscription** (optional but recommended)
   - Provides unlimited Claude Opus access via web
   - OpenClaw leverages this for zero API costs

### Optional

- **API Token** from OpenClaw adapter (for authentication)
- **Binance/Bybit/OKX account** (for live trading)

---

## Installation

### Step 1: Install OpenClaw Trading Adapter

```bash
# Navigate to OpenClaw workspace
cd ~/.openclaw/workspace-opus/trading

# Run setup script (generates API token, creates systemd service)
sudo bash setup.sh

# Create trading session for Leeloo
bash create-trading-session.sh

# Verify adapter is running
curl http://localhost:8888/api/v1/trading/health
```

**Expected output:**
```json
{
  "status": "healthy",
  "session": "agent:opus:trading-main",
  "timestamp": "2026-02-15T14:30:00Z"
}
```

### Step 2: Configure NoFx

The OpenClaw integration code is already included in NoFx. No additional installation needed!

---

## Configuration

### Method 1: Environment Variables (Recommended)

Create or edit `/home/thomas/nofx/.env`:

```bash
# OpenClaw Configuration
OPENCLAW_BASE_URL=http://localhost:8888
OPENCLAW_API_TOKEN=your-token-here
```

**Get your API token:**
```bash
grep OPENCLAW_TRADING_API_TOKEN ~/.openclaw/workspace-opus/trading/.env | cut -d= -f2
```

### Method 2: Web Interface

1. Access NoFx web interface: `http://localhost:3000`
2. Navigate to **AI Models** configuration
3. Click **"Add AI Model"**
4. Select **Provider:** `openclaw`
5. Enter configuration:
   - **Name:** `Leeloo Trading Engine`
   - **Base URL:** `http://localhost:8888`
   - **API Token:** (from step above)
   - **Model Name:** `claude-opus-leeloo` (display only)
6. Click **"Save"**

### Method 3: Database Direct Insert

```sql
INSERT INTO ai_models (id, user_id, name, provider, enabled, api_key, custom_api_url, created_at, updated_at)
VALUES (
    'openclaw_leeloo',
    'default',
    'Leeloo Trading Engine (OpenClaw)',
    'openclaw',
    true,
    'your-api-token-here',
    'http://localhost:8888',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);
```

---

## Usage

### Create a Trader with OpenClaw

#### Via Web Interface

1. Navigate to **Traders** page
2. Click **"Create Trader"**
3. Configure:
   - **Name:** `BTC Strategy - Leeloo`
   - **AI Model:** Select `Leeloo Trading Engine`
   - **Exchange:** Select your exchange account
   - **Strategy:** Select your trading strategy
4. Click **"Save"**
5. Click **"Start"** to begin trading

#### Via API

```bash
curl -X POST http://localhost:8080/api/traders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "name": "BTC Strategy - Leeloo",
    "ai_model_id": "openclaw_leeloo",
    "exchange_id": "binance_main",
    "strategy_id": "default_strategy",
    "scan_interval_minutes": 15,
    "initial_balance": 10000,
    "is_running": true
  }'
```

---

## Testing

### Test 1: Health Check

Verify the OpenClaw adapter is running:

```bash
curl http://localhost:8888/api/v1/trading/health
```

**Expected:** `{"status": "healthy", ...}`

### Test 2: Sample Trading Decision

Test a trading decision request:

```bash
export API_TOKEN=$(grep OPENCLAW_TRADING_API_TOKEN ~/.openclaw/workspace-opus/trading/.env | cut -d= -f2)

curl -X POST http://localhost:8888/api/v1/trading/decision \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_TOKEN" \
  -d '{
    "systemPrompt": "You are an expert cryptocurrency trader.",
    "userPrompt": "{\"account\":{\"equity\":10000},\"positions\":[],\"market_data\":{\"BTCUSDT\":{\"price\":45000,\"rsi\":60}}}"
  }' | jq
```

**Expected:** JSON with `decisions` array and `cotTrace`

### Test 3: NoFx Integration Test

Run NoFx with OpenClaw AI model:

```bash
cd /home/thomas/nofx

# Start NoFx
./nofx

# In another terminal, check logs for OpenClaw usage
tail -f logs/nofx.log | grep -i openclaw
```

**Expected log entries:**
```
🤖 [Trader Name] Using OpenClaw (Leeloo) AI Engine: http://localhost:8888
📡 [OpenClaw] Requesting trading decision from Leeloo
✓ [OpenClaw] Received N trading decisions from Leeloo (took XXXms)
```

### Test 4: Unit Tests

Run the OpenClaw client unit tests:

```bash
cd /home/thomas/nofx
go test ./openclaw/ -v
go test ./mcp/ -run OpenClaw -v
```

**Expected:** All tests pass

---

## Troubleshooting

### Issue 1: "Connection refused" error

**Symptom:**
```
Failed to connect to http://localhost:8888: connection refused
```

**Solutions:**

1. Check if adapter is running:
   ```bash
   systemctl status openclaw-trading-adapter
   ```

2. Start the adapter:
   ```bash
   sudo systemctl start openclaw-trading-adapter
   ```

3. Check logs:
   ```bash
   journalctl -u openclaw-trading-adapter -f
   ```

### Issue 2: "Unauthorized" error

**Symptom:**
```
API error (status 401): Unauthorized
```

**Solution:**

1. Verify API token is correct:
   ```bash
   grep OPENCLAW_TRADING_API_TOKEN ~/.openclaw/workspace-opus/trading/.env
   ```

2. Update NoFx configuration with correct token

3. Restart NoFx

### Issue 3: Slow response times (>30s)

**Symptom:**
Trading decisions take longer than 30 seconds

**Solutions:**

1. Check OpenClaw Gateway status:
   ```bash
   openclaw status
   ```

2. Verify Leeloo session is active:
   ```bash
   openclaw agent --session-id agent:opus:trading-main --message "ping"
   ```

3. Reduce market data complexity (send fewer indicators/candles)

4. Check system resources (CPU/memory usage)

### Issue 4: Invalid JSON response

**Symptom:**
```
Failed to parse response: invalid JSON
```

**Solutions:**

1. Check adapter logs for errors:
   ```bash
   tail -f ~/.openclaw/workspace-opus/trading/memory/adapter-$(date +%Y-%m-%d).log
   ```

2. Verify Leeloo is returning structured responses:
   ```bash
   openclaw agent --session-id agent:opus:trading-main \
     --message "Return this JSON: [{\"symbol\":\"BTCUSDT\",\"action\":\"wait\"}]"
   ```

3. Review `TRADING_STRATEGY.md` to ensure prompt enforces JSON output

### Issue 5: NoFx doesn't recognize OpenClaw provider

**Symptom:**
```
Unsupported AI provider: openclaw
```

**Solution:**

This means the NoFx installation doesn't include OpenClaw integration. Ensure you're using the version with OpenClaw support:

```bash
cd /home/thomas/nofx
go build -o nofx
./nofx --version
```

---

## Architecture

### Request Flow

1. **NoFx** collects market data (prices, indicators, positions)
2. **NoFx** formats data as JSON and sends HTTP POST to OpenClaw adapter
3. **OpenClaw Adapter** receives request, validates, forwards to Leeloo
4. **Leeloo** analyzes market data using Chain of Thought reasoning
5. **Leeloo** returns structured JSON with trading decisions
6. **OpenClaw Adapter** parses response, returns to NoFx
7. **NoFx** validates decisions, applies risk checks, executes trades

### Components

```
┌─────────────────────────────────────────────────────────────┐
│  NoFx Trading System                                         │
│  ┌────────────────────────────────────────────────────┐    │
│  │  mcp/openclaw_client.go                            │    │
│  │  - Implements AIClient interface                   │    │
│  │  - HTTP client to OpenClaw adapter                 │    │
│  │  - Request/response marshaling                     │    │
│  └────────────────────────────────────────────────────┘    │
│                         │                                    │
│                         ▼ HTTP POST                          │
├─────────────────────────────────────────────────────────────┤
│  OpenClaw Trading Adapter (Node.js)                         │
│  ~/.openclaw/workspace-opus/trading/                        │
│  ┌────────────────────────────────────────────────────┐    │
│  │  trading-decision-adapter.js                       │    │
│  │  - HTTP server on port 8888                        │    │
│  │  - Bearer token authentication                     │    │
│  │  - Request validation                              │    │
│  │  - OpenClaw CLI invocation                         │    │
│  └────────────────────────────────────────────────────┘    │
│                         │                                    │
│                         ▼ OpenClaw CLI                       │
├─────────────────────────────────────────────────────────────┤
│  Leeloo Trading Session                                     │
│  agent:opus:trading-main                                    │
│  ┌────────────────────────────────────────────────────┐    │
│  │  TRADING_STRATEGY.md (strategy rules)              │    │
│  │  RISK_LIMITS.md (safety constraints)               │    │
│  │  memory/YYYY-MM-DD.md (decision logs)              │    │
│  └────────────────────────────────────────────────────┘    │
│                         │                                    │
│                         ▼ Claude Opus 4                      │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

**Request (NoFx → OpenClaw):**
```json
{
  "systemPrompt": "Trading strategy rules and constraints",
  "userPrompt": "{\"account\":{...}, \"positions\":[...], \"market_data\":{...}}",
  "metadata": {
    "requestId": "nofx-1234567890",
    "timestamp": "2026-02-15T14:30:00Z",
    "exchange": "binance",
    "symbols": ["BTCUSDT", "ETHUSDT"]
  }
}
```

**Response (OpenClaw → NoFx):**
```json
{
  "decisions": [
    {
      "symbol": "ETHUSDT",
      "action": "open_long",
      "leverage": 3,
      "positionSizeUsd": 500,
      "stopLoss": 2450,
      "takeProfit": 2650,
      "confidence": 75,
      "reasoning": "Strong uptrend with EMA crossover..."
    }
  ],
  "cotTrace": "Full Chain of Thought analysis...",
  "timestamp": "2026-02-15T14:30:15Z",
  "processingTimeMs": 12450
}
```

---

## Performance Metrics

### Expected Performance

- **Latency:** 5-15 seconds per decision (local communication)
- **Throughput:** 4-12 decisions per minute
- **Reliability:** >99% uptime (local service)
- **Cost:** $0 API charges (uses Claude Max subscription)

### Monitoring

**Check decision logs:**
```bash
tail -f ~/.openclaw/workspace-opus/trading/memory/$(date +%Y-%m-%d).md
```

**Check adapter performance:**
```bash
journalctl -u openclaw-trading-adapter -f | grep "processingTimeMs"
```

**Monitor NoFx logs:**
```bash
tail -f /home/thomas/nofx/logs/nofx.log | grep -i openclaw
```

---

## Security

### API Token Management

- **Storage:** Keep token in `.env` file with `chmod 600` permissions
- **Transmission:** Use HTTPS for production deployments
- **Rotation:** Regenerate token monthly or after suspected compromise

**Regenerate token:**
```bash
cd ~/.openclaw/workspace-opus/trading
openssl rand -hex 32 > .env.tmp
echo "OPENCLAW_TRADING_API_TOKEN=$(cat .env.tmp)" >> .env
rm .env.tmp
sudo systemctl restart openclaw-trading-adapter
```

### Network Security

**For production (remote access):**

1. Use HTTPS reverse proxy (nginx/Caddy)
2. Firewall rules to restrict access
3. VPN or SSH tunnel for remote connections

**Example nginx config:**
```nginx
server {
    listen 443 ssl;
    server_name trading.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location /api/v1/trading/ {
        proxy_pass http://localhost:8888;
        proxy_set_header Authorization $http_authorization;
    }
}
```

---

## Cost Analysis

### Before OpenClaw (API Costs)

**Example usage:**
- 1 trader
- 15-minute intervals (96 decisions/day)
- Average 2,000 tokens per decision
- Claude Opus API: $15/million input tokens, $75/million output tokens

**Daily cost:** ~$10-20/day = **$300-600/month**

### After OpenClaw (Zero API Costs)

**Same usage:**
- Unlimited decisions
- Full Claude Opus 4 intelligence
- **Cost: $0** (included in Claude Max subscription)

**Savings:** $300-600/month per trader

---

## Support & Resources

### Documentation

- **OpenClaw Trading Adapter:** `~/.openclaw/workspace-opus/trading/README.md`
- **Trading Strategy:** `~/.openclaw/workspace-opus/trading/TRADING_STRATEGY.md`
- **Risk Limits:** `~/.openclaw/workspace-opus/trading/RISK_LIMITS.md`

### Logs

- **Adapter logs:** `journalctl -u openclaw-trading-adapter -f`
- **Decision logs:** `~/.openclaw/workspace-opus/trading/memory/YYYY-MM-DD.md`
- **NoFx logs:** `/home/thomas/nofx/logs/nofx.log`

### Community

- **NoFx Official:** [@nofx_official](https://x.com/nofx_official)
- **OpenClaw:** [GitHub](https://github.com/OpenClaw/openclaw)

---

## FAQ

**Q: Can I use multiple NoFx traders with one OpenClaw adapter?**  
A: Yes! The adapter can handle multiple concurrent requests.

**Q: What if OpenClaw adapter crashes?**  
A: NoFx will retry the request. The adapter auto-restarts via systemd.

**Q: Can I customize Leeloo's trading strategy?**  
A: Yes! Edit `~/.openclaw/workspace-opus/trading/TRADING_STRATEGY.md`

**Q: Does this work with all exchanges?**  
A: Yes! OpenClaw integration works with all exchanges supported by NoFx.

**Q: Can I see Leeloo's reasoning for each trade?**  
A: Yes! Chain of Thought is logged in daily memory files.

**Q: What if I don't have Claude Max subscription?**  
A: You can still use OpenClaw with regular Claude API access, but API costs will apply to the OpenClaw layer.

---

**Created by:** Leeloo (OpenClaw Subagent)  
**Date:** 2026-02-15  
**Version:** 1.0.0  
**Status:** Production Ready ✅
