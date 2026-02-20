#!/usr/bin/env node
/**
 * Signal Condenser Tests
 */

const { condenseSymbol, parseNumeric, getRsiZone, getEmaTrend, calculateCompositeScore } = require('../src/signal-condenser');

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
console.log('Signal Condenser Tests');
console.log('='.repeat(70));

// Test 1: parseNumeric
console.log('\n📊 Test parseNumeric()');
assertEqual(parseNumeric(42), 42, 'Should parse number');
assertEqual(parseNumeric('42'), 42, 'Should parse string number');
assertEqual(parseNumeric('42.5'), 42.5, 'Should parse decimal string');
assertEqual(parseNumeric('1,234.56'), 1234.56, 'Should strip thousand separators');
assertEqual(parseNumeric(null), null, 'Should return null for null');
assertEqual(parseNumeric(undefined), null, 'Should return null for undefined');

// Test 2: getRsiZone
console.log('\n📊 Test getRsiZone()');
assertEqual(getRsiZone(30, 35, 65), 'oversold', 'RSI 30 should be oversold');
assertEqual(getRsiZone(70, 35, 65), 'overbought', 'RSI 70 should be overbought');
assertEqual(getRsiZone(50, 35, 65), 'neutral', 'RSI 50 should be neutral');
assertEqual(getRsiZone(null), 'unknown', 'Null RSI should be unknown');

// Test 3: getEmaTrend
console.log('\n📊 Test getEmaTrend()');
const bullishTrend = getEmaTrend(50000, 48000, 47000, 46000);
assertEqual(bullishTrend.ema_cross, 'bullish', 'EMA20 > EMA50 should be bullish');
assertEqual(bullishTrend.ema200_pos, 'above', 'Price > EMA200 should be above');
assert(bullishTrend.ema_aligned, 'EMA20 > EMA50 > EMA200 should be aligned');

const bearishTrend = getEmaTrend(45000, 46000, 47000, 48000);
assertEqual(bearishTrend.ema_cross, 'bearish', 'EMA20 < EMA50 should be bearish');
assertEqual(bearishTrend.ema200_pos, 'below', 'Price < EMA200 should be below');
assert(bearishTrend.ema_aligned, 'EMA20 < EMA50 < EMA200 should be aligned');

// Test 4: condenseSymbol with realistic data
console.log('\n📊 Test condenseSymbol() with realistic market data');

const mockSymbolData = {
  symbol: 'BTCUSDT',
  currentPrice: 68169,
  atr: 1200,
  rsi: 32,
  macd_3m: 50,
  macd_4h: 120,
  ema20: 67500,
  ema50: 66800,
  ema200: 65000,
  volume: 15000000,
  avgVolume: 10000000,
  openInterest: 5000000000,
  oiChange24h: 6.5,
  fundingRate: 0.01,
  bb_upper: 69000,
  bb_lower: 67000
};

const signal = condenseSymbol(mockSymbolData, { rsi_oversold: 35, rsi_overbought: 65 });

assertEqual(signal.symbol, 'BTCUSDT', 'Should preserve symbol');
assertEqual(signal.price, 68169, 'Should extract price');
assertEqual(signal.atr, 1200, 'Should extract ATR');
assertEqual(signal.momentum.rsi, 32, 'Should extract RSI');
assertEqual(signal.momentum.rsi_zone, 'oversold', 'RSI 32 should be oversold');
assertEqual(signal.trend.ema_cross, 'bullish', 'Should detect bullish EMA cross');
assert(signal.momentum.volume_ratio > 1, 'Volume should be above average');
assert(signal.composite_score > 50, 'Bullish signals should score > 50');

// Test 5: calculateCompositeScore
console.log('\n📊 Test calculateCompositeScore()');

const bullishSignals = {
  ema_cross: 'bullish',
  rsi_zone: 'oversold',
  macd_histogram: 120,
  volume_ratio: 1.5
};

const score = calculateCompositeScore(bullishSignals, 3);
assert(score > 70, `Bullish aligned signals should score > 70 (got ${score})`);

const bearishSignals = {
  ema_cross: 'bearish',
  rsi_zone: 'overbought',
  macd_histogram: -120,
  volume_ratio: 1.5
};

const bearishScore = calculateCompositeScore(bearishSignals, 3);
assert(bearishScore < 40, `Bearish aligned signals should score < 40 (got ${bearishScore})`);

// Summary
console.log('\n' + '='.repeat(70));
console.log(`✅ Passed: ${passedTests}`);
console.log(`❌ Failed: ${failedTests}`);
console.log('='.repeat(70));

process.exit(failedTests > 0 ? 1 : 0);
