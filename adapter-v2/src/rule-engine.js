#!/usr/bin/env node
/**
 * Rule Engine
 * 
 * Implements deterministic trading rules for Tier 1 and Tier 2 entries.
 * Returns trading decisions without LLM involvement.
 * 
 * Rules Structure (from TRADING_ARCHITECTURE_V2.md):
 * 
 * LONG Tier 1 (≥75% confidence):
 *   - RSI < 35
 *   - MACD bullish cross
 *   - EMA cross bullish
 *   - Multi-TF alignment ≥ 3
 *   - Volume ratio > 1.2
 *   - Must match 4 of 5 conditions
 * 
 * LONG Tier 2 (72-74% confidence):
 *   - RSI < 40
 *   - MACD histogram > 0
 *   - EMA cross bullish OR price above EMA200
 *   - Multi-TF alignment ≥ 2
 *   - Must match 3 of 4 conditions
 * 
 * SHORT rules are inverse of LONG rules
 */

const { getConfig } = require('./config');

/**
 * Evaluate LONG Tier 1 conditions
 */
function evaluateLongTier1(signal, config) {
  const conditions = [];
  const params = config.ruleEngine;
  
  // Condition 1: RSI oversold
  const c1 = signal.momentum.rsi !== null && signal.momentum.rsi < params.rsi_oversold;
  conditions.push({ name: 'RSI oversold', met: c1, value: signal.momentum.rsi });
  
  // Condition 2: MACD bullish cross
  const c2 = signal.trend.macd_cross === 'bullish';
  conditions.push({ name: 'MACD bullish cross', met: c2, value: signal.trend.macd_cross });
  
  // Condition 3: EMA cross bullish
  const c3 = signal.trend.ema_cross === 'bullish';
  conditions.push({ name: 'EMA cross bullish', met: c3, value: signal.trend.ema_cross });
  
  // Condition 4: Multi-TF alignment
  const c4 = signal.multi_tf_alignment >= params.min_tf_alignment;
  conditions.push({ name: 'Multi-TF alignment', met: c4, value: signal.multi_tf_alignment });
  
  // Condition 5: Volume ratio
  const c5 = signal.momentum.volume_ratio !== null && signal.momentum.volume_ratio > params.min_volume_ratio;
  conditions.push({ name: 'Volume ratio', met: c5, value: signal.momentum.volume_ratio });
  
  const metCount = conditions.filter(c => c.met).length;
  const required = 4; // Must match 4 of 5
  
  return {
    tier: 'tier1',
    direction: 'long',
    matched: metCount >= required,
    confidence: metCount >= required ? 76 : null, // Tier 1 = 75%+
    conditions,
    metCount,
    required
  };
}

/**
 * Evaluate LONG Tier 2 conditions
 */
function evaluateLongTier2(signal, config) {
  const conditions = [];
  const params = config.ruleEngine;
  
  // Condition 1: RSI oversold (less strict)
  const c1 = signal.momentum.rsi !== null && signal.momentum.rsi < params.rsi_tier2_oversold;
  conditions.push({ name: 'RSI oversold (tier2)', met: c1, value: signal.momentum.rsi });
  
  // Condition 2: MACD histogram positive
  const c2 = signal.trend.macd_histogram !== null && signal.trend.macd_histogram > 0;
  conditions.push({ name: 'MACD histogram > 0', met: c2, value: signal.trend.macd_histogram });
  
  // Condition 3: EMA bullish OR above EMA200
  const c3 = signal.trend.ema_cross === 'bullish' || signal.trend.ema200_pos === 'above';
  conditions.push({ 
    name: 'EMA bullish OR above EMA200', 
    met: c3, 
    value: `${signal.trend.ema_cross} / ${signal.trend.ema200_pos}` 
  });
  
  // Condition 4: Multi-TF alignment (less strict)
  const c4 = signal.multi_tf_alignment >= params.min_tf_alignment_tier2;
  conditions.push({ name: 'Multi-TF alignment (tier2)', met: c4, value: signal.multi_tf_alignment });
  
  // ADDITIONAL: 3m and 4h MACD both positive (from masterplan)
  const c5 = signal.momentum.macd_3m > 0 && signal.momentum.macd_4h > 0;
  conditions.push({ 
    name: '3m+4h MACD positive', 
    met: c5, 
    value: `3m:${signal.momentum.macd_3m} 4h:${signal.momentum.macd_4h}` 
  });
  
  const metCount = conditions.filter(c => c.met).length;
  const required = 4; // Must match 4 of 5 for Tier 2
  
  return {
    tier: 'tier2',
    direction: 'long',
    matched: metCount >= required,
    confidence: metCount >= required ? 73 : null, // Tier 2 = 72-74%
    conditions,
    metCount,
    required
  };
}

