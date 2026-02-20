#!/usr/bin/env node
/**
 * Daily Risk Assessment
 * 
 * Aggregates trading performance and market conditions.
 * Sends to LLM for risk parameter adjustment.
 * 
 * Features:
 * - Aggregates last 24h trades (win/loss, P&L)
 * - Current positions summary
 * - Market conditions overview
 * - LLM decides risk_multiplier (0.0 - 1.5)
 * - Updates config via updateConfig()
 * - Exposes POST /api/v1/risk/assess endpoint
 */

const { getTradeHistory } = require('./executor');
const { getConfig, updateConfig } = require('./config');
const { callOpenClaw } = require('./escalation-handler');

/**
 * Aggregate last 24h trades
 */
function aggregateLast24hTrades() {
  const trades = getTradeHistory(1000); // Get up to 1000 recent trades
  const now = Date.now();
  const oneDayAgo = now - (24 * 60 * 60 * 1000);
  
  // Filter trades from last 24h
  const recentTrades = trades.filter(t => {
    const tradeTime = new Date(t.timestamp).getTime();
    return tradeTime >= oneDayAgo;
  });
  
  // Separate by type
  const openTrades = recentTrades.filter(t => t.type.startsWith('OPEN'));
  const closeTrades = recentTrades.filter(t => t.type.startsWith('CLOSE'));
  
  // Calculate stats (simplified - in production would track actual P&L)
  const totalTrades = openTrades.length;
  const longTrades = openTrades.filter(t => t.type === 'OPEN_LONG').length;
  const shortTrades = openTrades.filter(t => t.type === 'OPEN_SHORT').length;
  
  return {
    last24h: {
      totalTrades,
      longTrades,
      shortTrades,
      closedTrades: closeTrades.length,
      trades: recentTrades.slice(-10) // Last 10 trades for context
    },
    summary: `${totalTrades} trades (${longTrades} long, ${shortTrades} short, ${closeTrades.length} closed)`
  };
}

/**
 * Get current positions summary
 */
function getCurrentPositions() {
  // In Phase 1 (simulation), we track via trade log
  const trades = getTradeHistory(100);
  
  // Simple logic: Find OPEN trades without matching CLOSE
  const openLongs = [];
  const openShorts = [];
  
  for (const trade of trades.reverse()) {
    if (trade.type === 'OPEN_LONG') {
      // Check if there's a later CLOSE_LONG
      const closed = trades.some(t => 
        t.type === 'CLOSE_LONG' && 
        t.symbol === trade.symbol && 
        new Date(t.timestamp) > new Date(trade.timestamp)
      );
      if (!closed) openLongs.push(trade);
    }
    if (trade.type === 'OPEN_SHORT') {
      const closed = trades.some(t => 
        t.type === 'CLOSE_SHORT' && 
        t.symbol === trade.symbol && 
        new Date(t.timestamp) > new Date(trade.timestamp)
      );
      if (!closed) openShorts.push(trade);
    }
  }
  
  return {
    openPositions: openLongs.length + openShorts.length,
    longPositions: openLongs.length,
    shortPositions: openShorts.length,
    positions: [...openLongs, ...openShorts]
  };
}

/**
 * Assess market conditions
 * (Simplified - in production would integrate Lag 3 data)
 */
function assessMarketConditions() {
  const config = getConfig();
  
  return {
    currentRiskMultiplier: config.riskManagement.risk_multiplier,
    configLastUpdated: config.meta.last_updated,
    configUpdatedBy: config.meta.updated_by,
    notes: 'Market data integration pending (Lag 3)'
  };
}

/**
 * Build risk assessment prompt
 */
function buildRiskAssessmentPrompt(trades, positions, market) {
  let prompt = `# Daily Trading Risk Assessment\n\n`;
  
  prompt += `You are the risk manager for an automated crypto trading system.\n`;
  prompt += `Review the following data and set the risk_multiplier (0.0 - 1.5):\n\n`;
  
  // Trading performance
  prompt += `## Last 24h Trading Performance:\n`;
  prompt += `- Total trades: ${trades.last24h.totalTrades}\n`;
  prompt += `- Long trades: ${trades.last24h.longTrades}\n`;
  prompt += `- Short trades: ${trades.last24h.shortTrades}\n`;
  prompt += `- Closed trades: ${trades.last24h.closedTrades}\n`;
  prompt += `\n`;
  
  // Current positions
  prompt += `## Current Positions:\n`;
  prompt += `- Open positions: ${positions.openPositions}\n`;
  prompt += `- Long: ${positions.longPositions}\n`;
  prompt += `- Short: ${positions.shortPositions}\n`;
  prompt += `\n`;
  
  // Market conditions
  prompt += `## Current Configuration:\n`;
  prompt += `- Risk multiplier: ${market.currentRiskMultiplier}\n`;
  prompt += `- Last updated: ${market.configLastUpdated}\n`;
  prompt += `- Updated by: ${market.configUpdatedBy}\n`;
  prompt += `\n`;
  
  // Recent trades context
  if (trades.last24h.trades.length > 0) {
    prompt += `## Recent Trades (last ${Math.min(5, trades.last24h.trades.length)}):\n`;
    trades.last24h.trades.slice(-5).forEach(t => {
      prompt += `- ${t.type} ${t.symbol || 'N/A'} - Confidence: ${t.confidence || 'N/A'}%\n`;
    });
    prompt += `\n`;
  }
  
  // Instructions
  prompt += `## Your Task:\n`;
  prompt += `Based on the above:\n`;
  prompt += `1. Set risk_multiplier (0.0 = stop trading, 1.0 = normal, 1.5 = max risk)\n`;
  prompt += `2. Optionally adjust rule engine thresholds (RSI, TF alignment)\n`;
  prompt += `3. Provide reasoning\n\n`;
  
  prompt += `**Respond with JSON only:**\n`;
  prompt += `\`\`\`json\n`;
  prompt += `{\n`;
  prompt += `  "risk_multiplier": 0.0-1.5,\n`;
  prompt += `  "reasoning": "your analysis in 2-3 sentences",\n`;
  prompt += `  "alerts": ["optional warning messages"],\n`;
  prompt += `  "parameter_adjustments": {\n`;
  prompt += `    "rsi_oversold": 30,    // optional: 20-40\n`;
  prompt += `    "min_tf_alignment": 3  // optional: 2-4\n`;
  prompt += `  }\n`;
  prompt += `}\n`;
  prompt += `\`\`\`\n`;
  
  return prompt;
}

