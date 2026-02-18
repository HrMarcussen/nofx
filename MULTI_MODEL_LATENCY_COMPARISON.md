# Multi-Model Latency Comparison — VERIFIED (Real NoFx Backtests)
Date: 2026-02-17
Backtest period: March 8-9, 2024 (BTC ~$66.9k-$67.3k, 12h window)
Config: BTCUSDT, 15m/4h timeframes, 20-bar cadence (3 decisions per backtest)

## Results

| # | Model  | Thinking | Avg Latency | Decisions | Actions                              | Avg Confidence | Equity  |
|---|--------|----------|-------------|-----------|--------------------------------------|----------------|---------|
| 1 | Opus   | low      | 20.8s       | 3         | wait 48%, wait 58%, open_long 72%    | 59%            | $1015.28|
| 2 | Sonnet | low      | 27.0s       | 3         | wait 60%, wait 68%, wait 70%         | 66%            | $1000   |
| 3 | Haiku  | low      | 26.1s       | 3         | wait 60%, wait 62%, wait 70%         | 64%            | $1000   |
| 4 | Opus   | medium   | 14.5s       | 3         | wait 48%, wait 58%, open_long 72%    | 59%            | $1015.28|
| 5 | Sonnet | medium   | 29.0s       | 3         | wait 58%, wait 62%, wait 70%         | 63%            | $1000   |
| 6 | Haiku  | medium   | 27.0s       | 3         | wait 58%, wait 62%, wait 70%         | 63%            | $1000   |
| 7 | Opus   | high     | **TIMEOUT** | 0         | All requests exceeded 120s timeout   | N/A            | N/A     |
| 8 | Sonnet | high     | 30.8s       | 3         | wait 55%, wait 60%, wait 70%         | 62%            | $1000   |
| 9 | Haiku  | high     | 28.8s       | 3         | wait 58%, wait 60%, wait 70%         | 63%            | $1000   |

## Latency Summary by Model

| Model  | Low    | Medium | High     |
|--------|--------|--------|----------|
| Opus   | 20.8s  | 14.5s  | TIMEOUT  |
| Sonnet | 27.0s  | 29.0s  | 30.8s   |
| Haiku  | 26.1s  | 27.0s  | 28.8s   |

## Key Findings

### 1. Opus Medium is the FASTEST configuration (14.5s avg)
- Opus shows the widest latency range: 14.5s (medium) to TIMEOUT (high)
- Opus medium is **2x faster** than any Sonnet/Haiku configuration
- Opus low (20.8s) is also faster than all Sonnet/Haiku variants

### 2. Opus High is UNUSABLE
- Every single request exceeded the adapter's 120s timeout
- 3 consecutive timeouts before NoFx gave up on each decision point
- The thinking overhead for Opus + high is catastrophic (>120s per decision)
- One request eventually completed on a later retry at 69.6s, but too unreliable

### 3. Sonnet and Haiku have nearly identical latency
- Both hover around 26-31s regardless of thinking level
- Thinking level has minimal impact on Sonnet/Haiku (±4s)
- This suggests the bottleneck is NOT model computation but OpenClaw routing/overhead

### 4. Only Opus actually trades
- Opus (both low and medium) was the ONLY model that reached 72% confidence to enter a position
- Both produced identical decisions: wait, wait, open_long at 72%
- All Sonnet and Haiku runs produced only "wait" decisions (never exceeding 70%)
- This resulted in Opus earning +1.53% while others stayed flat

## Decision Agreement

| Decision Point | Market State          | Opus Low/Med | Sonnet Low | Sonnet Med | Sonnet High | Haiku Low | Haiku Med | Haiku High |
|---------------|-----------------------|-------------|-----------|-----------|------------|----------|----------|-----------|
| Period 1      | BTC 66898, MACD -115  | wait 48%    | wait 60%  | wait 58%  | wait 55%   | wait 60% | wait 58% | wait 58%  |
| Period 2      | BTC 67038, MACD -18.5 | wait 58%    | wait 68%  | wait 62%  | wait 60%   | wait 62% | wait 62% | wait 60%  |
| Period 3      | BTC 67251, MACD +28.3 | open_long 72% | wait 70% | wait 70% | wait 70%  | wait 70% | wait 70% | wait 70%  |

**All models agree on waiting at periods 1-2.** At period 3 (MACD just turned positive), Opus pulls the trigger at 72% while all others stay at 70% — just 2% below the threshold. This is a meaningful behavioral difference: Opus is slightly more aggressive/decisive.

## Recommendation

**🏆 Best Overall: Opus Medium**
- Fastest latency (14.5s avg — 2x faster than alternatives)
- Only configuration that actually enters profitable trades
- Consistent decisions across thinking levels (low & medium produce identical outputs)

**⚠️ Avoid: Opus High**
- Completely broken — exceeds 120s adapter timeout
- Would need adapter timeout increase AND much longer backtest budget

**💰 Best Value: Opus Low**  
- 20.8s latency — still faster than all Sonnet/Haiku variants
- Same trading decisions as Opus Medium
- Lower thinking = lower API cost

**🚫 Not Recommended for Trading: Sonnet/Haiku (any thinking level)**
- Never reach the confidence threshold to trade
- ~27-31s latency offers no advantage over Opus
- All thinking levels produce nearly identical "wait" decisions

## Raw Evidence

### Test 1: Opus Low (20.8s avg)
```
10:16:52 took 25.614832052s → wait 48%
10:17:09 took 16.756033307s → wait 58%
10:17:30 took 20.138554543s → open_long 72%
```

### Test 2: Sonnet Low (27.0s avg)
```
10:18:47 took 27.865572885s → wait 60%
10:19:12 took 23.668248419s → wait 68%
10:19:41 took 29.45717933s → wait 70%
```

### Test 3: Haiku Low (26.1s avg)
```
10:20:30 took 25.430368621s → wait 60%
10:20:56 took 26.191581382s → wait 62%
10:21:22 took 26.590522776s → wait 70%
```

### Test 4: Opus Medium (14.5s avg) ⭐
```
10:22:22 took 16.064780772s → wait 48%
10:22:35 took 11.759872914s → wait 58%
10:22:51 took 15.773577255s → open_long 72%
```

### Test 5: Sonnet Medium (29.0s avg)
```
10:23:47 took 32.808565182s → wait 58%
10:24:12 took 25.413041964s → wait 62%
10:24:41 took 28.812915443s → wait 70%
```

### Test 6: Haiku Medium (27.0s avg)
```
10:25:26 took 26.853546476s → wait 58%
10:25:53 took 26.870903122s → wait 62%
10:26:20 took 27.287194518s → wait 70%
```

### Test 7: Opus High (TIMEOUT ❌)
```
10:26:53 → Request sent, no response
10:28:51 → Retry 1 (adapter timeout at 120s)
10:30:48 → Retry 2 (adapter timeout at 120s)
10:32:48 → Retry 3 (adapter timeout at 120s)
Adapter log: 3x "Timeout after 120000ms"
Eventually resolved at 69.6s on a later retry (too late for backtest)
```

### Test 8: Sonnet High (30.8s avg)
```
10:33:41 took 28.886557188s → wait 55%
10:34:14 took 33.116768035s → wait 60%
10:34:45 took 30.426060039s → wait 70%
```

### Test 9: Haiku High (28.8s avg)
```
10:35:28 took 27.097470778s → wait 58%
10:35:55 took 26.149120025s → wait 60%
10:36:29 took 33.195477966s → wait 70%
```
