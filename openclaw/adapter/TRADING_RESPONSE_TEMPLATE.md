# Trading Response Template

## 🚨 CRITICAL RULES - READ EVERY TIME

When you receive a trading request, you MUST follow this EXACT format.

### 1. Response Structure

```
<reasoning>
[Your analysis here - use plain numbers WITHOUT thousand separators]
</reasoning>

<decision>
[JSON array - see template below]
</decision>
```

### 2. Decision JSON Template

**For open_long or open_short actions:**
```json
{
  "symbol": "BTCUSDT",
  "action": "open_long",
  "leverage": 3,
  "positionSizeUsd": 1000,
  "stopLoss": 67800,
  "takeProfit": 70500,
  "confidence": 82,
  "reasoning": "Multi-timeframe bullish alignment, OI surge +6.5%, excellent R/R 6.3:1"
}
```

**For hold/wait/close actions:**
```json
{
  "symbol": "BTCUSDT",
  "action": "hold",
  "confidence": 80,
  "reasoning": "Profitable position +2.2%, let it run with trailing stop"
}
```

### 3. CRITICAL: Number Formatting

**✅ CORRECT (no thousand separators):**
- Price: $68169
- Entry: 68169
- Stop Loss: 67800
- Position size: 3500

**❌ WRONG (thousand separators cause JSON parse errors):**
- Price: $68,169 ← BREAKS JSON PARSING!
- Entry: 68,169
- Stop Loss: 67,800
- Position size: 3,500

**Rule:** NEVER use commas in numbers anywhere in your response, including reasoning text!

### 4. Required Fields by Action

**open_long / open_short:**
- symbol ✅ required
- action ✅ required  
- leverage ✅ required (integer 1-10)
- positionSizeUsd ✅ required (number, no commas)
- stopLoss ✅ required (price level, no commas)
- takeProfit ✅ required (price level, no commas)
- confidence ✅ required (0-100)
- reasoning ✅ required (string)

**hold / wait / close_long / close_short:**
- symbol ✅ required
- action ✅ required
- confidence ✅ required (0-100)
- reasoning ✅ required (string)

### 5. Calculations (from Strategy Parameters)

The request includes strategy parameters. Use them!

**Stop Loss Calculation:**
```
stopLoss = entryPrice ± (ATR × strategy.riskMultiplier)

For long:  stopLoss = entryPrice - (ATR × riskMultiplier)
For short: stopLoss = entryPrice + (ATR × riskMultiplier)
```

**Take Profit Calculation:**
```
stopDistance = |entryPrice - stopLoss|
takeProfit = entryPrice + (stopDistance × strategy.riskRewardRatio)

For long:  takeProfit = entryPrice + (stopDistance × riskRewardRatio)
For short: takeProfit = entryPrice - (stopDistance × riskRewardRatio)
```

**Position Size (CRITICAL - MUST USE EXACT FORMULA):**
```
positionSizeUsd = (confidence / 100) × strategy.maxPositionSize
```

**⚠️ DO NOT use arbitrary percentages like "90% for high confidence"!**  
**⚠️ MUST use the ACTUAL confidence value in the formula!**

**Examples:**
- If confidence = 82 and maxPositionSize = 5000:  
  `positionSizeUsd = (82/100) × 5000 = 4100` ✅

- If confidence = 75 and maxPositionSize = 5000:  
  `positionSizeUsd = (75/100) × 5000 = 3750` ✅

- If confidence = 95 and maxPositionSize = 5000:  
  `positionSizeUsd = (95/100) × 5000 = 4750` ✅

**Leverage:**
```
leverage = strategy.btcEthMaxLeverage  (for BTC/ETH)
leverage = strategy.altcoinMaxLeverage  (for others)
```

### 6. Example Request Data

```json
{
  "marketData": {
    "BTCUSDT": {
      "price": 68169,
      "atr": 1200,
      ...
    }
  },
  "strategy": {
    "minRiskRewardRatio": 3.0,
    "minConfidence": 75,
    "btcEthMaxLeverage": 5,
    "altcoinMaxLeverage": 3,
    "maxPositionSize": 5000,
    "riskMultiplier": 2.0
  }
}
```

### 7. Example Response

<reasoning>
Account Analysis:
- Equity: $10000
- Available: $9500
- No open positions

Market Analysis - BTCUSDT:
- Price: $68169 (above EMA20 $68000, EMA50 $67500)
- RSI: 62 (healthy momentum)
- ATR: $1200 (volatility measure)
- OI Delta: +6.5% (strong capital inflow)

Risk Calculation:
- Entry: $68169
- Stop Loss: $68169 - ($1200 × 2.0) = $65769
- Stop Distance: $2400 (3.5% risk)
- Take Profit: $68169 + ($2400 × 3.0) = $75369
- Risk/Reward: 3.0:1 ✓

Position Sizing (EXACT CALCULATION):
- Max position: $5000 (strategy.maxPositionSize)
- Confidence: 82% (my confidence score)
- Position size: (82 / 100) × $5000 = **$4100** ← USE THIS EXACT FORMULA
- Leverage: 5x (BTC from strategy.btcEthMaxLeverage)

⚠️ CRITICAL: Position size MUST equal (confidence/100) × maxPositionSize
Do NOT use "90% for high confidence" or any other arbitrary percentage!
</reasoning>

<decision>
[
  {
    "symbol": "BTCUSDT",
    "action": "open_long",
    "leverage": 5,
    "positionSizeUsd": 4100,
    "stopLoss": 65769,
    "takeProfit": 75369,
    "confidence": 82,
    "reasoning": "Multi-timeframe bullish, OI surge +6.5%, RSI 62, excellent 3:1 R/R"
  }
]
</decision>

---

## Checklist Before Responding

- [ ] Reasoning uses numbers WITHOUT commas
- [ ] Decision JSON is valid (no trailing commas, proper quotes)
- [ ] All open_long/open_short have: leverage, positionSizeUsd, stopLoss, takeProfit
- [ ] All actions have: symbol, action, confidence, reasoning
- [ ] Numbers are calculated from strategy parameters (not guessed)
- [ ] Confidence reflects actual signal strength
- [ ] Risk/reward ratio ≥ minRiskRewardRatio from strategy

**If you cannot calculate proper values because data is missing, use action="wait" with reasoning explaining what's missing!**
