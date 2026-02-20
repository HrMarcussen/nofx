#!/usr/bin/env node
/**
 * Risk Assessment Tests
 */

const {
  aggregateLast24hTrades,
  getCurrentPositions,
  buildRiskAssessmentPrompt,
  parseRiskAssessmentResponse
} = require('../src/risk-assessment');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function testAggregateTradesStructure() {
  console.log('Testing trade aggregation structure...');
  
  const trades = aggregateLast24hTrades();
  
  assert(trades.last24h !== undefined, 'Should have last24h property');
  assert(typeof trades.last24h.totalTrades === 'number', 'Should have totalTrades count');
  assert(typeof trades.last24h.longTrades === 'number', 'Should have longTrades count');
  assert(typeof trades.last24h.shortTrades === 'number', 'Should have shortTrades count');
  assert(Array.isArray(trades.last24h.trades), 'Should have trades array');
  assert(typeof trades.summary === 'string', 'Should have summary string');
  
  console.log('✅ Trade aggregation structure');
}

function testGetCurrentPositionsStructure() {
  console.log('Testing current positions structure...');
  
  const positions = getCurrentPositions();
  
  assert(typeof positions.openPositions === 'number', 'Should have openPositions count');
  assert(typeof positions.longPositions === 'number', 'Should have longPositions count');
  assert(typeof positions.shortPositions === 'number', 'Should have shortPositions count');
  assert(Array.isArray(positions.positions), 'Should have positions array');
  
  console.log('✅ Current positions structure');
}

function testBuildRiskAssessmentPrompt() {
  console.log('Testing risk assessment prompt building...');
  
  const trades = {
    last24h: {
      totalTrades: 5,
      longTrades: 3,
      shortTrades: 2,
      closedTrades: 1,
      trades: [
        { type: 'OPEN_LONG', symbol: 'BTCUSDT', confidence: 75 },
        { type: 'OPEN_SHORT', symbol: 'ETHUSDT', confidence: 72 }
      ]
    },
    summary: '5 trades (3 long, 2 short, 1 closed)'
  };
  
  const positions = {
    openPositions: 4,
    longPositions: 2,
    shortPositions: 2,
    positions: []
  };
  
  const market = {
    currentRiskMultiplier: 1.0,
    configLastUpdated: '2024-01-01T08:00:00Z',
    configUpdatedBy: 'system',
    notes: 'Test'
  };
  
  const prompt = buildRiskAssessmentPrompt(trades, positions, market);
  
  assert(prompt.includes('Risk Assessment'), 'Should include title');
  assert(prompt.includes('Total trades: 5'), 'Should include trade count');
  assert(prompt.includes('Long trades: 3'), 'Should include long count');
  assert(prompt.includes('Open positions: 4'), 'Should include open positions');
  assert(prompt.includes('risk_multiplier'), 'Should include risk_multiplier field');
  assert(prompt.includes('0.0-1.5'), 'Should specify risk_multiplier range');
  assert(prompt.includes('json'), 'Should request JSON response');
  
  console.log('✅ Risk assessment prompt building');
}

function testParseRiskAssessmentResponseValid() {
  console.log('Testing risk assessment response parsing - valid...');
  
  const response = `\`\`\`json
{
  "risk_multiplier": 1.2,
  "reasoning": "Market conditions are favorable. Increasing risk slightly.",
  "alerts": ["Watch BTC funding rate"],
  "parameter_adjustments": {
    "rsi_oversold": 32,
    "min_tf_alignment": 3
  }
}
\`\`\``;
  
  const parsed = parseRiskAssessmentResponse(response);
  
  assert(parsed.risk_multiplier === 1.2, 'Should parse risk_multiplier');
  assert(parsed.reasoning.includes('favorable'), 'Should parse reasoning');
  assert(Array.isArray(parsed.alerts), 'Should have alerts array');
  assert(parsed.alerts.length === 1, 'Should have 1 alert');
  assert(parsed.parameter_adjustments.rsi_oversold === 32, 'Should parse parameter adjustments');
  
  console.log('✅ Valid risk assessment response parsing');
}

function testParseRiskAssessmentResponseBounds() {
  console.log('Testing risk assessment response - bounds clamping...');
  
  // Test upper bound
  const response1 = `{
    "risk_multiplier": 2.5,
    "reasoning": "Test"
  }`;
  
  const parsed1 = parseRiskAssessmentResponse(response1);
  assert(parsed1.risk_multiplier === 1.5, 'Should clamp to max 1.5');
  
  // Test lower bound
  const response2 = `{
    "risk_multiplier": -0.5,
    "reasoning": "Test"
  }`;
  
  const parsed2 = parseRiskAssessmentResponse(response2);
  assert(parsed2.risk_multiplier === 0.0, 'Should clamp to min 0.0');
  
  // Test within bounds
  const response3 = `{
    "risk_multiplier": 0.8,
    "reasoning": "Test"
  }`;
  
  const parsed3 = parseRiskAssessmentResponse(response3);
  assert(parsed3.risk_multiplier === 0.8, 'Should accept valid value');
  
  console.log('✅ Risk multiplier bounds clamping');
}

