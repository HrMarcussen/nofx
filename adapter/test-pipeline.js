#!/usr/bin/env node
/**
 * Test script for the refactored trading adapter pipeline.
 * 
 * Tests pre-processor → (simulated LLM) → post-processor without a real LLM call.
 * Also compares old vs new prompt sizes.
 */

const { preProcess, loadStrategy } = require('./pre-processor');
const { postProcess, determineTier, checkTier2Macd, calcPositionSize, calcStopDistance } = require('./post-processor');
const fs = require('fs');
const path = require('path');

// ========== Test Data ==========

const sampleRequest = {
  systemPrompt: 'You are a trading AI.',
  userPrompt: JSON.stringify({
    accountInfo: {
      equity: 1000,
      totalWalletBalance: 1000,
      unrealizedPnl: 12.50
    },
    positions: [
      {
        symbol: 'ETHUSDT',
        side: 'LONG',
        entryPrice: 2650,
        unrealizedProfit: 12.50,
        notional: 2000
      }
    ],
    symbols: [
      {
        symbol: 'BTCUSDT',
        currentPrice: 68000,
        atr: 1200,
        rsi: 62,
        macd_3m: 150.5,
        macd_4h: 85.2,
        ema_20: 67500,
        ema_50: 66800,
        volume: 2500000000,
        oi: 15000000000,
        oiChange: 6.5,
        fundingRate: 0.0001
      },
      {
        symbol: 'ETHUSDT',
        currentPrice: 2680,
        atr: 40,
        rsi: 55,
        macd_3m: 2.3,
        macd_4h: 1.8,
        ema_20: 2660,
        ema_50: 2640,
        volume: 800000000,
        oi: 5000000000,
        oiChange: -1.2,
        fundingRate: 0.00005
      },
      {
        symbol: 'SOLUSDT',
        currentPrice: 185,
        atr: 5.5,
        rsi: 71,
        macd_3m: 0.8,
        macd_4h: -0.3, // Note: 4h MACD negative — tier 2 should fail
        ema_20: 183,
        ema_50: 180,
        volume: 300000000,
        oi: 1000000000,
        oiChange: 3.2,
        fundingRate: 0.00015
      }
    ]
  }),
  metadata: {
    requestId: 'test-001',
    exchange: 'binance',
    symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']
  }
};

// ========== Tests ==========

let passed = 0;
let failed = 0;

function assert(condition, testName, detail = '') {
  if (condition) {
    console.log(`  ✅ ${testName}`);
    passed++;
  } else {
    console.log(`  ❌ ${testName}${detail ? ': ' + detail : ''}`);
    failed++;
  }
}