/**
 * Evaluate SHORT Tier 1 conditions (inverse of LONG)
 */
function evaluateShortTier1(signal, config) {
  const conditions = [];
  const params = config.ruleEngine;
  
  // Condition 1: RSI overbought
  const c1 = signal.momentum.rsi !== null && signal.momentum.rsi > params.rsi_overbought;
  conditions.push({ name: 'RSI overbought', met: c1, value: signal.momentum.rsi });
  
  // Condition 2: MACD bearish cross
  const c2 = signal.trend.macd_cross === 'bearish';
  conditions.push({ name: 'MACD bearish cross', met: c2, value: signal.trend.macd_cross });
  
  // Condition 3: EMA cross bearish
  const c3 = signal.trend.ema_cross === 'bearish';
  conditions.push({ name: 'EMA cross bearish', met: c3, value: signal.trend.ema_cross });
  
  // Condition 4: Multi-TF alignment
  const c4 = signal.multi_tf_alignment >= params.min_tf_alignment;
  conditions.push({ name: 'Multi-TF alignment', met: c4, value: signal.multi_tf_alignment });
  
  // Condition 5: Volume ratio
  const c5 = signal.momentum.volume_ratio !== null && signal.momentum.volume_ratio > params.min_volume_ratio;
  conditions.push({ name: 'Volume ratio', met: c5, value: signal.momentum.volume_ratio });
  
  const metCount = conditions.filter(c => c.met).length;
  const required = 4;
  
  return {
    tier: 'tier1',
    direction: 'short',
    matched: metCount >= required,
    confidence: metCount >= required ? 76 : null,
    conditions,
    metCount,
    required
  };
}

/**
 * Evaluate SHORT Tier 2 conditions
 */
function evaluateShortTier2(signal, config) {
  const conditions = [];
  const params = config.ruleEngine;
  
  // Condition 1: RSI overbought (less strict)
  const c1 = signal.momentum.rsi !== null && signal.momentum.rsi > params.rsi_tier2_overbought;
  conditions.push({ name: 'RSI overbought (tier2)', met: c1, value: signal.momentum.rsi });
  
  // Condition 2: MACD histogram negative
  const c2 = signal.trend.macd_histogram !== null && signal.trend.macd_histogram < 0;
  conditions.push({ name: 'MACD histogram < 0', met: c2, value: signal.trend.macd_histogram });
  
  // Condition 3: EMA bearish OR below EMA200
  const c3 = signal.trend.ema_cross === 'bearish' || signal.trend.ema200_pos === 'below';
  conditions.push({ 
    name: 'EMA bearish OR below EMA200', 
    met: c3, 
    value: `${signal.trend.ema_cross} / ${signal.trend.ema200_pos}` 
  });
  
  // Condition 4: Multi-TF alignment (less strict)
  const c4 = signal.multi_tf_alignment >= params.min_tf_alignment_tier2;
  conditions.push({ name: 'Multi-TF alignment (tier2)', met: c4, value: signal.multi_tf_alignment });
  
  // ADDITIONAL: 3m and 4h MACD both negative
  const c5 = signal.momentum.macd_3m < 0 && signal.momentum.macd_4h < 0;
  conditions.push({ 
    name: '3m+4h MACD negative', 
    met: c5, 
    value: `3m:${signal.momentum.macd_3m} 4h:${signal.momentum.macd_4h}` 
  });
  
  const metCount = conditions.filter(c => c.met).length;
  const required = 4;
  
  return {
    tier: 'tier2',
    direction: 'short',
    matched: metCount >= required,
    confidence: metCount >= required ? 73 : null,
    conditions,
    metCount,
    required
  };
}

/**
 * Check auto-exit conditions
 */
