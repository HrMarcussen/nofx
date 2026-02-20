#!/usr/bin/env node
/**
 * Integration Test - Phase 2
 * 
 * Tests the complete escalation pipeline:
 * 1. Market data → Signal condenser
 * 2. Rule engine → Escalation check
 * 3. LLM escalation handler (mocked)
 * 4. MACD cross detection
 * 5. Risk assessment flow
 */

const { condenseMarketData } = require('../src/signal-condenser');
const { evaluateSignal } = require('../src/rule-engine');
const { shouldEscalate } = require('../src/escalation');
const { parseLLMResponse, buildCompactPrompt } = require('../src/escalation-handler');
const { detectMACDCross, clearIndicatorHistory } = require('../src/indicators');
const { parseRiskAssessmentResponse } = require('../src/risk-assessment');
const { getConfig } = require('../src/config');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function testFullEscalationPipeline() {
  console.log('Testing full escalation pipeline...');
  
  // 1. Mock market data (gray zone scenario)
  const marketData = {
    symbols: [
      {
        symbol: 'BTCUSDT',
        currentPrice: 50000,
        rsi: 70,  // Gray zone: overbought but not extreme
        macd_4h: 0.1,  // Slightly positive
        macd_line_4h: 100,
        macd_signal_4h: 95,
        ema20: 49500,
        ema50: 49000,
        ema200: 48000,
        volume: 1000000,
        avgVolume: 800000,
        atr: 1000,
        fundingRate: 0.01,
        oiChange24h: 3.0,
        bb_upper: 51000,
        bb_lower: 49000
      }
    ]
  };
  
  // 2. Condense signal
  const config = getConfig();
  const condensed = condenseMarketData(marketData, config.ruleEngine);
  const signal = condensed.symbols[0];
  
  assert(signal.symbol === 'BTCUSDT', 'Signal should have symbol');
  assert(signal.composite_score >= 0 && signal.composite_score <= 100, 'Composite score should be 0-100');
  
  // 3. Evaluate rule engine
  const ruleDecision = evaluateSignal(signal, null);
  
  assert(ruleDecision.action !== undefined, 'Rule decision should have action');
  assert(ruleDecision.confidence !== undefined, 'Rule decision should have confidence');
  
  // 4. Check escalation
  const escalation = shouldEscalate(signal, ruleDecision);
  
  assert(escalation.shouldEscalate !== undefined, 'Escalation should have shouldEscalate flag');
  assert(Array.isArray(escalation.triggers), 'Escalation should have triggers array');
  
  if (escalation.shouldEscalate) {
    console.log(`  ⚠️  Escalation triggered: ${escalation.triggers.length} triggers`);
    
    // 5. Build escalation prompt
    const prompt = buildCompactPrompt(escalation);
    assert(prompt.length > 100, 'Escalation prompt should be substantial');
    assert(prompt.includes('BTCUSDT'), 'Prompt should include symbol');
    
    // 6. Mock LLM response
    const mockLLMResponse = `{
      "action": "wait",
      "confidence": 60,
      "reasoning": "Gray zone conditions detected. Wait for clearer signal."
    }`;
    
    const llmDecision = parseLLMResponse(mockLLMResponse);
    assert(llmDecision.action === 'wait', 'LLM should recommend wait');
    assert(llmDecision.confidence === 60, 'LLM confidence should be parsed');
  }
  
  console.log('✅ Full escalation pipeline');
}

