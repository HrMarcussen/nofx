#!/usr/bin/env node
/**
 * Position Sizer
 * 
 * Calculates position size, stop loss, and take profit based on:
 * - Risk management parameters (HARD LIMITS)
 * - Dynamic risk_multiplier (0.0 - 1.5, set by LLM daily)
 * - Tier-based position multipliers
 * - ATR-based stops and targets
 * 
 * Formula:
 *   base_position = capital × risk_per_trade × leverage
 *   position_size = base_position × tier_multiplier × risk_multiplier
 *   stop_loss = entry ± (ATR × stop_multiplier)
 *   take_profit = entry + (stop_distance × risk_reward_ratio)
 */

const { getConfig } = require('./config');

/**
 * Calculate position size
 * 
 * @param {number} capital - Total available capital (USD)
 * @param {string} tier - 'tier1' or 'tier2'
 * @param {object} config - Config object (optional, will load if not provided)
 * @returns {number} Position size in USD
 */
function calculatePositionSize(capital, tier, config = null) {
  if (!config) config = getConfig();
  
  const { riskManagement, positionSizing } = config;
  
  // Base calculation (HARD LIMITS)
  const base = capital * riskManagement.risk_per_trade * riskManagement.max_leverage;
  
  // Apply tier multiplier
  const tierMultiplier = tier === 'tier1' 
    ? positionSizing.tier1_position_multiplier 
    : positionSizing.tier2_position_multiplier;
  
  // Apply dynamic risk multiplier
  const riskMultiplier = riskManagement.risk_multiplier;
  
  // Final position size
  let positionSize = base * tierMultiplier * riskMultiplier;
  
  // Clamp to limits
  positionSize = Math.max(positionSizing.min_position_size_usd, positionSize);
  positionSize = Math.min(positionSizing.max_position_size_usd, positionSize);
  
  return Math.round(positionSize * 100) / 100; // Round to 2 decimals
}

/**
 * Calculate stop loss price
 * 
 * @param {number} entryPrice - Entry price
 * @param {number} atr - Average True Range
 * @param {string} direction - 'long' or 'short'
 * @param {string} tier - 'tier1' or 'tier2'
 * @param {object} config - Config object
 * @returns {number} Stop loss price
 */
function calculateStopLoss(entryPrice, atr, direction, tier, config = null) {
  if (!config) config = getConfig();
  
  const { stopLoss } = config;
  
  const stopMultiplier = tier === 'tier1' 
    ? stopLoss.tier1_stop_multiplier 
    : stopLoss.tier2_stop_multiplier;
  
  const stopDistance = atr * stopMultiplier;
  
  if (direction === 'long') {
    return Math.round((entryPrice - stopDistance) * 100) / 100;
  } else {
    return Math.round((entryPrice + stopDistance) * 100) / 100;
  }
}

/**
 * Calculate take profit price
 * 
 * @param {number} entryPrice - Entry price
 * @param {number} stopLoss - Stop loss price
 * @param {string} direction - 'long' or 'short'
 * @param {string} tier - 'tier1' or 'tier2'
 * @param {object} config - Config object
 * @returns {number} Take profit price
 */
function calculateTakeProfit(entryPrice, stopLoss, direction, tier, config = null) {
  if (!config) config = getConfig();
  
  const { stopLoss: stopConfig } = config;
  
  const tpMultiplier = tier === 'tier1' 
    ? stopConfig.tier1_tp_multiplier 
    : stopConfig.tier2_tp_multiplier;
  
  const stopDistance = Math.abs(entryPrice - stopLoss);
  const tpDistance = stopDistance * tpMultiplier;
  
  if (direction === 'long') {
    return Math.round((entryPrice + tpDistance) * 100) / 100;
  } else {
    return Math.round((entryPrice - tpDistance) * 100) / 100;
  }
}

/**
 * Calculate risk/reward ratio
 */
