#!/usr/bin/env node
/**
 * Indicator Analysis Module
 * 
 * Tracks historical indicator values and detects patterns:
 * - MACD cross detection (bullish/bearish)
 * - Rolling buffer of indicator values
 * 
 * Features:
 * - In-memory storage using data-buffer
 * - Cross detection with previous period comparison
 * - Min 2 periods required for cross detection
 */

const { getGlobalBuffer } = require('./data-buffer');

/**
 * Detect MACD cross (MACD line vs Signal line)
 * 
 * @param {string} symbol - Trading symbol
 * @param {string} timeframe - Timeframe
 * @param {number} currentMACD - Current MACD line value
 * @param {number} currentSignal - Current Signal line value
 * @returns {string} "bullish" | "bearish" | "none"
 */
function detectMACDCross(symbol, timeframe, currentMACD, currentSignal) {
  // Validate inputs
  if (currentMACD === null || currentMACD === undefined || 
      currentSignal === null || currentSignal === undefined) {
    return 'none';
  }

  const buffer = getGlobalBuffer();
  
  // Get previous MACD data
  const history = buffer.get(symbol, timeframe, 2); // Last 2 periods
  
  // Need at least 1 previous period for cross detection
  if (history.length < 1) {
    // Store current values for next comparison
    buffer.push(symbol, timeframe, {
      macd: currentMACD,
      signal: currentSignal,
      timestamp: new Date().toISOString()
    });
    return 'none';
  }
  
  // Get previous period
  const previous = history[history.length - 1];
  const prevMACD = previous.macd;
  const prevSignal = previous.signal;
  
  // Store current values
  buffer.push(symbol, timeframe, {
    macd: currentMACD,
    signal: currentSignal,
    timestamp: new Date().toISOString()
  });
  
  // Detect cross
  // Bullish: MACD crosses above Signal (prev: below, now: above)
  if (prevMACD <= prevSignal && currentMACD > currentSignal) {
    return 'bullish';
  }
  
  // Bearish: MACD crosses below Signal (prev: above, now: below)
  if (prevMACD >= prevSignal && currentMACD < currentSignal) {
    return 'bearish';
  }
  
  return 'none';
}

/**
 * Detect MACD histogram cross (zero line)
 * 
 * @param {string} symbol - Trading symbol
 * @param {string} timeframe - Timeframe
 * @param {number} currentHistogram - Current MACD histogram value
 * @returns {string} "bullish" | "bearish" | "none"
 */
function detectMACDHistogramCross(symbol, timeframe, currentHistogram) {
  if (currentHistogram === null || currentHistogram === undefined) {
    return 'none';
  }

  const buffer = getGlobalBuffer();
  const bufferKey = `${symbol}:${timeframe}:histogram`;
  
  // Get previous histogram
  const history = buffer.get(bufferKey, 'histogram', 2);
  
  if (history.length < 1) {
    buffer.push(bufferKey, 'histogram', {
      value: currentHistogram,
      timestamp: new Date().toISOString()
    });
    return 'none';
  }
  
  const previous = history[history.length - 1];
  const prevHistogram = previous.value;
  
  // Store current
  buffer.push(bufferKey, 'histogram', {
    value: currentHistogram,
    timestamp: new Date().toISOString()
  });
  
  // Bullish: crosses above zero line
  if (prevHistogram <= 0 && currentHistogram > 0) {
    return 'bullish';
  }
  
  // Bearish: crosses below zero line
  if (prevHistogram >= 0 && currentHistogram < 0) {
    return 'bearish';
  }
  
  return 'none';
}

/**
 * Get MACD history for analysis
 * 
 * @param {string} symbol - Trading symbol
 * @param {string} timeframe - Timeframe
 * @param {number} periods - Number of periods to retrieve
 * @returns {array} Historical MACD data
 */
function getMACDHistory(symbol, timeframe, periods = 10) {
  const buffer = getGlobalBuffer();
  return buffer.get(symbol, timeframe, periods);
}

/**
 * Detect divergence (price vs indicator)
 * Future enhancement: Detect bullish/bearish divergence
 * 
 * @param {array} priceData - Array of price points
 * @param {array} indicatorData - Array of indicator values
 * @returns {string} "bullish_divergence" | "bearish_divergence" | "none"
 */
function detectDivergence(priceData, indicatorData) {
  // TODO: Implement divergence detection
  // Bullish: Price makes lower lows, indicator makes higher lows
  // Bearish: Price makes higher highs, indicator makes lower highs
  return 'none';
}

/**
 * Clear indicator history for symbol/timeframe
 */
function clearIndicatorHistory(symbol, timeframe) {
  const buffer = getGlobalBuffer();
  buffer.clear(symbol, timeframe);
  buffer.clear(`${symbol}:${timeframe}:histogram`, 'histogram');
}

/**
 * Get indicator buffer stats
 */
function getIndicatorStats() {
  const buffer = getGlobalBuffer();
  return buffer.getStats();
}

module.exports = {
  detectMACDCross,
  detectMACDHistogramCross,
  getMACDHistory,
  detectDivergence,
  clearIndicatorHistory,
  getIndicatorStats
};
