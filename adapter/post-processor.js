/**
 * Post-Processor: Take LLM analysis output and build final trading decisions
 * 
 * The LLM only provides: { action, confidence, reasoning } per symbol.
 * This module handles ALL the math:
 *   - Tier determination (≥75% = tier 1, 72-74% = tier 2, <72 = wait)
 *   - MACD requirement for tier 2
 *   - Position sizing
 *   - Stop-loss / take-profit calculations
 *   - Leverage assignment
 *   - Validation of all numeric fields
 */

const { isBtcEth, roundNum } = require('./pre-processor');

/**
 * Determine confidence tier
 * @returns {1|2|3} tier number
 */
function determineTier(confidence) {
  if (confidence >= 75) return 1;
  if (confidence >= 72) return 2;
  return 3;
}

/**
 * Check tier 2 MACD requirement: both 3m and 4h must be > 0
 */
function checkTier2Macd(indicators) {
  const macd3m = indicators.macd3m;
  const macd4h = indicators.macd4h;
  
  if (macd3m === null || macd4h === null) {
    return { passed: false, reason: 'MACD data missing for tier 2 validation (need both 3m and 4h)' };
  }
  if (macd3m <= 0) {
    return { passed: false, reason: `Tier 2 requires MACD 3m > 0 (got ${macd3m})` };
  }
  if (macd4h <= 0) {
    return { passed: false, reason: `Tier 2 requires MACD 4h > 0 (got ${macd4h})` };
  }
  return { passed: true };
}

/**
 * Calculate position size based on tier
 * Tier 1: (confidence/100) × maxPositionSize
 * Tier 2: 0.5 × (confidence/100) × maxPositionSize
 */
function calcPositionSize(confidence, tier, maxPositionSize) {
  if (tier === 1) {
    return (confidence / 100) * maxPositionSize;
  }
  if (tier === 2) {
    return 0.5 * (confidence / 100) * maxPositionSize;
  }
  return 0;
}

/**
 * Calculate stop-loss distance based on tier and ATR
 * Tier 1: ATR × 2.0
 * Tier 2: ATR × 1.5
 */
function calcStopDistance(atr, tier) {
  if (tier === 1) return atr * 2.0;
  if (tier === 2) return atr * 1.5;
  return atr * 2.0; // fallback
}

/**
 * Calculate stop-loss price
 */
function calcStopLoss(entryPrice, stopDistance, action) {
  if (action === 'open_long') {
    return entryPrice - stopDistance;
  }
  if (action === 'open_short') {
    return entryPrice + stopDistance;
  }
  return null;
}

/**
 * Calculate take-profit price
 */
function calcTakeProfit(entryPrice, stopDistance, minRiskRewardRatio, action) {
  if (action === 'open_long') {
    return entryPrice + (stopDistance * minRiskRewardRatio);
  }
  if (action === 'open_short') {
    return entryPrice - (stopDistance * minRiskRewardRatio);
  }
  return null;
}

/**
 * Validate a fully-built decision
 * Returns { valid: true } or { valid: false, reason: '...' }
 */
function validateDecision(decision, strategy) {
  const rc = strategy.config.risk_control;
  
  if (decision.action.startsWith('open_')) {
    // Leverage limits
    const maxLev = isBtcEth(decision.symbol) ? rc.btc_eth_max_leverage : rc.altcoin_max_leverage;
    if (decision.leverage > maxLev) {
      return { valid: false, reason: `Leverage ${decision.leverage} exceeds max ${maxLev} for ${decision.symbol}` };
    }
    if (decision.leverage < 1) {
      return { valid: false, reason: `Leverage must be >= 1 (got ${decision.leverage})` };
    }

    // Min position size
    if (decision.positionSizeUsd < rc.min_position_size) {
      return { valid: false, reason: `Position size $${decision.positionSizeUsd} below minimum $${rc.min_position_size}` };
    }

    // Stop-loss must be set and valid
    if (!decision.stopLoss || decision.stopLoss <= 0) {
      return { valid: false, reason: 'Invalid stop-loss' };
    }

    // Take-profit must be set and valid
    if (!decision.takeProfit || decision.takeProfit <= 0) {
      return { valid: false, reason: 'Invalid take-profit' };
    }

    // Risk/reward ratio check
    const entryPrice = decision._entryPrice || decision.stopLoss; // fallback
    if (decision.action === 'open_long') {
      const risk = entryPrice - decision.stopLoss;
      const reward = decision.takeProfit - entryPrice;
      if (risk > 0) {
        const rr = reward / risk;
        if (rr < rc.min_risk_reward_ratio) {
          return { valid: false, reason: `R/R ratio ${rr.toFixed(2)}:1 below minimum ${rc.min_risk_reward_ratio}:1` };
        }
      }
    } else if (decision.action === 'open_short') {
      const risk = decision.stopLoss - entryPrice;
      const reward = entryPrice - decision.takeProfit;
      if (risk > 0) {
        const rr = reward / risk;
        if (rr < rc.min_risk_reward_ratio) {
          return { valid: false, reason: `R/R ratio ${rr.toFixed(2)}:1 below minimum ${rc.min_risk_reward_ratio}:1` };
        }
      }
    }
  }

  return { valid: true };
}

/**
 * Process a single LLM decision for a symbol.
 * 
 * @param {Object} llmDecision - { symbol, action, confidence, reasoning }
 * @param {Object} indicators - Pre-extracted indicators for this symbol
 * @param {Object} strategy - Loaded strategy config
 * @returns {Object} Final decision with all calculated fields
 */
