# Trading Adapter V2 - Fase 2 Quick Start

**Status:** ✅ Production Ready (with mock executor)  
**Version:** 2.0.0-fase2  
**Tests:** 9/9 passed (100%)

---

## What's New in Fase 2?

🚀 **LLM Escalation Pipeline**  
- Rule engine autonomously handles 90% of decisions
- 10% eskaleres til LLM (Claude via OpenClaw)
- Timeout handling + fallback to WAIT

📊 **MACD Cross Detection**  
- Historisk buffer per symbol/timeframe
- Bullish/bearish cross detection
- Integreret med signal condenser

⚖️ **Daily Risk Assessment**  
- LLM analyserer performance + market conditions
- Justerer risk_multiplier (0.0 - 1.5)
- Kan opdatere rule engine parametre

🔧 **Enhanced Config Management**  
- GET /api/v1/config endpoint
- Validation af alle parametre
- Hard limits på risk_per_trade og leverage

---

## Quick Start

### 1. Run Tests

```bash
cd ~/projects/nofx/adapter-v2
./test-fase2.sh
```

Expected output:
```
Total tests:  9
Passed:       9
Failed:       0

✅ All tests passed!
```

### 2. Start OpenClaw (Required for LLM Escalation)

```bash
# In another terminal
openclaw gateway start
```

Verify OpenClaw is running:
```bash
curl http://localhost:18789/v1/status
```

### 3. Start Trading Adapter

```bash
cd ~/projects/nofx/adapter-v2

# Set environment variables
export PORT=8888
export API_TOKEN=my-secret-token
export CAPITAL=10000

# Start server
node src/index.js
```

You should see:
```
======================================================================
  Trading Adapter V2 - Rule Engine MVP
======================================================================

  Listening on:       http://0.0.0.0:8888
  Health check:       http://localhost:8888/api/v1/trading/health
  Trading API:        http://localhost:8888/api/v1/trading/decision
  Config get:         http://localhost:8888/api/v1/config
  Config update:      http://localhost:8888/api/v1/config/update
  Risk assessment:    http://localhost:8888/api/v1/risk/assess

  Capital:         $10000

  Current Config:
    Risk multiplier:  1.0
    Leverage:         5x
    Risk per trade:   2%
```

---

## API Endpoints

### Health Check

```bash
curl http://localhost:8888/api/v1/trading/health | jq
```

Response:
```json
{
  "status": "healthy",
  "version": "2.0.0-fase2",
  "mode": "rule-engine-llm-escalation",
  "uptime": 123.45,
  "config": {
    "risk_multiplier": 1.0,
    "leverage": 5,
    "risk_per_trade": 0.02
  },
  "escalationStats": {
    "totalEscalations": 0,
    "successRate": 0,
    "avgProcessingTimeMs": 0
  }
}
```

### Get Config

```bash
curl http://localhost:8888/api/v1/config | jq
```

### Update Config (Manual)

```bash
curl -X POST http://localhost:8888/api/v1/config/update \
  -H "Authorization: Bearer my-secret-token" \
  -H "Content-Type: application/json" \
  -d '{
    "risk_multiplier": 0.8,
    "updated_by": "manual",
    "notes": "Reducing risk due to high volatility"
  }' | jq
```

### Trigger Risk Assessment

```bash
curl -X POST http://localhost:8888/api/v1/risk/assess \
  -H "Authorization: Bearer my-secret-token" | jq
```

**Note:** Requires OpenClaw running on localhost:18789

Response:
```json
{
  "success": true,
  "assessment": {
    "risk_multiplier": 0.9,
    "reasoning": "Market showing signs of consolidation...",
    "alerts": ["Watch BTC funding rate"],
    "parameter_adjustments": {
      "rsi_oversold": 33
    }
  },
  "processingTimeMs": 1234
}
```

### Trading Decision (with Market Data)

```bash
curl -X POST http://localhost:8888/api/v1/trading/decision \
  -H "Authorization: Bearer my-secret-token" \
  -H "Content-Type: application/json" \
  -d @test_market_data.json | jq
```

