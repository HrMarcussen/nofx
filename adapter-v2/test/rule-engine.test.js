#!/usr/bin/env node
/**
 * Rule Engine Tests
 * 
 * Test scenarios from TRADING_ARCHITECTURE_V2.md:
 * - RSI=32, MACD bullish cross, EMA aligned, volume 1.5x → LONG Tier 1
 * - RSI=38, MACD positive histogram, 2 TF aligned → LONG Tier 2  
 * - RSI=45, no MACD cross, mixed signals → WAIT
 */

const { evaluateSignal, evaluateLongTier1, evaluateLongTier2 } = require('../src/rule-engine');

let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✅ ${message}`);
    passedTests++;
  } else {
    console.error(`❌ ${message}`);
    failedTests++;
  }
}

function assertEqual(actual, expected, message) {
  assert(actual === expected, `${message} (expected: ${expected}, got: ${actual})`);
}

console.log('='.repeat(70));
console.log('Rule Engine Tests');
console.log('='.repeat(70));

// Test 1: LONG Tier 1 - Strong bullish signal
console.log('\n📊 Test Case 1: RSI=32, MACD bullish cross, EMA aligned, volume 1.5x → LONG Tier 1');

const tier1Signal = {
  symbol: 'BTCUSDT',
  price: 68169,
  atr: 1200,
  trend: {
    ema_cross: 'bullish',
    ema200_pos: 'above',
    macd_cross: 'bullish',
    macd_histogram: 120
  },
  momentum: {
    rsi: 32,
    rsi_zone: 'oversold',
    volume_ratio: 1.5,
    macd_3m: 50,
    macd_4h: 120
  },
  multi_tf_alignment: 3
};

const decision1 = evaluateSignal(tier1Signal);
assertEqual(decision1.action, 'open_long', 'Should recommend LONG');
assertEqual(decision1.tier, 'tier1', 'Should be Tier 1');
assert(decision1.confidence >= 75, `Confidence should be ≥75% (got ${decision1.confidence})`);
console.log(`  → Decision: ${decision1.action} (${decision1.tier}, ${decision1.confidence}%)`);

// Test 2: LONG Tier 2 - Medium confidence
console.log('\n📊 Test Case 2: RSI=38, MACD positive histogram, 2 TF aligned → LONG Tier 2');

const tier2Signal = {
  symbol: 'ETHUSDT',
  price: 3500,
  atr: 80,
  trend: {
    ema_cross: 'bullish',
    ema200_pos: 'above',
    macd_cross: 'none',
    macd_histogram: 45
  },
  momentum: {
    rsi: 38,
    rsi_zone: 'neutral',
    volume_ratio: 1.1,
    macd_3m: 15,
    macd_4h: 45
  },
  multi_tf_alignment: 2
};

const decision2 = evaluateSignal(tier2Signal);
assertEqual(decision2.action, 'open_long', 'Should recommend LONG');
assertEqual(decision2.tier, 'tier2', 'Should be Tier 2');
assert(decision2.confidence >= 72 && decision2.confidence <= 74, `Confidence should be 72-74% (got ${decision2.confidence})`);
console.log(`  → Decision: ${decision2.action} (${decision2.tier}, ${decision2.confidence}%)`);

// Test 3: WAIT - Mixed signals
console.log('\n📊 Test Case 3: RSI=45, no MACD cross, mixed signals → WAIT');

const waitSignal = {
  symbol: 'SOLUSDT',
  price: 120,
  atr: 5,
  trend: {
    ema_cross: 'neutral',
    ema200_pos: 'above',
    macd_cross: 'none',
    macd_histogram: 5
  },
  momentum: {
    rsi: 45,
    rsi_zone: 'neutral',
    volume_ratio: 0.9,
    macd_3m: -2,
    macd_4h: 5
  },
  multi_tf_alignment: 1
};

const decision3 = evaluateSignal(waitSignal);
assertEqual(decision3.action, 'wait', 'Should recommend WAIT');
assertEqual(decision3.tier, null, 'Tier should be null for WAIT');
console.log(`  → Decision: ${decision3.action} (confidence: ${decision3.confidence}%)`);

// Test 4: SHORT Tier 1 - Strong bearish signal
console.log('\n📊 Test Case 4: RSI=70, MACD bearish cross, EMA bearish → SHORT Tier 1');

const shortSignal = {
  symbol: 'BTCUSDT',
  price: 68000,
  atr: 1200,
  trend: {
    ema_cross: 'bearish',
    ema200_pos: 'below',
    macd_cross: 'bearish',
    macd_histogram: -150
  },
  momentum: {
    rsi: 70,
    rsi_zone: 'overbought',
    volume_ratio: 1.6,
    macd_3m: -50,
    macd_4h: -150
  },
  multi_tf_alignment: 3
};

const decision4 = evaluateSignal(shortSignal);
assertEqual(decision4.action, 'open_short', 'Should recommend SHORT');
assertEqual(decision4.tier, 'tier1', 'Should be Tier 1');
assert(decision4.confidence >= 75, `Confidence should be ≥75% (got ${decision4.confidence})`);
console.log(`  → Decision: ${decision4.action} (${decision4.tier}, ${decision4.confidence}%)`);

// Test 5: Auto-exit LONG (RSI overbought + MACD bearish cross)
console.log('\n📊 Test Case 5: Auto-exit LONG (RSI > 75 + MACD bearish cross)');

const exitSignal = {
  symbol: 'BTCUSDT',
  price: 72000,
  atr: 1300,
  trend: {
    ema_cross: 'bullish',
    ema200_pos: 'above',
    macd_cross: 'bearish',
    macd_histogram: -50
  },
  momentum: {
    rsi: 78,
    rsi_zone: 'overbought',
    volume_ratio: 1.2,
    macd_3m: -20,
    macd_4h: -50
  },
  multi_tf_alignment: 2
};

const existingLong = { symbol: 'BTCUSDT', direction: 'long' };
const decision5 = evaluateSignal(exitSignal, existingLong);
assertEqual(decision5.action, 'close_long', 'Should recommend closing LONG');
assert(decision5.confidence >= 80, `Exit confidence should be high (got ${decision5.confidence})`);
console.log(`  → Decision: ${decision5.action} (confidence: ${decision5.confidence}%)`);

// Test 6: Tier 1 edge case - 3 of 5 conditions (should not match)
console.log('\n📊 Test Case 6: LONG Tier 1 edge case - only 3 of 5 conditions met (should WAIT)');

const edgeSignal = {
  symbol: 'BTCUSDT',
  price: 68000,
  atr: 1200,
  trend: {
    ema_cross: 'bullish',
    ema200_pos: 'above',
    macd_cross: 'none',  // Missing bullish cross
    macd_histogram: 50
  },
  momentum: {
    rsi: 36,  // Just above oversold threshold
    rsi_zone: 'neutral',
    volume_ratio: 0.8,  // Below threshold
    macd_3m: 20,
    macd_4h: 50
  },
  multi_tf_alignment: 3
};

const decision6 = evaluateSignal(edgeSignal);
assert(decision6.action !== 'open_long' || decision6.tier !== 'tier1', 
  'Should NOT trigger Tier 1 with only 3 conditions met');
console.log(`  → Decision: ${decision6.action} (tier: ${decision6.tier})`);

// Summary
console.log('\n' + '='.repeat(70));
console.log(`✅ Passed: ${passedTests}`);
console.log(`❌ Failed: ${failedTests}`);
console.log('='.repeat(70));

process.exit(failedTests > 0 ? 1 : 0);