function section(name) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${name}`);
  console.log('='.repeat(60));
}

// ---------- Test 1: Pre-processor ----------
section('TEST 1: Pre-Processor');

const preprocessed = preProcess(sampleRequest);

assert(!preprocessed.isLegacyFormat, 'Detected structured format (not legacy)');
assert(preprocessed.strategy !== null, 'Strategy loaded');
assert(Object.keys(preprocessed.symbolIndicators).length === 3, 'Extracted 3 symbols');

const btcInd = preprocessed.symbolIndicators['BTCUSDT'];
assert(btcInd.price === 68000, 'BTC price extracted', `got ${btcInd.price}`);
assert(btcInd.atr === 1200, 'BTC ATR extracted', `got ${btcInd.atr}`);
assert(btcInd.rsi === 62, 'BTC RSI extracted', `got ${btcInd.rsi}`);
assert(btcInd.macd3m === 150.5, 'BTC MACD 3m extracted', `got ${btcInd.macd3m}`);
assert(btcInd.macd4h === 85.2, 'BTC MACD 4h extracted', `got ${btcInd.macd4h}`);
assert(btcInd.maxLeverage === 5, 'BTC leverage = 5 (btc_eth)', `got ${btcInd.maxLeverage}`);

const solInd = preprocessed.symbolIndicators['SOLUSDT'];
assert(solInd.maxLeverage === 5, 'SOL leverage = 5 (altcoin)', `got ${solInd.maxLeverage}`);

console.log('\n  Market summary preview (first 500 chars):');
console.log('  ' + preprocessed.llmPrompt.substring(0, 500).replace(/\n/g, '\n  '));

// ---------- Test 2: Tier Logic ----------
section('TEST 2: Tier Determination');

assert(determineTier(82) === 1, 'Confidence 82 → tier 1');
assert(determineTier(75) === 1, 'Confidence 75 → tier 1');
assert(determineTier(74) === 2, 'Confidence 74 → tier 2');
assert(determineTier(72) === 2, 'Confidence 72 → tier 2');
assert(determineTier(71) === 3, 'Confidence 71 → tier 3');
assert(determineTier(50) === 3, 'Confidence 50 → tier 3');

// ---------- Test 3: MACD Check ----------
section('TEST 3: Tier 2 MACD Check');

assert(checkTier2Macd({ macd3m: 2.3, macd4h: 1.8 }).passed === true, 'Both MACD positive → pass');
assert(checkTier2Macd({ macd3m: 2.3, macd4h: -0.3 }).passed === false, 'MACD 4h negative → fail');
assert(checkTier2Macd({ macd3m: -1.0, macd4h: 1.8 }).passed === false, 'MACD 3m negative → fail');
assert(checkTier2Macd({ macd3m: null, macd4h: 1.8 }).passed === false, 'MACD 3m missing → fail');

// ---------- Test 4: Position Sizing ----------
section('TEST 4: Position Sizing');

assert(calcPositionSize(82, 1, 5000) === 4100, 'Tier 1: 82% of $5000 = $4100', `got ${calcPositionSize(82, 1, 5000)}`);
assert(calcPositionSize(75, 1, 5000) === 3750, 'Tier 1: 75% of $5000 = $3750', `got ${calcPositionSize(75, 1, 5000)}`);
assert(calcPositionSize(74, 2, 5000) === 1850, 'Tier 2: 0.5×74% of $5000 = $1850', `got ${calcPositionSize(74, 2, 5000)}`);
assert(calcPositionSize(72, 2, 5000) === 1800, 'Tier 2: 0.5×72% of $5000 = $1800', `got ${calcPositionSize(72, 2, 5000)}`);

// ---------- Test 5: Stop Distance ----------
section('TEST 5: Stop Distance Calculation');

assert(calcStopDistance(1200, 1) === 2400, 'Tier 1: ATR 1200 × 2.0 = 2400', `got ${calcStopDistance(1200, 1)}`);
assert(calcStopDistance(40, 2) === 60, 'Tier 2: ATR 40 × 1.5 = 60', `got ${calcStopDistance(40, 2)}`);

// ---------- Test 6: Full Post-Processing ----------
section('TEST 6: Full Post-Processing Pipeline');

const simulatedLlmOutput = [
  {
    symbol: 'BTCUSDT',
    action: 'open_long',
    confidence: 82,
    reasoning: 'Strong bullish trend, EMA aligned, RSI 62, OI increasing +6.5%'
  },
  {
    symbol: 'ETHUSDT',
    action: 'hold',
    confidence: 78,
    reasoning: 'Existing long profitable, momentum still positive'
  },
  {
    symbol: 'SOLUSDT',
    action: 'open_long',
    confidence: 73, // Tier 2 — but MACD 4h is negative, should get rejected
    reasoning: 'Decent setup but MACD divergence on 4h'
  }
];

const finalDecisions = postProcess(simulatedLlmOutput, preprocessed.symbolIndicators, preprocessed.strategy);

console.log('\n  Final decisions:');
for (const d of finalDecisions) {
  console.log(`  ${d.symbol}: ${d.action} (conf: ${d.confidence}%)`);
  if (d.positionSizeUsd) console.log(`    Position: $${d.positionSizeUsd}, Leverage: ${d.leverage}x`);
  if (d.stopLoss) console.log(`    SL: $${d.stopLoss}, TP: $${d.takeProfit}`);
  console.log(`    Reasoning: ${d.reasoning.substring(0, 120)}...`);
}

// BTC: Tier 1 (82%), should have full calculations
const btcDec = finalDecisions.find(d => d.symbol === 'BTCUSDT');
assert(btcDec.action === 'open_long', 'BTC: action is open_long');
assert(btcDec.leverage === 5, 'BTC: leverage = 5', `got ${btcDec.leverage}`);
assert(typeof btcDec.positionSizeUsd === 'number', 'BTC: positionSizeUsd is a number');
assert(typeof btcDec.stopLoss === 'number', 'BTC: stopLoss is a number');
assert(typeof btcDec.takeProfit === 'number', 'BTC: takeProfit is a number');
// Stop should be entry - ATR*2 = 68000 - 2400 = 65600
assert(btcDec.stopLoss === 65600, 'BTC: stopLoss = 65600', `got ${btcDec.stopLoss}`);
// TP = 68000 + (2400 * 3.0) = 75200
assert(btcDec.takeProfit === 75200, 'BTC: takeProfit = 75200', `got ${btcDec.takeProfit}`);

// ETH: hold — should pass through
const ethDec = finalDecisions.find(d => d.symbol === 'ETHUSDT');
assert(ethDec.action === 'hold', 'ETH: action is hold');
assert(ethDec.positionSizeUsd === undefined, 'ETH: no positionSizeUsd for hold');

// SOL: Tier 2 with negative 4h MACD — should be converted to wait
const solDec = finalDecisions.find(d => d.symbol === 'SOLUSDT');
assert(solDec.action === 'wait', 'SOL: converted to wait (MACD 4h negative)', `got ${solDec.action}`);
assert(solDec.reasoning.includes('MACD'), 'SOL: reasoning mentions MACD failure');

// ---------- Test 7: No thousand separators ----------
section('TEST 7: Number Formatting');

const jsonStr = JSON.stringify(finalDecisions);
const hasCommaInNumbers = /\b\d{1,3}(,\d{3})+\b/.test(jsonStr);
assert(!hasCommaInNumbers, 'No thousand separators in JSON output');
assert(!jsonStr.includes('"stopLoss":"'), 'stopLoss is not a string');
assert(!jsonStr.includes('"takeProfit":"'), 'takeProfit is not a string');

// ---------- Test 8: Prompt Size Comparison ----------
section('TEST 8: Prompt Size Comparison (BEFORE vs AFTER)');

// Reconstruct old prompt size
const strategy = loadStrategy();
const config = strategy.config;
const rc = config.risk_control;
const customPrompt = config.custom_prompt || '';

// The old buildTradingPrompt template (approximation from original file)
const oldPromptTemplate = `You are Leeloo, the AI trading engine for NoFx AI Trading OS.