function evaluateAutoExit(signal, existingPosition, config) {
  if (!existingPosition) return { shouldExit: false };
  
  const params = config.ruleEngine;
  const direction = existingPosition.direction; // 'long' or 'short'
  
  if (direction === 'long') {
    // Exit LONG if: RSI > 75 AND MACD bearish cross
    const rsiOverbought = signal.momentum.rsi > 75;
    const macdBearish = signal.trend.macd_cross === 'bearish';
    
    if (rsiOverbought && macdBearish) {
      return {
        shouldExit: true,
        reason: 'Auto-exit: RSI overbought + MACD bearish cross',
        confidence: 85
      };
    }
  }
  
  if (direction === 'short') {
    // Exit SHORT if: RSI < 25 AND MACD bullish cross
    const rsiOversold = signal.momentum.rsi < 25;
    const macdBullish = signal.trend.macd_cross === 'bullish';
    
    if (rsiOversold && macdBullish) {
      return {
        shouldExit: true,
        reason: 'Auto-exit: RSI oversold + MACD bullish cross',
        confidence: 85
      };
    }
  }
  
  return { shouldExit: false };
}

/**
 * Main rule engine evaluation
 */
function evaluateSignal(signal, existingPosition = null) {
  const config = getConfig();
  
  // Check auto-exit first
  if (existingPosition) {
    const exitEval = evaluateAutoExit(signal, existingPosition, config);
    if (exitEval.shouldExit) {
      return {
        action: existingPosition.direction === 'long' ? 'close_long' : 'close_short',
        tier: null,
        confidence: exitEval.confidence,
        reasoning: exitEval.reason,
        evaluation: exitEval
      };
    }
  }
  
  // Evaluate all tiers
  const longT1 = evaluateLongTier1(signal, config);
  const longT2 = evaluateLongTier2(signal, config);
  const shortT1 = evaluateShortTier1(signal, config);
  const shortT2 = evaluateShortTier2(signal, config);
  
  // Priority: Tier 1 > Tier 2 > WAIT
  if (longT1.matched) {
    return {
      action: 'open_long',
      tier: 'tier1',
      confidence: longT1.confidence,
      reasoning: buildReasoning(longT1),
      evaluation: longT1
    };
  }
  
  if (shortT1.matched) {
    return {
      action: 'open_short',
      tier: 'tier1',
      confidence: shortT1.confidence,
      reasoning: buildReasoning(shortT1),
      evaluation: shortT1
    };
  }
  
  if (longT2.matched) {
    return {
      action: 'open_long',
      tier: 'tier2',
      confidence: longT2.confidence,
      reasoning: buildReasoning(longT2),
      evaluation: longT2
    };
  }
  
  if (shortT2.matched) {
    return {
      action: 'open_short',
      tier: 'tier2',
      confidence: shortT2.confidence,
      reasoning: buildReasoning(shortT2),
      evaluation: shortT2
    };
  }
  
  // No conditions met → WAIT
  return {
    action: 'wait',
    tier: null,
    confidence: 50,
    reasoning: 'No tier conditions met. Market signals insufficient for entry.',
    evaluation: {
      longT1,
      longT2,
      shortT1,
      shortT2
    }
  };
}

/**
 * Build human-readable reasoning from evaluation
 */
function buildReasoning(evaluation) {
  const { tier, direction, conditions, metCount, required } = evaluation;
  
  const metConditions = conditions.filter(c => c.met);
  const unmatchedConditions = conditions.filter(c => !c.met);
  
  let reasoning = `${tier.toUpperCase()} ${direction.toUpperCase()}: ${metCount}/${conditions.length} conditions met (required: ${required})\n`;
  reasoning += `\n✅ Matched:\n`;
  metConditions.forEach(c => {
    reasoning += `  - ${c.name}: ${c.value}\n`;
  });
  
  if (unmatchedConditions.length > 0) {
    reasoning += `\n❌ Not matched:\n`;
    unmatchedConditions.forEach(c => {
      reasoning += `  - ${c.name}: ${c.value}\n`;
    });
  }
  
  return reasoning;
}

module.exports = {
  evaluateSignal,
  evaluateLongTier1,
  evaluateLongTier2,
  evaluateShortTier1,
  evaluateShortTier2,
  evaluateAutoExit
};