function testParseRiskAssessmentResponseMissingField() {
  console.log('Testing risk assessment response - missing risk_multiplier...');
  
  const response = `{
    "reasoning": "Test",
    "alerts": []
  }`;
  
  try {
    parseRiskAssessmentResponse(response);
    assert(false, 'Should throw error for missing risk_multiplier');
  } catch (err) {
    assert(err.message.includes('risk_multiplier'), 'Error should mention missing field');
  }
  
  console.log('✅ Missing field validation');
}

function testParseRiskAssessmentResponseDefaultAlerts() {
  console.log('Testing risk assessment response - default alerts...');
  
  const response = `{
    "risk_multiplier": 1.0,
    "reasoning": "Normal conditions"
  }`;
  
  const parsed = parseRiskAssessmentResponse(response);
  
  assert(Array.isArray(parsed.alerts), 'Should have alerts array');
  assert(parsed.alerts.length === 0, 'Default alerts should be empty array');
  
  console.log('✅ Default alerts handling');
}

function testParseRiskAssessmentResponseDefaultParams() {
  console.log('Testing risk assessment response - default parameter_adjustments...');
  
  const response = `{
    "risk_multiplier": 1.0,
    "reasoning": "Test"
  }`;
  
  const parsed = parseRiskAssessmentResponse(response);
  
  assert(typeof parsed.parameter_adjustments === 'object', 'Should have parameter_adjustments object');
  assert(Object.keys(parsed.parameter_adjustments).length === 0, 'Default should be empty object');
  
  console.log('✅ Default parameter_adjustments handling');
}

function testParseRiskAssessmentResponseMarkdown() {
  console.log('Testing risk assessment response - markdown extraction...');
  
  const response = `Here's my risk assessment:

\`\`\`json
{
  "risk_multiplier": 0.5,
  "reasoning": "High volatility detected, reducing risk",
  "alerts": ["Extreme funding rates", "High OI change"]
}
\`\`\`

I recommend caution.`;
  
  const parsed = parseRiskAssessmentResponse(response);
  
  assert(parsed.risk_multiplier === 0.5, 'Should extract from markdown');
  assert(parsed.alerts.length === 2, 'Should parse alerts array');
  
  console.log('✅ Markdown extraction');
}

function testRiskMultiplierEdgeValues() {
  console.log('Testing risk multiplier edge values...');
  
  // Test 0.0 (full stop)
  const response1 = `{"risk_multiplier": 0.0, "reasoning": "Stop trading"}`;
  const parsed1 = parseRiskAssessmentResponse(response1);
  assert(parsed1.risk_multiplier === 0.0, 'Should accept 0.0 (full stop)');
  
  // Test 1.5 (max risk)
  const response2 = `{"risk_multiplier": 1.5, "reasoning": "Max risk"}`;
  const parsed2 = parseRiskAssessmentResponse(response2);
  assert(parsed2.risk_multiplier === 1.5, 'Should accept 1.5 (max)');
  
  // Test 1.0 (normal)
  const response3 = `{"risk_multiplier": 1.0, "reasoning": "Normal"}`;
  const parsed3 = parseRiskAssessmentResponse(response3);
  assert(parsed3.risk_multiplier === 1.0, 'Should accept 1.0 (normal)');
  
  console.log('✅ Risk multiplier edge values');
}

function testPromptIncludesAllRequiredData() {
  console.log('Testing prompt includes all required data...');
  
  const trades = {
    last24h: { totalTrades: 10, longTrades: 6, shortTrades: 4, closedTrades: 3, trades: [] },
    summary: '10 trades'
  };
  
  const positions = {
    openPositions: 7,
    longPositions: 4,
    shortPositions: 3,
    positions: []
  };
  
  const market = {
    currentRiskMultiplier: 1.2,
    configLastUpdated: '2024-01-01T08:00:00Z',
    configUpdatedBy: 'llm_daily_risk_assessment',
    notes: 'Test'
  };
  
  const prompt = buildRiskAssessmentPrompt(trades, positions, market);
  
  // Check all required sections
  assert(prompt.includes('Last 24h Trading Performance'), 'Should include performance section');
  assert(prompt.includes('Current Positions'), 'Should include positions section');
  assert(prompt.includes('Current Configuration'), 'Should include config section');
  assert(prompt.includes('Your Task'), 'Should include instructions');
  
  // Check specific values
  assert(prompt.includes('Total trades: 10'), 'Should include total trades');
  assert(prompt.includes('Open positions: 7'), 'Should include open positions');
  assert(prompt.includes('Risk multiplier: 1.2'), 'Should include current risk multiplier');
  
  console.log('✅ Prompt includes all required data');
}

// Run all tests
try {
  console.log('\n=== Risk Assessment Tests ===\n');
  
  testAggregateTradesStructure();
  testGetCurrentPositionsStructure();
  testBuildRiskAssessmentPrompt();
  testParseRiskAssessmentResponseValid();
  testParseRiskAssessmentResponseBounds();
  testParseRiskAssessmentResponseMissingField();
  testParseRiskAssessmentResponseDefaultAlerts();
  testParseRiskAssessmentResponseDefaultParams();
  testParseRiskAssessmentResponseMarkdown();
  testRiskMultiplierEdgeValues();
  testPromptIncludesAllRequiredData();
  
  console.log('\n✅ All risk assessment tests passed!\n');
  console.log('⚠️  Note: executeDailyRiskAssessment() requires OpenClaw for integration testing\n');
} catch (err) {
  console.error(`\n❌ Test failed: ${err.message}\n`);
  console.error(err.stack);
  process.exit(1);
}
