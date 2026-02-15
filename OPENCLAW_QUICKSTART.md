# OpenClaw Integration - Quick Start

**Get trading with zero API costs in 5 minutes**

---

## Prerequisites

- ✅ OpenClaw Gateway installed and running
- ✅ OpenClaw Trading Adapter running on `http://localhost:8888`
- ✅ API token from adapter

---

## Quick Setup (5 steps)

### 1. Get Your API Token

```bash
grep OPENCLAW_TRADING_API_TOKEN ~/.openclaw/workspace-opus/trading/.env | cut -d= -f2
```

Copy the token (e.g., `a73be04997771d09871823955a37be6349347655898034076b57251631fbf217`)

### 2. Configure NoFx

Add to `/home/thomas/nofx/.env`:

```bash
OPENCLAW_BASE_URL=http://localhost:8888
OPENCLAW_API_TOKEN=a73be04997771d09871823955a37be6349347655898034076b57251631fbf217
```

### 3. Add AI Model via Web UI

1. Open NoFx: `http://localhost:3000`
2. Go to **Settings → AI Models**
3. Click **"Add AI Model"**
4. Fill in:
   - Provider: `openclaw`
   - Name: `Leeloo Trading Engine`
   - Base URL: `http://localhost:8888`
   - API Token: (paste from step 1)
   - Model Name: `claude-opus-leeloo`
5. Click **"Save"**
6. Enable the model

### 4. Create a Trader

1. Go to **Traders** page
2. Click **"Create Trader"**
3. Configure:
   - Name: `My First OpenClaw Trader`
   - AI Model: `Leeloo Trading Engine`
   - Exchange: (select your exchange)
   - Strategy: (select your strategy)
   - Scan Interval: `15` minutes
4. Click **"Save"**

### 5. Start Trading!

Click **"Start"** on your trader.

Watch the logs:
```bash
tail -f /home/thomas/nofx/logs/nofx.log | grep -i openclaw
```

---

## Verify It's Working

### Test 1: Health Check

```bash
curl http://localhost:8888/api/v1/trading/health
```

Should return: `{"status":"healthy"}`

### Test 2: Sample Decision

```bash
export TOKEN=a73be04997771d09871823955a37be6349347655898034076b57251631fbf217

curl -X POST http://localhost:8888/api/v1/trading/decision \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "systemPrompt": "You are a crypto trader",
    "userPrompt": "{\"account\":{\"equity\":10000}}"
  }' | jq
```

Should return JSON with trading decisions.

---

## What's Happening?

```
NoFx → Collects market data
  ↓
NoFx → Sends to OpenClaw adapter (http://localhost:8888)
  ↓
Adapter → Forwards to Leeloo (Claude Opus via OpenClaw)
  ↓
Leeloo → Analyzes with Chain of Thought reasoning
  ↓
Leeloo → Returns structured trading decision
  ↓
NoFx → Executes trade on exchange
```

---

## Monitoring

**Decision logs (Leeloo's thoughts):**
```bash
tail -f ~/.openclaw/workspace-opus/trading/memory/$(date +%Y-%m-%d).md
```

**Adapter logs:**
```bash
journalctl -u openclaw-trading-adapter -f
```

**NoFx logs:**
```bash
tail -f /home/thomas/nofx/logs/nofx.log
```

---

## Troubleshooting

**Connection refused?**
```bash
systemctl status openclaw-trading-adapter
sudo systemctl start openclaw-trading-adapter
```

**Unauthorized error?**
```bash
# Verify token matches:
grep OPENCLAW_TRADING_API_TOKEN ~/.openclaw/workspace-opus/trading/.env
```

**Slow responses?**
```bash
# Check OpenClaw status:
openclaw status

# Verify Leeloo session:
openclaw agent --session-id agent:opus:trading-main --message "ping"
```

---

## Next Steps

1. **Customize Strategy:**  
   Edit `~/.openclaw/workspace-opus/trading/TRADING_STRATEGY.md`

2. **Review Decisions:**  
   Check `~/.openclaw/workspace-opus/trading/memory/YYYY-MM-DD.md`

3. **Add More Traders:**  
   Create multiple traders using the same OpenClaw AI model

4. **Monitor Performance:**  
   Track win rate, P&L, decision quality

---

## Cost Savings

**Before:** $300-600/month in API costs  
**After:** $0 (uses Claude Max subscription)

**Savings:** 100% of LLM API costs! 🎉

---

**Full Documentation:** See `OPENCLAW_INTEGRATION.md`