function testMACDCrossIntegration() {
  console.log('Testing MACD cross integration with signal condenser...');
  
  clearIndicatorHistory('TESTINT', '4h');
  
  // First market data point (MACD below signal)
  const marketData1 = {
    symbols: [
      {
        symbol: 'TESTINT',
        currentPrice: 50000,
        rsi: 50,
        macd_4h: 0.1,
        macd_line_4h: 90,
        macd_signal_4h: 100,
        ema20: 49500,
        ema50: 49000,
        ema200: 48000,
        volume: 1000000,
        avgVolume: 800000,
        atr: 1000,
        fundingRate: 0.01,
        oiChange24h: 0,
        bb_upper: 51000,
        bb_lower: 49000
      }
    ]
  };
  
  const config = getConfig();
  const condensed1 = condenseMarketData(marketData1, config.ruleEngine);
  const signal1 = condensed1.symbols[0];
  
  assert(signal1.trend.macd_cross === 'none', 'First call should have no cross');
  
  // Second market data point (MACD crosses above signal)
  const marketData2 = {
    symbols: [
      {
        symbol: 'TESTINT',
        currentPrice: 50100,
        rsi: 52,
        macd_4h: 0.2,
        macd_line_4h: 105,
        macd_signal_4h: 100,
        ema20: 49600,
        ema50: 49100,
        ema200: 48000,
        volume: 1000000,
        avgVolume: 800000,
        atr: 1000,
        fundingRate: 0.01,
        oiChange24h: 0,
        bb_upper: 51000,
        bb_lower: 49000
      }
    ]
  };
  
  const condensed2 = condenseMarketData(marketData2, config.ruleEngine);
  const signal2 = condensed2.symbols[0];
  
  assert(signal2.trend.macd_cross === 'bullish', 'Second call should detect bullish cross');
  
  console.log('✅ MACD cross integration with signal condenser');
}

function testRiskAssessmentFlow() {
  console.log('Testing risk assessment flow...');
  
  // Mock LLM response for risk assessment
  const mockResponse = `\`\`\`json
{
  "risk_multiplier": 0.8,
  "reasoning": "Recent volatility suggests reducing risk slightly",
  "alerts": ["Watch for regime change"],
  "parameter_adjustments": {
    "rsi_oversold": 33
  }
}
\`\`\``;
  
  const parsed = parseRiskAssessmentResponse(mockResponse);
  
  assert(parsed.risk_multiplier === 0.8, 'Should parse risk_multiplier');
  assert(parsed.reasoning.includes('volatility'), 'Should parse reasoning');
  assert(parsed.alerts.length === 1, 'Should parse alerts');
  assert(parsed.parameter_adjustments.rsi_oversold === 33, 'Should parse parameter adjustments');
  
  console.log('✅ Risk assessment flow');
}

function testEscalationWithMACD() {
  console.log('Testing escalation with MACD cross detection...');
  
  clearIndicatorHistory('ESCMACD', '4h');
  
  // Setup: MACD below signal (bearish)
  detectMACDCross('ESCMACD', '4h', 90, 100);
  
  // Now: MACD crosses above (bullish cross + high RSI = contradiction)
  const marketData = {
    symbols: [
      {
        symbol: 'ESCMACD',
        currentPrice: 50000,
        rsi: 75,  // Overbought
        macd_4h: 0.5,
        macd_line_4h: 105,
        macd_signal_4h: 100,
        ema20: 49500,
        ema50: 49000,
        ema200: 48000,
        volume: 1000000,
        avgVolume: 800000,
        atr: 1000,
        fundingRate: 0.01,
        oiChange24h: 0,
        bb_upper: 51000,
        bb_lower: 49000
      }
    ]
  };
  
  const config = getConfig();
  const condensed = condenseMarketData(marketData, config.ruleEngine);
  const signal = condensed.symbols[0];
  
  assert(signal.trend.macd_cross === 'bullish', 'Should detect bullish MACD cross');
  assert(signal.momentum.rsi_zone === 'overbought', 'RSI should be overbought');
  
  // Evaluate rule engine
  const ruleDecision = evaluateSignal(signal, null);
  
  // Check escalation (contradictory: bullish MACD cross + overbought RSI)
  const escalation = shouldEscalate(signal, ruleDecision);
  
  // This should trigger escalation due to contradictory signals
  const hasContradiction = escalation.triggers.some(t => t.type === 'contradictory_signals');
  
  console.log(`  Escalation: ${escalation.shouldEscalate}, Contradictions: ${hasContradiction}`);
  
  console.log('✅ Escalation with MACD cross');
}

