#!/usr/bin/env node
/**
 * Indicators Tests (MACD Cross Detection)
 */

const { 
  detectMACDCross, 
  detectMACDHistogramCross,
  getMACDHistory,
  clearIndicatorHistory
} = require('../src/indicators');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function testMACDCrossNone() {
  console.log('Testing MACD cross - no cross...');
  
  clearIndicatorHistory('TEST1', '4h');
  
  // First call - no previous data
  const cross1 = detectMACDCross('TEST1', '4h', 100, 90);
  assert(cross1 === 'none', 'First call should return none (no previous data)');
  
  // Second call - still above signal, no cross
  const cross2 = detectMACDCross('TEST1', '4h', 105, 95);
  assert(cross2 === 'none', 'No cross when both trending up');
  
  console.log('✅ MACD cross - no cross detection');
}

function testMACDCrossBullish() {
  console.log('Testing MACD cross - bullish...');
  
  clearIndicatorHistory('TEST2', '4h');
  
  // First: MACD below signal
  detectMACDCross('TEST2', '4h', 90, 100);
  
  // Second: MACD crosses above signal → bullish
  const cross = detectMACDCross('TEST2', '4h', 105, 100);
  assert(cross === 'bullish', 'Should detect bullish cross');
  
  console.log('✅ MACD cross - bullish detection');
}

function testMACDCrossBearish() {
  console.log('Testing MACD cross - bearish...');
  
  clearIndicatorHistory('TEST3', '4h');
  
  // First: MACD above signal
  detectMACDCross('TEST3', '4h', 110, 100);
  
  // Second: MACD crosses below signal → bearish
  const cross = detectMACDCross('TEST3', '4h', 95, 100);
  assert(cross === 'bearish', 'Should detect bearish cross');
  
  console.log('✅ MACD cross - bearish detection');
}

function testMACDCrossEdgeCases() {
  console.log('Testing MACD cross - edge cases...');
  
  clearIndicatorHistory('TEST4', '4h');
  
  // Test with null values
  const crossNull = detectMACDCross('TEST4', '4h', null, 100);
  assert(crossNull === 'none', 'Should return none for null MACD');
  
  const crossUndefined = detectMACDCross('TEST4', '4h', 100, undefined);
  assert(crossUndefined === 'none', 'Should return none for undefined signal');
  
  console.log('✅ MACD cross - edge cases');
}

function testMACDCrossEqual() {
  console.log('Testing MACD cross - equal values...');
  
  clearIndicatorHistory('TEST5', '4h');
  
  // First: MACD equals signal
  detectMACDCross('TEST5', '4h', 100, 100);
  
  // Second: MACD moves above → bullish (from equal is considered a cross)
  const crossBullish = detectMACDCross('TEST5', '4h', 105, 100);
  assert(crossBullish === 'bullish', 'Should detect bullish from equal');
  
  clearIndicatorHistory('TEST6', '4h');
  
  // First: MACD equals signal
  detectMACDCross('TEST6', '4h', 100, 100);
  
  // Second: MACD moves below → bearish
  const crossBearish = detectMACDCross('TEST6', '4h', 95, 100);
  assert(crossBearish === 'bearish', 'Should detect bearish from equal');
  
  console.log('✅ MACD cross - equal values handling');
}

function testMACDHistogramCrossBullish() {
  console.log('Testing MACD histogram cross - bullish...');
  
  clearIndicatorHistory('HIST1:4h:histogram', 'histogram');
  
  // First: negative histogram
  detectMACDHistogramCross('HIST1', '4h', -10);
  
  // Second: crosses above zero → bullish
  const cross = detectMACDHistogramCross('HIST1', '4h', 5);
  assert(cross === 'bullish', 'Should detect bullish histogram cross');
  
  console.log('✅ MACD histogram - bullish cross');
}