function processDecision(llmDecision, indicators, strategy) {
  const rc = strategy.config.risk_control;
  const { symbol, action, confidence, reasoning } = llmDecision;

  // Non-entry actions: pass through with minimal enrichment
  if (!action.startsWith('open_')) {
    return {
      symbol,
      action,
      confidence: Number(confidence),
      reasoning
    };
  }

  // Entry actions: full calculation pipeline
  const tier = determineTier(confidence);
  const entryPrice = indicators?.price;

  // Tier 3: reject
  if (tier === 3) {
    return {
      symbol,
      action: 'wait',
      confidence: Number(confidence),
      reasoning: `${reasoning} [Post-processor: Confidence ${confidence}% below minimum 72% — converted to wait]`
    };
  }

  // Tier 2: MACD requirement check
  if (tier === 2 && indicators) {
    const macdCheck = checkTier2Macd(indicators);
    if (!macdCheck.passed) {
      return {
        symbol,
        action: 'wait',
        confidence: Number(confidence),
        reasoning: `${reasoning} [Post-processor: ${macdCheck.reason} — converted to wait]`
      };
    }
  }

  // Calculate position parameters
  const maxPositionSize = indicators?.maxPositionSize || 0;
  const atr = indicators?.atr;
  const maxLeverage = indicators?.maxLeverage || (isBtcEth(symbol) ? rc.btc_eth_max_leverage : rc.altcoin_max_leverage);

  // Position size
  let positionSizeUsd = calcPositionSize(confidence, tier, maxPositionSize);
  
  // Enforce minimum
  if (positionSizeUsd < rc.min_position_size) {
    return {
      symbol,
      action: 'wait',
      confidence: Number(confidence),
      reasoning: `${reasoning} [Post-processor: Calculated position $${positionSizeUsd.toFixed(2)} below minimum $${rc.min_position_size} — converted to wait]`
    };
  }

  // Stop-loss / take-profit (need ATR and entry price)
  let stopLoss = null;
  let takeProfit = null;
  let stopDistance = null;

  if (atr && entryPrice) {
    stopDistance = calcStopDistance(atr, tier);
    stopLoss = calcStopLoss(entryPrice, stopDistance, action);
    takeProfit = calcTakeProfit(entryPrice, stopDistance, rc.min_risk_reward_ratio, action);
  } else {
    // If we lack ATR/price, we can't calculate stops — use LLM's values if provided
    stopLoss = llmDecision.stopLoss || null;
    takeProfit = llmDecision.takeProfit || null;
  }

  // Build decision
  const decision = {
    symbol,
    action,
    leverage: Math.round(maxLeverage),
    positionSizeUsd: Number(positionSizeUsd.toFixed(2)),
    stopLoss: stopLoss !== null ? Number(stopLoss.toFixed(2)) : null,
    takeProfit: takeProfit !== null ? Number(takeProfit.toFixed(2)) : null,
    confidence: Number(confidence),
    reasoning: `${reasoning} [Tier ${tier}, Size: (${tier === 2 ? '0.5×' : ''}${confidence}/100)×$${maxPositionSize.toFixed(0)}=$${positionSizeUsd.toFixed(0)}, SL: ATR×${tier === 1 ? '2.0' : '1.5'}]`,
    _entryPrice: entryPrice, // internal, for validation
    _tier: tier
  };

  // Validate
  const validation = validateDecision(decision, strategy);
  if (!validation.valid) {
    return {
      symbol,
      action: 'wait',
      confidence: Number(confidence),
      reasoning: `${reasoning} [Post-processor validation failed: ${validation.reason} — converted to wait]`
    };
  }

  // Clean internal fields before returning
  delete decision._entryPrice;
  delete decision._tier;

  return decision;
}

/**
 * Post-process all LLM decisions.
 * 
 * @param {Array} llmDecisions - Array of { symbol, action, confidence, reasoning }
 * @param {Object} symbolIndicators - Map of symbol -> extracted indicators (from pre-processor)
 * @param {Object} strategy - Loaded strategy config
 * @returns {Array} Final decisions ready for NoFx
 */
function postProcess(llmDecisions, symbolIndicators, strategy) {
  const results = [];

  for (const llmDec of llmDecisions) {
    const indicators = symbolIndicators[llmDec.symbol] || null;
    const decision = processDecision(llmDec, indicators, strategy);
    results.push(decision);
  }

  // Enforce max positions limit
  const rc = strategy.config.risk_control;
  const openActions = results.filter(d => d.action.startsWith('open_'));
  if (openActions.length > rc.max_positions) {
    // Sort by confidence descending, keep top N
    openActions.sort((a, b) => b.confidence - a.confidence);
    const rejected = openActions.slice(rc.max_positions);
    for (const r of rejected) {
      const idx = results.indexOf(r);
      results[idx] = {
        symbol: r.symbol,
        action: 'wait',
        confidence: r.confidence,
        reasoning: `${r.reasoning} [Post-processor: Exceeds max ${rc.max_positions} positions — converted to wait]`
      };
    }
  }

  return results;
}

module.exports = {
  postProcess,
  processDecision,
  determineTier,
  checkTier2Macd,
  calcPositionSize,
  calcStopDistance,
  calcStopLoss,
  calcTakeProfit,
  validateDecision
};