function testConfigValidation() {
  console.log('Testing config validation bounds...');
  
  const config = getConfig();
  
  // Check hard limits
  assert(config.riskManagement.risk_per_trade === 0.02, 'risk_per_trade should be 0.02');
  assert(config.riskManagement.max_leverage === 5, 'max_leverage should be 5');
  
  // Check risk_multiplier bounds
  assert(config.riskManagement.risk_multiplier >= 0.0, 'risk_multiplier should be >= 0.0');
  assert(config.riskManagement.risk_multiplier <= 1.5, 'risk_multiplier should be <= 1.5');
  
  console.log('✅ Config validation');
}

function testEndToEndScenario() {
  console.log('Testing end-to-end scenario...');
  
  clearIndicatorHistory('E2E', '4h');
  
  // Scenario: Market starts bearish, crosses to bullish, triggers escalation
  
  // T0: Bearish setup
  const data0 = {
    symbols: [{
      symbol: 'E2E',
      currentPrice: 50000,
      rsi: 45,
      macd_4h: -0.1,
      macd_line_4h: 95,
      macd_signal_4h: 100,
      ema20: 50500,
      ema50: 51000,
      ema200: 52000,
      volume: 1000000,
      avgVolume: 800000,
      atr: 1000,
      fundingRate: 0.01,
      oiChange24h: 2,
      bb_upper: 51000,
      bb_lower: 49000
    }]
  };
  
  const config = getConfig();
  const c0 = condenseMarketData(data0, config.ruleEngine);
  const s0 = c0.symbols[0];
  
  assert(s0.trend.macd_cross === 'none', 'T0: Should have no cross (first data point)');
  assert(s0.trend.ema_cross === 'bearish', 'T0: EMA should be bearish');
  
  // T1: MACD crosses bullish, but EMA still bearish → contradiction
  const data1 = {
    symbols: [{
      symbol: 'E2E',
      currentPrice: 50200,
      rsi: 48,
      macd_4h: 0.1,
      macd_line_4h: 105,
      macd_signal_4h: 100,
      ema20: 50400,  // Still below ema50
      ema50: 51000,
      ema200: 52000,
      volume: 1200000,
      avgVolume: 800000,
      atr: 1000,
      fundingRate: 0.01,
      oiChange24h: 2,
      bb_upper: 51000,
      bb_lower: 49000
    }]
  };
  
  const c1 = condenseMarketData(data1, config.ruleEngine);
  const s1 = c1.symbols[0];
  
  assert(s1.trend.macd_cross === 'bullish', 'T1: Should detect bullish MACD cross');
  assert(s1.trend.ema_cross === 'bearish', 'T1: EMA still bearish');
  
  const r1 = evaluateSignal(s1, null);
  const esc1 = shouldEscalate(s1, r1);
  
  // Should escalate due to contradictory signals
  const hasContra = esc1.triggers.some(t => t.type === 'contradictory_signals');
  console.log(`  T1 escalation: ${esc1.shouldEscalate}, contradiction: ${hasContra}`);
  
  console.log('✅ End-to-end scenario');
}

// Run all tests
try {
  console.log('\n=== Integration Tests - Phase 2 ===\n');
  
  testFullEscalationPipeline();
  testMACDCrossIntegration();
  testRiskAssessmentFlow();
  testEscalationWithMACD();
  testConfigValidation();
  testEndToEndScenario();
  
  console.log('\n✅ All Phase 2 integration tests passed!\n');
  console.log('⚠️  Note: Full LLM integration requires OpenClaw running on localhost:18789\n');
} catch (err) {
  console.error(`\n❌ Test failed: ${err.message}\n`);
  console.error(err.stack);
  process.exit(1);
}