function testMACDHistogramCrossBearish() {
  console.log('Testing MACD histogram cross - bearish...');
  
  clearIndicatorHistory('HIST2:4h:histogram', 'histogram');
  
  // First: positive histogram
  detectMACDHistogramCross('HIST2', '4h', 10);
  
  // Second: crosses below zero → bearish
  const cross = detectMACDHistogramCross('HIST2', '4h', -5);
  assert(cross === 'bearish', 'Should detect bearish histogram cross');
  
  console.log('✅ MACD histogram - bearish cross');
}

function testMACDHistory() {
  console.log('Testing MACD history retrieval...');
  
  clearIndicatorHistory('HIST_TEST', '4h');
  
  // Add multiple data points
  detectMACDCross('HIST_TEST', '4h', 100, 90);
  detectMACDCross('HIST_TEST', '4h', 105, 95);
  detectMACDCross('HIST_TEST', '4h', 110, 100);
  detectMACDCross('HIST_TEST', '4h', 115, 105);
  
  const history = getMACDHistory('HIST_TEST', '4h', 3);
  assert(history.length === 3, 'Should get last 3 periods');
  assert(history[0].macd === 105, 'First of last 3 should be 105');
  assert(history[2].macd === 115, 'Last should be 115');
  
  console.log('✅ MACD history retrieval');
}

function testMACDCrossSequence() {
  console.log('Testing MACD cross sequence...');
  
  clearIndicatorHistory('SEQ1', '4h');
  
  // Sequence: below → above → above → below
  const c1 = detectMACDCross('SEQ1', '4h', 90, 100);  // First point
  assert(c1 === 'none', 'First point should be none');
  
  const c2 = detectMACDCross('SEQ1', '4h', 105, 100); // Cross above → bullish
  assert(c2 === 'bullish', 'Should detect bullish cross');
  
  const c3 = detectMACDCross('SEQ1', '4h', 110, 105); // Still above → no cross
  assert(c3 === 'none', 'Should be none (still above)');
  
  const c4 = detectMACDCross('SEQ1', '4h', 95, 100);  // Cross below → bearish
  assert(c4 === 'bearish', 'Should detect bearish cross');
  
  const c5 = detectMACDCross('SEQ1', '4h', 90, 95);   // Still below → no cross
  assert(c5 === 'none', 'Should be none (still below)');
  
  console.log('✅ MACD cross sequence');
}

function testMACDCrossMultipleSymbols() {
  console.log('Testing MACD cross - multiple symbols isolation...');
  
  clearIndicatorHistory('BTC', '4h');
  clearIndicatorHistory('ETH', '4h');
  
  // BTC: below signal
  detectMACDCross('BTC', '4h', 90, 100);
  
  // ETH: above signal
  detectMACDCross('ETH', '4h', 110, 100);
  
  // BTC crosses above → bullish
  const btcCross = detectMACDCross('BTC', '4h', 105, 100);
  assert(btcCross === 'bullish', 'BTC should detect bullish');
  
  // ETH crosses below → bearish
  const ethCross = detectMACDCross('ETH', '4h', 95, 100);
  assert(ethCross === 'bearish', 'ETH should detect bearish');
  
  console.log('✅ MACD cross - symbol isolation');
}

function testInsufficientData() {
  console.log('Testing insufficient data handling...');
  
  clearIndicatorHistory('INSUF', '4h');
  
  // Empty buffer
  const cross = detectMACDCross('INSUF', '4h', 100, 90);
  assert(cross === 'none', 'Should return none with no previous data');
  
  console.log('✅ Insufficient data handling');
}

// Run all tests
try {
  console.log('\n=== Indicators Tests (MACD Cross) ===\n');
  
  testMACDCrossNone();
  testMACDCrossBullish();
  testMACDCrossBearish();
  testMACDCrossEdgeCases();
  testMACDCrossEqual();
  testMACDHistogramCrossBullish();
  testMACDHistogramCrossBearish();
  testMACDHistory();
  testMACDCrossSequence();
  testMACDCrossMultipleSymbols();
  testInsufficientData();
  
  console.log('\n✅ All indicator tests passed!\n');
} catch (err) {
  console.error(`\n❌ Test failed: ${err.message}\n`);
  console.error(err.stack);
  process.exit(1);
}