Your task is to analyze market data and provide trading decisions.

**Trading Strategy: ${strategy.name}**
${strategy.description}

**Risk Control Parameters (from active strategy):**
- Max Positions: ${rc.max_positions}
- BTC/ETH Max Leverage: ${rc.btc_eth_max_leverage}x
- Altcoin Max Leverage: ${rc.altcoin_max_leverage}x
- Min Risk/Reward Ratio: ${rc.min_risk_reward_ratio}:1
- Min Confidence: ${rc.min_confidence}%
- Min Position Size: $${rc.min_position_size}
- BTC/ETH Max Position Value Ratio: ${rc.btc_eth_max_position_value_ratio}x equity
- Altcoin Max Position Value Ratio: ${rc.altcoin_max_position_value_ratio}x equity

**Custom Strategy Instructions:**
${customPrompt}

**Market Context (from NoFx):**
${sampleRequest.userPrompt}

**🚨 CRITICAL FORMATTING RULES:**
1. **NO THOUSAND SEPARATORS IN NUMBERS!**
   (... hundreds of chars of examples, rules, formatting instructions ...)

**Response Format:**
<reasoning>...</reasoning>
<decision>[...]</decision>

**Valid Actions:** open_long / open_short / close_long / close_short / hold / wait

Remember: NO COMMAS IN NUMBERS!`;

// New prompt
const newPrompt = `You are a crypto trading analyst. Analyze the market data below and provide trading decisions.

${preprocessed.llmPrompt}

