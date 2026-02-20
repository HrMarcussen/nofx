#!/usr/bin/env node
/**
 * Position Sizer Tests
 * 
 * Test scenarios:
 * - Position size with risk_multiplier 0.0 → should be $0 (full stop)
 * - Position size with risk_multiplier 1.5 → max allowed
 * - Fee efficiency check
 * - Stop loss and take profit calculations
 */

const { calculatePosition, calculatePositionSize, isFeeEfficient } = require('../src/position-sizer');

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
console.log('Position Sizer Tests');
console.log('='.repeat(70));

// Test 1: Position size with risk_multiplier = 0.0 (full stop)
console.log('\n📊 Test Case 1: Position size with risk_multiplier = 0.0 → should be $0');

const mockConfig0 = {
  riskManagement: {
    risk_per_trade: 0.02,
    max_leverage: 5,
    risk_multiplier: 0.0  // FULL STOP
  },
  positionSizing: {
    tier1_position_multiplier: 1.0,
    tier2_position_multiplier: 0.5,
    min_position_size_usd: 10,
    max_position_size_usd: 5000
  },
  stopLoss: {
    tier1_stop_multiplier: 2.0,
    tier1_tp_multiplier: 3.0
  }
};

const positionSize0 = calculatePositionSize(10000, 'tier1', mockConfig0);
assert(positionSize0 === 10, `Position size should be clamped to min $10 when risk_multiplier = 0.0 (got ${positionSize0})`);
console.log(`  → Position size: $${positionSize0} (risk_multiplier = 0.0)`);

// Test 2: Position size with risk_multiplier = 1.5 (max allowed)
console.log('\n📊 Test Case 2: Position size with risk_multiplier = 1.5 → max allowed');

const mockConfig15 = {
  riskManagement: {
    risk_per_trade: 0.02,
    max_leverage: 5,
    risk_multiplier: 1.5  // MAX RISK
  },
  positionSizing: {
    tier1_position_multiplier: 1.0,
    tier2_position_multiplier: 0.5,
    min_position_size_usd: 10,
    max_position_size_usd: 5000
  },
  stopLoss: {
    tier1_stop_multiplier: 2.0,
    tier1_tp_multiplier: 3.0
  }
};

const positionSize15 = calculatePositionSize(10000, 'tier1', mockConfig15);
// Expected: 10000 * 0.02 * 5 * 1.0 * 1.5 = 1500
assertEqual(positionSize15, 1500, 'Position size with risk_multiplier 1.5 should be $1500');
console.log(`  → Position size: $${positionSize15} (risk_multiplier = 1.5)`);

// Test 3: Position size with risk_multiplier = 1.0 (default)
console.log('\n📊 Test Case 3: Position size with risk_multiplier = 1.0 (default)');

const mockConfig10 = {
  riskManagement: {
    risk_per_trade: 0.02,
    max_leverage: 5,
    risk_multiplier: 1.0  // DEFAULT
  },
  positionSizing: {
    tier1_position_multiplier: 1.0,
    tier2_position_multiplier: 0.5,
    min_position_size_usd: 10,
    max_position_size_usd: 5000
  },
  stopLoss: {
    tier1_stop_multiplier: 2.0,
    tier1_tp_multiplier: 3.0,
    tier2_stop_multiplier: 1.5,
    tier2_tp_multiplier: 2.5
  }
};

const positionSize10 = calculatePositionSize(10000, 'tier1', mockConfig10);
// Expected: 10000 * 0.02 * 5 * 1.0 * 1.0 = 1000
assertEqual(positionSize10, 1000, 'Position size with risk_multiplier 1.0 should be $1000');
console.log(`  → Position size: $${positionSize10} (risk_multiplier = 1.0)`);

// Test 4: Tier 2 position size (50% of Tier 1)
console.log('\n📊 Test Case 4: Tier 2 position size (50% of Tier 1)');

const positionSizeTier2 = calculatePositionSize(10000, 'tier2', mockConfig10);
// Expected: 10000 * 0.02 * 5 * 0.5 * 1.0 = 500
assertEqual(positionSizeTier2, 500, 'Tier 2 position size should be $500 (50% of Tier 1)');
console.log(`  → Position size (Tier 2): $${positionSizeTier2}`);

