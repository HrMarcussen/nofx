#!/usr/bin/env node
/**
 * Escalation Logic
 * 
 * Determines when to escalate trading decisions to LLM.
 * 90% of decisions should be handled by rules, 10% escalated.
 * 
 * Escalation Triggers (from TRADING_ARCHITECTURE_V2.md):
 * - Contradictory signals (bullish trend + overbought RSI)
 * - Extreme funding rate (> 0.05%)
 * - Extreme OI change (> 15% in 24h)
 * - Extreme volume (> 3.0x average)
 * - High volatility regime (ATR > 5%)
 * - Gray zone confidence (68-72%)
 * - All timeframes misaligned
 */

const { getConfig } = require('./config');

/**
 * Check for contradictory trend vs momentum signals
 */
function hasContradictorySignals(signal) {
  const contradictions = [];
  
  // Bullish trend + overbought RSI
  if (signal.trend.ema_cross === 'bullish' && signal.momentum.rsi_zone === 'overbought') {
    contradictions.push('Bullish trend but RSI overbought');
  }
  
  // Bearish trend + oversold RSI
  if (signal.trend.ema_cross === 'bearish' && signal.momentum.rsi_zone === 'oversold') {
    contradictions.push('Bearish trend but RSI oversold');
  }
  
  // Bullish EMA but bearish MACD
  if (signal.trend.ema_cross === 'bullish' && signal.trend.macd_trend === 'bearish') {
    contradictions.push('Bullish EMA but bearish MACD');
  }
  
  // Bearish EMA but bullish MACD
  if (signal.trend.ema_cross === 'bearish' && signal.trend.macd_trend === 'bullish') {
    contradictions.push('Bearish EMA but bullish MACD');
  }
  
  // Price above EMA200 but all other indicators bearish
  if (signal.trend.ema200_pos === 'above' 
      && signal.trend.ema_cross === 'bearish' 
      && signal.trend.macd_trend === 'bearish') {
    contradictions.push('Price above EMA200 but trend bearish');
  }
  
  return {
    hasContradictions: contradictions.length > 0,
    contradictions
  };
}

/**
 * Check for extreme market conditions
 */
function hasExtremeConditions(signal, config) {
  const extremes = [];
  const { escalation } = config;
  
  // Extreme funding rate
  if (signal.derivatives.funding_rate !== null) {
    if (Math.abs(signal.derivatives.funding_rate) > escalation.extreme_funding_rate) {
      extremes.push(`Extreme funding rate: ${signal.derivatives.funding_rate}% (threshold: ${escalation.extreme_funding_rate}%)`);
    }
  }
  
  // Extreme OI change
  if (signal.derivatives.oi_change_24h !== null) {
    if (Math.abs(signal.derivatives.oi_change_24h) > escalation.extreme_oi_change_24h) {
      extremes.push(`Extreme OI change: ${signal.derivatives.oi_change_24h}% in 24h (threshold: ${escalation.extreme_oi_change_24h}%)`);
    }
  }
  
  // Extreme volume
  if (signal.momentum.volume_ratio !== null) {
    if (signal.momentum.volume_ratio > escalation.extreme_volume_ratio) {
      extremes.push(`Extreme volume: ${signal.momentum.volume_ratio}x average (threshold: ${escalation.extreme_volume_ratio}x)`);
    }
  }
  
  // High volatility regime
  if (signal.volatility.atr_pct !== null) {
    if (signal.volatility.atr_pct > escalation.extreme_atr_pct) {
      extremes.push(`High volatility: ATR ${signal.volatility.atr_pct}% (threshold: ${escalation.extreme_atr_pct}%)`);
    }
  }
  
  return {
    hasExtremes: extremes.length > 0,
    extremes
  };
}

/**
 * Check if confidence is in gray zone
 */
function isGrayZone(compositeScore, config) {
  const { escalation } = config;
  const inGrayZone = compositeScore >= escalation.confidence_gray_zone_min 
    && compositeScore <= escalation.confidence_gray_zone_max;
  
  return {
    inGrayZone,
    score: compositeScore,
    range: `${escalation.confidence_gray_zone_min}-${escalation.confidence_gray_zone_max}`
  };
}

/**
 * Check if all timeframes are misaligned
 */
function isFullyMisaligned(signal) {
  const isMisaligned = signal.multi_tf_alignment === 0;
  
  return {
    isMisaligned,
    alignment: signal.multi_tf_alignment
  };
}

/**
 * Check if risk_multiplier is at extreme (0.0 = full stop)
 */
function isRiskMultiplierExtreme(config) {
  const rm = config.riskManagement.risk_multiplier;
  const isExtreme = rm === 0.0 || rm >= 1.5;
  
  return {
    isExtreme,
    value: rm,
    note: rm === 0.0 ? 'FULL STOP - No trading allowed' : rm >= 1.5 ? 'MAX RISK' : null
  };
}