function calculateRiskReward(entryPrice, stopLoss, takeProfit) {
  const risk = Math.abs(entryPrice - stopLoss);
  const reward = Math.abs(takeProfit - entryPrice);
  
  if (risk === 0) return 0;
  return Math.round((reward / risk) * 100) / 100;
}

/**
 * Calculate expected profit/loss in USD
 */
function calculateExpectedPnL(positionSize, entryPrice, exitPrice, direction) {
  const priceChange = exitPrice - entryPrice;
  const pnlMultiplier = direction === 'long' ? 1 : -1;
  const pnl = (priceChange / entryPrice) * positionSize * pnlMultiplier;
  
  return Math.round(pnl * 100) / 100;
}

/**
 * Calculate trading fees (Binance futures)
 */
function calculateFees(positionSize, feeRate = 0.0004) {
  // Maker/Taker fee for Binance futures (0.04% default)
  const entryFee = positionSize * feeRate;
  const exitFee = positionSize * feeRate;
  
  return {
    entryFee: Math.round(entryFee * 100) / 100,
    exitFee: Math.round(exitFee * 100) / 100,
    totalFee: Math.round((entryFee + exitFee) * 100) / 100
  };
}

/**
 * Validate if trade is fee-efficient
 * Expected profit should be > 2x round-trip fees
 */
function isFeeEfficient(positionSize, entryPrice, takeProfit, direction) {
  const fees = calculateFees(positionSize);
  const expectedProfit = calculateExpectedPnL(positionSize, entryPrice, takeProfit, direction);
  
  const profitAfterFees = expectedProfit - fees.totalFee;
  const isEfficient = profitAfterFees > (fees.totalFee * 2);
  
  return {
    isEfficient,
    expectedProfit,
    totalFees: fees.totalFee,
    profitAfterFees,
    minProfitNeeded: fees.totalFee * 2
  };
}

/**
 * Main function: Calculate complete position parameters
 * 
 * @param {object} params
 * @param {number} params.capital - Total capital
 * @param {number} params.entryPrice - Entry price
 * @param {number} params.atr - ATR value
 * @param {string} params.direction - 'long' or 'short'
 * @param {string} params.tier - 'tier1' or 'tier2'
 * @param {object} params.config - Optional config override
 * @returns {object} Complete position parameters
 */
function calculatePosition(params) {
  const { capital, entryPrice, atr, direction, tier, config = null } = params;
  
  const cfg = config || getConfig();
  
  // Calculate position size
  const positionSize = calculatePositionSize(capital, tier, cfg);
  
  // Calculate stop loss
  const stopLoss = calculateStopLoss(entryPrice, atr, direction, tier, cfg);
  
  // Calculate take profit
  const takeProfit = calculateTakeProfit(entryPrice, stopLoss, direction, tier, cfg);
  
  // Calculate R:R
  const riskReward = calculateRiskReward(entryPrice, stopLoss, takeProfit);
  
  // Calculate expected PnL
  const expectedProfit = calculateExpectedPnL(positionSize, entryPrice, takeProfit, direction);
  const expectedLoss = calculateExpectedPnL(positionSize, entryPrice, stopLoss, direction);
  
  // Fee efficiency check
  const feeCheck = isFeeEfficient(positionSize, entryPrice, takeProfit, direction);
  
  // Leverage
  const leverage = cfg.riskManagement.max_leverage;
  
  return {
    positionSize,
    leverage,
    stopLoss,
    takeProfit,
    riskReward,
    expectedProfit,
    expectedLoss,
    feeCheck,
    riskMultiplier: cfg.riskManagement.risk_multiplier,
    tier,
    direction
  };
}

module.exports = {
  calculatePosition,
  calculatePositionSize,
  calculateStopLoss,
  calculateTakeProfit,
  calculateRiskReward,
  calculateExpectedPnL,
  calculateFees,
  isFeeEfficient
};