/**
 * Parse risk assessment response
 */
function parseRiskAssessmentResponse(responseText) {
  // Extract JSON from markdown
  const jsonMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  let jsonText = jsonMatch ? jsonMatch[1] : responseText;
  
  try {
    const parsed = JSON.parse(jsonText.trim());
    
    // Validate risk_multiplier
    if (parsed.risk_multiplier === undefined) {
      throw new Error('Missing risk_multiplier field');
    }
    
    // Clamp to bounds
    parsed.risk_multiplier = Math.max(0.0, Math.min(1.5, parsed.risk_multiplier));
    
    return {
      risk_multiplier: parsed.risk_multiplier,
      reasoning: parsed.reasoning || 'No reasoning provided',
      alerts: parsed.alerts || [],
      parameter_adjustments: parsed.parameter_adjustments || {},
      raw: parsed
    };
  } catch (err) {
    throw new Error(`Failed to parse risk assessment JSON: ${err.message}`);
  }
}

/**
 * Execute daily risk assessment
 * 
 * @returns {Promise<object>} Assessment result
 */
async function executeDailyRiskAssessment() {
  console.log('[RiskAssessment] Starting daily risk assessment...');
  
  const startTime = Date.now();
  
  // Gather data
  const trades = aggregateLast24hTrades();
  const positions = getCurrentPositions();
  const market = assessMarketConditions();
  
  // Build prompt
  const prompt = buildRiskAssessmentPrompt(trades, positions, market);
  
  let result = null;
  let error = null;
  
  try {
    // Call LLM
    const llmResponse = await callOpenClaw(prompt, 60000); // 60s timeout for risk assessment
    
    // Parse response
    const assessment = parseRiskAssessmentResponse(llmResponse);
    
    console.log(`[RiskAssessment] ✅ LLM assessment received`);
    console.log(`[RiskAssessment] New risk_multiplier: ${assessment.risk_multiplier}`);
    console.log(`[RiskAssessment] Reasoning: ${assessment.reasoning}`);
    
    if (assessment.alerts && assessment.alerts.length > 0) {
      console.warn(`[RiskAssessment] ⚠️  Alerts: ${assessment.alerts.join(', ')}`);
    }
    
    // Update config
    const configUpdates = {
      risk_multiplier: assessment.risk_multiplier,
      updated_by: 'llm_daily_risk_assessment',
      notes: `Daily risk assessment: ${assessment.reasoning}`
    };
    
    // Apply parameter adjustments if provided
    if (assessment.parameter_adjustments.rsi_oversold) {
      configUpdates.rsi_oversold = assessment.parameter_adjustments.rsi_oversold;
    }
    if (assessment.parameter_adjustments.min_tf_alignment) {
      configUpdates.min_tf_alignment = assessment.parameter_adjustments.min_tf_alignment;
    }
    
    const newConfig = updateConfig(configUpdates);
    
    console.log('[RiskAssessment] ✅ Config updated successfully');
    
    result = {
      success: true,
      assessment,
      configUpdates,
      newConfig: newConfig.riskManagement,
      processingTimeMs: Date.now() - startTime,
      timestamp: new Date().toISOString()
    };
    
  } catch (err) {
    error = err.message;
    console.error(`[RiskAssessment] ❌ Assessment failed: ${error}`);
    
    result = {
      success: false,
      error,
      processingTimeMs: Date.now() - startTime,
      timestamp: new Date().toISOString()
    };
  }
  
  return result;
}

module.exports = {
  executeDailyRiskAssessment,
  aggregateLast24hTrades,
  getCurrentPositions,
  assessMarketConditions,
  buildRiskAssessmentPrompt,
  parseRiskAssessmentResponse
};
