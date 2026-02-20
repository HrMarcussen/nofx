#!/usr/bin/env node
/**
 * Data Buffer Tests
 */

const { DataBuffer } = require('../src/data-buffer');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function testDataBufferBasics() {
  console.log('Testing data buffer basics...');
  
  const buffer = new DataBuffer(5); // Max 5 items
  
  // Test push and get
  buffer.push('BTCUSDT', '4h', { macd: 100, signal: 90, timestamp: '2024-01-01T00:00:00Z' });
  buffer.push('BTCUSDT', '4h', { macd: 110, signal: 95, timestamp: '2024-01-01T04:00:00Z' });
  buffer.push('BTCUSDT', '4h', { macd: 120, signal: 100, timestamp: '2024-01-01T08:00:00Z' });
  
  const data = buffer.get('BTCUSDT', '4h');
  assert(data.length === 3, 'Should have 3 items');
  assert(data[0].macd === 100, 'First item should be 100');
  assert(data[2].macd === 120, 'Last item should be 120');
  
  console.log('✅ Data buffer basics');
}

function testDataBufferOverflow() {
  console.log('Testing data buffer overflow...');
  
  const buffer = new DataBuffer(3); // Max 3 items
  
  // Add 5 items (should keep only last 3)
  buffer.push('ETHUSDT', '4h', { value: 1 });
  buffer.push('ETHUSDT', '4h', { value: 2 });
  buffer.push('ETHUSDT', '4h', { value: 3 });
  buffer.push('ETHUSDT', '4h', { value: 4 });
  buffer.push('ETHUSDT', '4h', { value: 5 });
  
  const data = buffer.get('ETHUSDT', '4h');
  assert(data.length === 3, 'Should have max 3 items');
  assert(data[0].value === 3, 'Should have dropped oldest items');
  assert(data[2].value === 5, 'Last item should be 5');
  
  console.log('✅ Data buffer overflow handling');
}

function testDataBufferGetLast() {
  console.log('Testing getLast...');
  
  const buffer = new DataBuffer(10);
  
  buffer.push('SOLUSDT', '1h', { price: 100 });
  buffer.push('SOLUSDT', '1h', { price: 105 });
  buffer.push('SOLUSDT', '1h', { price: 110 });
  
  const last = buffer.getLast('SOLUSDT', '1h');
  assert(last !== null, 'Should have last item');
  assert(last.price === 110, 'Last item should be 110');
  
  // Test empty buffer
  const empty = buffer.getLast('XRPUSDT', '4h');
  assert(empty === null, 'Empty buffer should return null');
  
  console.log('✅ getLast functionality');
}

function testDataBufferSize() {
  console.log('Testing buffer size...');
  
  const buffer = new DataBuffer(10);
  
  assert(buffer.size('BTCUSDT', '4h') === 0, 'Empty buffer should have size 0');
  
  buffer.push('BTCUSDT', '4h', { value: 1 });
  buffer.push('BTCUSDT', '4h', { value: 2 });
  
  assert(buffer.size('BTCUSDT', '4h') === 2, 'Should have size 2');
  
  console.log('✅ Buffer size tracking');
}

function testDataBufferClear() {
  console.log('Testing buffer clear...');
  
  const buffer = new DataBuffer(10);
  
  buffer.push('BTCUSDT', '4h', { value: 1 });
  buffer.push('BTCUSDT', '4h', { value: 2 });
  buffer.push('ETHUSDT', '4h', { value: 3 });
  
  assert(buffer.size('BTCUSDT', '4h') === 2, 'BTCUSDT should have 2 items');
  assert(buffer.size('ETHUSDT', '4h') === 1, 'ETHUSDT should have 1 item');
  
  buffer.clear('BTCUSDT', '4h');
  
  assert(buffer.size('BTCUSDT', '4h') === 0, 'BTCUSDT should be cleared');
  assert(buffer.size('ETHUSDT', '4h') === 1, 'ETHUSDT should still have 1 item');
  
  buffer.clearAll();
  
  assert(buffer.size('ETHUSDT', '4h') === 0, 'All buffers should be cleared');
  
  console.log('✅ Buffer clear');
}

function testDataBufferMultipleSymbols() {
  console.log('Testing multiple symbols/timeframes...');
  
  const buffer = new DataBuffer(10);
  
  buffer.push('BTCUSDT', '4h', { value: 1 });
  buffer.push('BTCUSDT', '1h', { value: 2 });
  buffer.push('ETHUSDT', '4h', { value: 3 });
  buffer.push('ETHUSDT', '1h', { value: 4 });
  
  assert(buffer.size('BTCUSDT', '4h') === 1, 'BTCUSDT 4h should have 1');
  assert(buffer.size('BTCUSDT', '1h') === 1, 'BTCUSDT 1h should have 1');
  assert(buffer.size('ETHUSDT', '4h') === 1, 'ETHUSDT 4h should have 1');
  assert(buffer.size('ETHUSDT', '1h') === 1, 'ETHUSDT 1h should have 1');
  
  const stats = buffer.getStats();
  assert(stats.totalBuffers === 4, 'Should have 4 separate buffers');
  
  console.log('✅ Multiple symbols/timeframes isolation');
}

function testDataBufferHasEnoughData() {
  console.log('Testing hasEnoughData...');
  
  const buffer = new DataBuffer(10);
  
  assert(!buffer.hasEnoughData('BTCUSDT', '4h', 3), 'Empty buffer should not have enough data');
  
  buffer.push('BTCUSDT', '4h', { value: 1 });
  buffer.push('BTCUSDT', '4h', { value: 2 });
  
  assert(!buffer.hasEnoughData('BTCUSDT', '4h', 3), 'Should not have enough data (2 < 3)');
  assert(buffer.hasEnoughData('BTCUSDT', '4h', 2), 'Should have enough data (2 >= 2)');
  
  buffer.push('BTCUSDT', '4h', { value: 3 });
  
  assert(buffer.hasEnoughData('BTCUSDT', '4h', 3), 'Should have enough data (3 >= 3)');
  
  console.log('✅ hasEnoughData check');
}

function testDataBufferGetPeriods() {
  console.log('Testing get with periods parameter...');
  
  const buffer = new DataBuffer(10);
  
  // Add 5 items
  for (let i = 1; i <= 5; i++) {
    buffer.push('BTCUSDT', '4h', { value: i });
  }
  
  // Get last 3
  const last3 = buffer.get('BTCUSDT', '4h', 3);
  assert(last3.length === 3, 'Should get last 3 items');
  assert(last3[0].value === 3, 'First of last 3 should be 3');
  assert(last3[2].value === 5, 'Last of last 3 should be 5');
  
  // Get all
  const all = buffer.get('BTCUSDT', '4h');
  assert(all.length === 5, 'Should get all 5 items');
  
  console.log('✅ Get with periods parameter');
}

// Run all tests
try {
  console.log('\n=== Data Buffer Tests ===\n');
  
  testDataBufferBasics();
  testDataBufferOverflow();
  testDataBufferGetLast();
  testDataBufferSize();
  testDataBufferClear();
  testDataBufferMultipleSymbols();
  testDataBufferHasEnoughData();
  testDataBufferGetPeriods();
  
  console.log('\n✅ All data buffer tests passed!\n');
} catch (err) {
  console.error(`\n❌ Test failed: ${err.message}\n`);
  console.error(err.stack);
  process.exit(1);
}