/**
 * Main escalation evaluation
 * 
 * @param {object} signal - Condensed signal from signal-condenser
 * @param {object} ruleDecision - Decision from rule engine
 * @returns {object} Escalation decision
 */
function shouldEscalate(signal, ruleDecision) {
  const config = getConfig();
  
  const triggers = [];
  
  // Check all escalation conditions
  const contradictions = hasContradictorySignals(signal);
  if (contradictions.hasContradictions) {
    triggers.push({
      type: 'contradictory_signals',
      severity: 'high',
      details: contradictions.contradictions
    });
  }
  
  const extremes = hasExtremeConditions(signal, config);
  if (extremes.hasExtremes) {
    triggers.push({
      type: 'extreme_conditions',
      severity: 'high',
      details: extremes.extremes
    });
  }
  
  const grayZone = isGrayZone(signal.composite_score, config);
  if (grayZone.inGrayZone) {
    triggers.push({
      type: 'gray_zone_confidence',
      severity: 'medium',
      details: [`Composite score ${grayZone.score} in gray zone ${grayZone.range}`]
    });
  }
  
  const misaligned = isFullyMisaligned(signal);
  if (misaligned.isMisaligned) {
    triggers.push({
      type: 'timeframe_misalignment',
      severity: 'medium',
      details: [`All timeframes misaligned (alignment: ${misaligned.alignment})`]
    });
  }
  
  const riskExtreme = isRiskMultiplierExtreme(config);
  if (riskExtreme.isExtreme) {
    triggers.push({
      type: 'risk_multiplier_extreme',
      severity: riskExtreme.value === 0.0 ? 'critical' : 'high',
      details: [riskExtreme.note]
    });
  }
  
  // Decision
  const shouldEscalate = triggers.length > 0;
  
  // If risk_multiplier is 0.0, ALWAYS escalate or wait (no autonomous trading)
  const forceWait = config.riskManagement.risk_multiplier === 0.0;
  
  return {
    shouldEscalate,
    forceWait,
    triggers,
    triggerCount: triggers.length,
    highSeverityCount: triggers.filter(t => t.severity === 'high' || t.severity === 'critical').length,
    recommendation: shouldEscalate 
      ? 'Escalate to LLM for decision' 
      : 'Proceed with rule engine decision',
    signal,
    ruleDecision
  };
}

/**
 * Build escalation prompt for LLM
 */
function buildEscalationPrompt(escalation) {
  const { signal, ruleDecision, triggers } = escalation;
  
  let prompt = `🚨 TRADING ESCALATION - LLM Decision Required\n\n`;
  
  prompt += `**Symbol:** ${signal.symbol}\n`;
  prompt += `**Timestamp:** ${signal.timestamp}\n\n`;
  
  prompt += `**Escalation Triggers:**\n`;
  triggers.forEach(t => {
    prompt += `- [${t.severity.toUpperCase()}] ${t.type}\n`;
    t.details.forEach(d => prompt += `  → ${d}\n`);
  });
  
  prompt += `\n**Market Signals:**\n`;
  prompt += `- Price: ${signal.price}\n`;
  prompt += `- RSI: ${signal.momentum.rsi} (${signal.momentum.rsi_zone})\n`;
  prompt += `- MACD: ${signal.trend.macd_histogram} (${signal.trend.macd_trend})\n`;
  prompt += `- EMA: ${signal.trend.ema_cross}, above EMA200: ${signal.trend.ema200_pos}\n`;
  prompt += `- Multi-TF alignment: ${signal.multi_tf_alignment}/4\n`;
  prompt += `- Volume ratio: ${signal.momentum.volume_ratio}x\n`;
  prompt += `- ATR: ${signal.volatility.atr_pct}%\n`;
  prompt += `- Funding rate: ${signal.derivatives.funding_rate}%\n`;
  prompt += `- OI change 24h: ${signal.derivatives.oi_change_24h}%\n`;
  prompt += `- Composite score: ${signal.composite_score}/100\n`;
  
  prompt += `\n**Rule Engine Decision:**\n`;
  prompt += `- Action: ${ruleDecision.action}\n`;
  prompt += `- Tier: ${ruleDecision.tier || 'N/A'}\n`;
  prompt += `- Confidence: ${ruleDecision.confidence}%\n`;
  prompt += `- Reasoning: ${ruleDecision.reasoning}\n`;
  
  prompt += `\n**Question:**\n`;
  prompt += `Should we: LONG / SHORT / WAIT / CLOSE?\n\n`;
  prompt += `Respond with JSON:\n`;
  prompt += `{\n`;
  prompt += `  "action": "open_long|open_short|wait|close_long|close_short",\n`;
  prompt += `  "confidence": 0-100,\n`;
  prompt += `  "reasoning": "your analysis"\n`;
  prompt += `}\n`;
  
  return prompt;
}

module.exports = {
  shouldEscalate,
  buildEscalationPrompt,
  
  // Export checks for testing
  hasContradictorySignals,
  hasExtremeConditions,
  isGrayZone,
  isFullyMisaligned,
  isRiskMultiplierExtreme
};