Example market data format: see `test/fixtures/` (if created)

---

## Testing Without OpenClaw

If OpenClaw is not running, escalations will **automatically fallback to WAIT** (safety first).

You'll see:
```
[EscalationHandler] ❌ Escalation failed: OpenClaw connection error: ...
[EscalationHandler] 🛑 Fallback to WAIT due to error
```

This is by design! Better to miss a trade than make a bad decision.

---

## Logs

All logs are written to:
- **Trades:** `logs/trades.jsonl`
- **Escalations:** `logs/escalations.jsonl`

Example escalation log:
```json
{
  "timestamp": "2024-01-01T12:00:00Z",
  "symbol": "BTCUSDT",
  "triggers": ["contradictory_signals", "gray_zone_confidence"],
  "prompt": "# Trading Escalation...",
  "llmResponse": "{\"action\": \"wait\", \"confidence\": 60, ...}",
  "decision": {"action": "wait", "confidence": 60, ...},
  "processingTimeMs": 1234
}
```

---

## Configuration Files

### Default Parameters

File: `config/default-params.json`

Hot-reloadable! Changes are picked up every 5 seconds.

Key parameters:
- `riskManagement.risk_multiplier` (0.0 - 1.5)
- `ruleEngine.rsi_oversold` (20 - 40)
- `ruleEngine.rsi_overbought` (60 - 80)
- `ruleEngine.min_tf_alignment` (2 - 4)

**Hard limits (cannot be changed):**
- `riskManagement.risk_per_trade` = 0.02 (2%)
- `riskManagement.max_leverage` = 5x

---

## Common Issues

### 1. "OpenClaw timeout"

**Solution:** Start OpenClaw gateway:
```bash
openclaw gateway start
```

### 2. "Unauthorized"

**Solution:** Set API_TOKEN env var or pass correct token in Authorization header

### 3. Tests failing

**Solution:** Make sure no other instance is using port 8888:
```bash
lsof -ti:8888 | xargs kill -9
```

---

## Next Steps

1. **Integrate with NoFx Backend**
   - Point NoFx to http://localhost:8888/api/v1/trading/decision
   - Configure symbols to trade

2. **Setup Cron for Daily Risk Assessment**
   ```bash
   # Add to crontab
   0 8 * * * curl -X POST http://localhost:8888/api/v1/risk/assess -H "Authorization: Bearer my-secret-token"
   ```

3. **Monitor Escalation Rate**
   - Check `logs/escalations.jsonl`
   - Aim for 2-3% in calm markets, 30-40% in choppy markets

4. **Production Deployment**
   - Setup systemd service
   - Add monitoring (Prometheus)
   - Configure alerts (Discord/Telegram)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                   NoFx Backend (Go)                     │
│              Calculates EMA/RSI/MACD/ATR                │
└────────────────────┬────────────────────────────────────┘
                     │ Market Data
                     ▼
┌─────────────────────────────────────────────────────────┐
│              Trading Adapter V2 (Node.js)               │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ Signal       │  │ Rule Engine  │  │ Escalation   │ │
│  │ Condenser    │──│ (90% trades) │──│ Check        │ │
│  └──────────────┘  └──────────────┘  └──────┬───────┘ │
│                                              │          │
│                                   ┌──────────▼────────┐│
│                                   │ LLM Escalation    ││
│                                   │ (10% trades)      ││
│                                   └──────────┬────────┘│
└────────────────────────────────────────────┬───────────┘
                                             │
                      ┌──────────────────────▼──────────┐
                      │   OpenClaw (Claude Sonnet 4.5)  │
                      │   http://localhost:18789        │
                      └─────────────────────────────────┘
```

---

## Support

For questions or issues, refer to:
- **Full Report:** `FASE2_RAPPORT.md`
- **Architecture Doc:** `~/clawd/TRADING_ARCHITECTURE_V2.md`
- **Tests:** `./test-fase2.sh`

---

*Generated: 2026-02-20*  
*Version: 2.0.0-fase2*  
*License: Internal Use Only*
