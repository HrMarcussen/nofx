#!/usr/bin/env node
/**
 * Integration Test
 * 
 * Tests complete pipeline:
 * Raw NoFx data → Signal Condenser → Rule Engine → Position Sizer → Executor
 */

const { condenseMarketData } = require('../src/signal-condenser');
const { evaluateSignal } = require('../src/rule-engine');
const { calculatePosition } = require('../src/position-sizer');
const { shouldEscalate } = require('../src/escalation');
const { getConfig } = require('../src/config');

console.log('='.repeat(70));
console.log('Integration Test - Complete Pipeline');
console.log('='.repeat(70));

// Mock NoFx market data (realistic structure)
const mockMarketData = {
  symbols: [
    {
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
    },
    {
      symbol: 'ETHUSDT',
      currentPrice: 3500,
      atr: 80,
      rsi: 70,
      macd_3m: -20,
      macd_4h: -50,
      ema20: 3450,
      ema50: 3550,
      ema200: 3600,
      volume: 8000000,
      avgVolume: 5000000,
      openInterest: 2000000000,
      oiChange24h: 3.2,
      fundingRate: 0.02,
      bb_upper: 3600,
      bb_lower: 3400
    }
  ]
};

const CAPITAL = 10000;

console.log('\n📊 Step 1: Load Configuration');
const config = getConfig();
console.log(`  ✅ Config loaded: risk_multiplier = ${config.riskManagement.risk_multiplier}`);

console.log('\n📊 Step 2: Condense Market Data');
const condensed = condenseMarketData(mockMarketData, config.ruleEngine);
console.log(`  ✅ Condensed ${condensed.symbols.length} symbols`);

for (const signal of condensed.symbols) {
  console.log(`\n${'─'.repeat(70)}`);
  console.log(`  Symbol: ${signal.symbol}`);
  console.log(`  Price: $${signal.price}`);
  console.log(`  RSI: ${signal.momentum.rsi} (${signal.momentum.rsi_zone})`);
  console.log(`  MACD: ${signal.trend.macd_histogram} (${signal.trend.macd_trend})`);
  console.log(`  EMA Cross: ${signal.trend.ema_cross}`);
  console.log(`  Multi-TF Alignment: ${signal.multi_tf_alignment}/4`);
  console.log(`  Composite Score: ${signal.composite_score}/100`);
  
  console.log(`\n📊 Step 3: Evaluate Rule Engine`);
  const ruleDecision = evaluateSignal(signal);
  console.log(`  ✅ Decision: ${ruleDecision.action}`);
  console.log(`  Tier: ${ruleDecision.tier || 'N/A'}`);
  console.log(`  Confidence: ${ruleDecision.confidence}%`);
  console.log(`  Reasoning: ${ruleDecision.reasoning.split('\n')[0]}...`);
  
  console.log(`\n📊 Step 4: Check Escalation`);
  const escalation = shouldEscalate(signal, ruleDecision);
  console.log(`  Should Escalate: ${escalation.shouldEscalate ? 'YES' : 'NO'}`);
  console.log(`  Trigger Count: ${escalation.triggerCount}`);
  if (escalation.shouldEscalate) {
    console.log(`  Triggers:`);
    escalation.triggers.forEach(t => {
      console.log(`    - [${t.severity}] ${t.type}`);
    });
  }
  
  if (ruleDecision.action === 'open_long' || ruleDecision.action === 'open_short') {
    console.log(`\n📊 Step 5: Calculate Position`);
    const direction = ruleDecision.action === 'open_long' ? 'long' : 'short';
    
    const position = calculatePosition({
      capital: CAPITAL,
      entryPrice: signal.price,
      atr: signal.atr,
      direction,
      tier: ruleDecision.tier,
      config
    });
    
    console.log(`  ✅ Position Size: $${position.positionSize}`);
    console.log(`  Leverage: ${position.leverage}x`);
    console.log(`  Stop Loss: $${position.stopLoss}`);
    console.log(`  Take Profit: $${position.takeProfit}`);
    console.log(`  Risk/Reward: ${position.riskReward}:1`);
    console.log(`  Fee Efficient: ${position.feeCheck.isEfficient ? 'YES' : 'NO'}`);
    console.log(`  Expected Profit: $${position.expectedProfit}`);
    console.log(`  Expected Loss: $${position.expectedLoss}`);
  } else {
    console.log(`\n📊 Step 5: Position Calculation (SKIPPED - action is ${ruleDecision.action})`);
  }
}

console.log(`\n${'='.repeat(70)}`);
console.log('✅ Integration test completed successfully');
console.log('   All pipeline steps executed without errors');
console.log('='.repeat(70));