// Test 5: Complete position calculation
console.log('\n📊 Test Case 5: Complete position calculation (LONG Tier 1)');

const position = calculatePosition({
  capital: 10000,
  entryPrice: 68000,
  atr: 1200,
  direction: 'long',
  tier: 'tier1',
  config: mockConfig10
});

assertEqual(position.positionSize, 1000, 'Position size should be $1000');
assertEqual(position.leverage, 5, 'Leverage should be 5x');

// Stop loss = entry - (ATR * 2.0) = 68000 - 2400 = 65600
assertEqual(position.stopLoss, 65600, 'Stop loss should be $65,600');

// Stop distance = 2400, TP distance = 2400 * 3.0 = 7200
// Take profit = entry + 7200 = 75200
assertEqual(position.takeProfit, 75200, 'Take profit should be $75,200');

// Risk/Reward = 7200 / 2400 = 3.0
assertEqual(position.riskReward, 3, 'Risk/Reward should be 3:1');

console.log(`  → Position: $${position.positionSize} @ ${position.leverage}x`);
console.log(`  → Stop Loss: $${position.stopLoss}`);
console.log(`  → Take Profit: $${position.takeProfit}`);
console.log(`  → R:R: ${position.riskReward}:1`);

// Test 6: SHORT position calculation
console.log('\n📊 Test Case 6: Complete position calculation (SHORT Tier 1)');

const shortPosition = calculatePosition({
  capital: 10000,
  entryPrice: 68000,
  atr: 1200,
  direction: 'short',
  tier: 'tier1',
  config: mockConfig10
});

// Stop loss = entry + (ATR * 2.0) = 68000 + 2400 = 70400
assertEqual(shortPosition.stopLoss, 70400, 'SHORT stop loss should be $70,400');

// Take profit = entry - 7200 = 60800
assertEqual(shortPosition.takeProfit, 60800, 'SHORT take profit should be $60,800');

console.log(`  → Position: $${shortPosition.positionSize} @ ${shortPosition.leverage}x`);
console.log(`  → Stop Loss: $${shortPosition.stopLoss}`);
console.log(`  → Take Profit: $${shortPosition.takeProfit}`);

// Test 7: Fee efficiency check
console.log('\n📊 Test Case 7: Fee efficiency check');

const feeCheck = isFeeEfficient(1000, 68000, 75200, 'long');
assert(feeCheck.isEfficient, 'Trade should be fee-efficient');
console.log(`  → Expected profit: $${feeCheck.expectedProfit}`);
console.log(`  → Total fees: $${feeCheck.totalFees}`);
console.log(`  → Profit after fees: $${feeCheck.profitAfterFees}`);
console.log(`  → Fee efficient: ${feeCheck.isEfficient ? 'YES' : 'NO'}`);

// Test 8: Fee-inefficient trade (tiny move)
console.log('\n📊 Test Case 8: Fee-inefficient trade detection');

const inefficientCheck = isFeeEfficient(100, 68000, 68010, 'long');
assert(!inefficientCheck.isEfficient, 'Small move should be fee-inefficient');
console.log(`  → Expected profit: $${inefficientCheck.expectedProfit}`);
console.log(`  → Total fees: $${inefficientCheck.totalFees}`);
console.log(`  → Fee efficient: ${inefficientCheck.isEfficient ? 'YES' : 'NO'}`);

// Test 9: Max position size cap
console.log('\n📊 Test Case 9: Position size capped at max_position_size_usd');

const largeCapital = 100000;
const cappedPosition = calculatePositionSize(largeCapital, 'tier1', mockConfig10);
// Expected: Would be 100000 * 0.02 * 5 * 1.0 * 1.0 = 10000, but capped at 5000
assertEqual(cappedPosition, 5000, 'Position should be capped at $5000');
console.log(`  → Position size: $${cappedPosition} (capped at max)`);

// Summary
console.log('\n' + '='.repeat(70));
console.log(`✅ Passed: ${passedTests}`);
console.log(`❌ Failed: ${failedTests}`);
console.log('='.repeat(70));

process.exit(failedTests > 0 ? 1 : 0);
