# OpenClaw Trading Adapter

Zero-cost AI trading decisions via OpenClaw integration.

## What This Is

This adapter allows NoFx to use Leeloo (your Claude Opus assistant) as the trading AI engine, eliminating LLM API costs.

**Cost savings:** $780-2,340/year vs traditional API approach

## Architecture

```
NoFx → HTTP POST → Adapter (localhost:8888) → OpenClaw → Leeloo → Trading Decision
```

## Files

- `trading-decision-adapter.js` - Main adapter service (Node.js)
- `TRADING_RESPONSE_TEMPLATE.md` - Reference guide for Leeloo's responses
- `openclaw-trading-adapter.service` - Systemd service file
- `.env.example` - Environment template

## Setup from Scratch

### 1. Copy Adapter Files

```bash
mkdir -p ~/.openclaw/workspace-opus/trading
cp openclaw/adapter/trading-decision-adapter.js ~/.openclaw/workspace-opus/trading/
cp openclaw/adapter/TRADING_RESPONSE_TEMPLATE.md ~/.openclaw/workspace-opus/trading/
cp openclaw/adapter/.env.example ~/.openclaw/workspace-opus/trading/.env
```

### 2. Generate API Token

```bash
# Generate random token
openssl rand -hex 32 > ~/.openclaw/workspace-opus/trading/.env
echo "OPENCLAW_TRADING_API_TOKEN=$(cat ~/.openclaw/workspace-opus/trading/.env)" > ~/.openclaw/workspace-opus/trading/.env
```

### 3. Create Trading Session

```bash
openclaw agent --session-id agent:opus:trading-main --message "You are a cryptocurrency trading AI. Analyze market data and make trading decisions."
```

### 4. Install Systemd Service

```bash
sudo cp openclaw/adapter/openclaw-trading-adapter.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable openclaw-trading-adapter
sudo systemctl start openclaw-trading-adapter
```

### 5. Verify

```bash
# Check service status
sudo systemctl status openclaw-trading-adapter

# Test health endpoint
curl http://localhost:8888/api/v1/trading/health
```

## Configuration in NoFx

In NoFx web UI (http://localhost:3000):

1. Go to Settings → AI Models
2. Add model:
   - Provider: `openclaw`
   - Name: `Leeloo Trading Engine`
   - Base URL: `http://localhost:8888`
   - API Token: (from `.env` file)
3. Enable the model
4. Create trader using this model

## Fixes Applied

### Fix 1: JSON Formatting (2026-02-15 18:53)
- **Problem:** Thousand separators in numbers (`68,169` → invalid JSON)
- **Fix:** `stripThousandSeparators()` function + explicit prompt instructions

### Fix 2: Missing Required Fields (2026-02-15 18:53)
- **Problem:** No stopLoss/takeProfit/leverage fields in responses
- **Fix:** Enhanced validation + calculation formulas from strategy parameters

### Fix 3: Position Size Calculation (2026-02-15 19:18)
- **Problem:** `positionSizeUsd = 0.00` or arbitrary percentages
- **Fix:** Correct formula: `positionSizeUsd = (confidence / 100) × maxPositionSize`

## Troubleshooting

**Service won't start:**
```bash
# Check if port 8888 is in use
lsof -ti:8888

# Kill conflicting process
lsof -ti:8888 | xargs kill -9

# Restart service
sudo systemctl restart openclaw-trading-adapter
```

**Check logs:**
```bash
# Systemd logs
journalctl -u openclaw-trading-adapter -f

# Adapter logs
tail -f ~/.openclaw/workspace-opus/trading/memory/adapter-$(date +%Y-%m-%d).log
```

## Performance

- **Processing time:** 30-70 seconds per decision (Opus + high thinking)
- **Suitable for:** Backtesting, swing trading
- **For live trading:** Consider Sonnet (low thinking) for <15s latency

## Version History

- **2026-02-15 19:30:** Position size calculation fix
- **2026-02-15 18:53:** JSON formatting + required fields fixes
- **2026-02-15 14:00:** Initial adapter implementation

## Support

See parent documentation:
- `/OPENCLAW_INTEGRATION.md` - Full integration guide
- `/OPENCLAW_QUICKSTART.md` - Quick setup guide