For each symbol in the market data, respond with a JSON array. Each entry must have:
- "symbol": the trading pair (e.g. "BTCUSDT")
- "action": one of "open_long", "open_short", "close_long", "close_short", "hold", "wait"
- "confidence": your confidence level 0-100
- "reasoning": brief explanation of your analysis

Consider: trend direction (EMA alignment), momentum (RSI, MACD across timeframes), volatility (ATR), volume, open interest changes, and funding rates.

Respond ONLY with a JSON array, no other text:
[{"symbol":"...","action":"...","confidence":...,"reasoning":"..."}]`;

const oldSize = oldPromptTemplate.length;
const newSize = newPrompt.length;
const reduction = ((oldSize - newSize) / oldSize * 100).toFixed(1);

console.log(`\n  OLD prompt: ${oldSize} chars (~${Math.round(oldSize/4)} tokens)`);
console.log(`  NEW prompt: ${newSize} chars (~${Math.round(newSize/4)} tokens)`);
console.log(`  REDUCTION:  ${reduction}% smaller`);
console.log(`  SAVED:      ${oldSize - newSize} chars (~${Math.round((oldSize - newSize)/4)} tokens per request)`);

assert(newSize < oldSize, `New prompt is smaller than old (${newSize} < ${oldSize})`);

// ---------- Test 9: Edge Cases ----------
section('TEST 9: Edge Cases');

// Below-minimum position size
const tinyDecision = postProcess(
  [{ symbol: 'BTCUSDT', action: 'open_long', confidence: 72, reasoning: 'Test tiny position' }],
  { 'BTCUSDT': { price: 68000, atr: 1200, macd3m: 1, macd4h: 1, maxPositionSize: 20, maxLeverage: 5 } },
  strategy
);
assert(tinyDecision[0].action === 'wait', 'Tiny position ($7.20) converted to wait', `got ${tinyDecision[0].action}: ${tinyDecision[0].reasoning}`);

// Tier 3 rejected
const lowConfDecision = postProcess(
  [{ symbol: 'BTCUSDT', action: 'open_long', confidence: 65, reasoning: 'Test low confidence' }],
  { 'BTCUSDT': { price: 68000, atr: 1200, macd3m: 1, macd4h: 1, maxPositionSize: 5000, maxLeverage: 5 } },
  strategy
);
assert(lowConfDecision[0].action === 'wait', 'Confidence 65% → wait', `got ${lowConfDecision[0].action}`);

// Max positions exceeded (4 open actions, max is 3)
const manyDecisions = postProcess(
  [
    { symbol: 'BTCUSDT', action: 'open_long', confidence: 85, reasoning: 'Test 1' },
    { symbol: 'ETHUSDT', action: 'open_long', confidence: 80, reasoning: 'Test 2' },
    { symbol: 'SOLUSDT', action: 'open_long', confidence: 78, reasoning: 'Test 3' },
    { symbol: 'DOGEUSDT', action: 'open_long', confidence: 76, reasoning: 'Test 4 - should be rejected' }
  ],
  {
    'BTCUSDT': { price: 68000, atr: 1200, macd3m: 1, macd4h: 1, maxPositionSize: 5000, maxLeverage: 5 },
    'ETHUSDT': { price: 2680, atr: 40, macd3m: 1, macd4h: 1, maxPositionSize: 5000, maxLeverage: 5 },
    'SOLUSDT': { price: 185, atr: 5, macd3m: 1, macd4h: 1, maxPositionSize: 1000, maxLeverage: 5 },
    'DOGEUSDT': { price: 0.15, atr: 0.005, macd3m: 1, macd4h: 1, maxPositionSize: 1000, maxLeverage: 5 }
  },
  strategy
);
const openCount = manyDecisions.filter(d => d.action.startsWith('open_')).length;
assert(openCount <= 3, `Max positions enforced: ${openCount} open actions`, `got ${openCount}`);

// ========== Summary ==========
section('SUMMARY');
console.log(`\n  Total: ${passed + failed} tests`);
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log('');

if (failed > 0) {
  process.exit(1);
}
