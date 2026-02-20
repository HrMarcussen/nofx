#!/usr/bin/env node
/**
 * Signal Condenser
 * 
 * Converts raw NoFx market data into compact signal summaries.
 * Extracts and normalizes indicators from various formats.
 * 
 * Input: Raw NoFx market data (complex, nested structure)
 * Output: Compact signal JSON (flat, normalized)
 */

const { detectMACDCross } = require('./indicators');

/**
 * Parse numeric value from various formats
 */
function parseNumeric(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const num = parseFloat(value.replace(/,/g, ''));
    return isNaN(num) ? null : num;
  }
  return null;
}

/**
 * Extract price from klines if not directly available
 */
function extractPriceFromKlines(symbolData) {
  // Try klines_4h first (more stable)
  if (symbolData.klines_4h && symbolData.klines_4h.length > 0) {
    const latest = symbolData.klines_4h[symbolData.klines_4h.length - 1];
    return parseNumeric(latest.close || latest[4]); // close price
  }
  
  // Try klines_3m
  if (symbolData.klines_3m && symbolData.klines_3m.length > 0) {
    const latest = symbolData.klines_3m[symbolData.klines_3m.length - 1];
    return parseNumeric(latest.close || latest[4]);
  }
  
  return null;
}

/**
 * Determine MACD trend direction
 */
function getMacdTrend(macdHistogram) {
  if (macdHistogram === null || macdHistogram === undefined) return null;
  if (macdHistogram > 0) return 'bullish';
  if (macdHistogram < 0) return 'bearish';
  return 'neutral';
}

/**
 * Detect MACD cross (requires historical data)
 * NOTE: Moved to indicators.js for proper buffer-based detection
 */
function detectMacdCross(currentMacd, previousMacd) {
  // Deprecated - use indicators.detectMACDCross instead
  if (!currentMacd || !previousMacd) return 'none';
  
  // Bullish cross: previous negative, current positive
  if (previousMacd < 0 && currentMacd > 0) return 'bullish';
  
  // Bearish cross: previous positive, current negative
  if (previousMacd > 0 && currentMacd < 0) return 'bearish';
  
  return 'none';
}

/**
 * Classify RSI zone
 */
function getRsiZone(rsi, oversoldThreshold = 35, overboughtThreshold = 65) {
  if (rsi === null || rsi === undefined) return 'unknown';
  if (rsi < oversoldThreshold) return 'oversold';
  if (rsi > overboughtThreshold) return 'overbought';
  return 'neutral';
}

/**
 * Determine EMA trend (price vs EMAs)
 */
function getEmaTrend(price, ema20, ema50, ema200) {
  const trend = {
    ema_cross: 'neutral',
    ema200_pos: 'unknown',
    ema_aligned: false
  };
  
  if (ema20 !== null && ema50 !== null) {
    trend.ema_cross = ema20 > ema50 ? 'bullish' : 'bearish';
  }
  
  if (price !== null && ema200 !== null) {
    trend.ema200_pos = price > ema200 ? 'above' : 'below';
  }
  
  // Aligned = EMA20 > EMA50 > EMA200 (bullish) or reverse (bearish)
  if (ema20 !== null && ema50 !== null && ema200 !== null) {
    trend.ema_aligned = (ema20 > ema50 && ema50 > ema200) || (ema20 < ema50 && ema50 < ema200);
  }
  
  return trend;
}

/**
 * Calculate Bollinger Band position (0 = lower, 0.5 = middle, 1 = upper)
 */
function getBbPosition(price, bbUpper, bbLower) {
  if (!price || !bbUpper || !bbLower) return null;
  const range = bbUpper - bbLower;
  if (range === 0) return 0.5;
  return (price - bbLower) / range;
}

/**
 * Calculate volume ratio vs average
 */
function getVolumeRatio(currentVolume, avgVolume) {
  if (!currentVolume || !avgVolume || avgVolume === 0) return null;
  return currentVolume / avgVolume;
}

/**
 * Count multi-timeframe alignment
 * Checks how many timeframes agree on trend direction
 */
function countTfAlignment(signals) {
  let bullishCount = 0;
  let bearishCount = 0;
  
  // Check MACD on different timeframes
  if (signals.macd_3m && signals.macd_3m > 0) bullishCount++;
  if (signals.macd_3m && signals.macd_3m < 0) bearishCount++;
  
  if (signals.macd_4h && signals.macd_4h > 0) bullishCount++;
  if (signals.macd_4h && signals.macd_4h < 0) bearishCount++;
  
  // Check EMA trend
  if (signals.ema_cross === 'bullish') bullishCount++;
  if (signals.ema_cross === 'bearish') bearishCount++;
  
  // Check RSI trend (oversold = potential bullish, overbought = potential bearish)
  if (signals.rsi_zone === 'oversold') bullishCount++;
  if (signals.rsi_zone === 'overbought') bearishCount++;
  
  // Return max alignment (could be bullish or bearish)
  return Math.max(bullishCount, bearishCount);
}

/**
 * Calculate composite confidence score (0-100)
 */
function calculateCompositeScore(signals, tfAlignment) {
  let score = 50; // Start neutral
  
  // Strong trend signals
  if (signals.ema_cross === 'bullish') score += 10;
  if (signals.ema_cross === 'bearish') score -= 10;
  
  // RSI signals
  if (signals.rsi_zone === 'oversold') score += 15;
  if (signals.rsi_zone === 'overbought') score -= 15;
  
  // MACD signals
  if (signals.macd_histogram > 0) score += 10;
  if (signals.macd_histogram < 0) score -= 10;
  
  // Multi-timeframe alignment bonus
  if (tfAlignment >= 3) score += 15;
  if (tfAlignment >= 4) score += 10;
  
  // Volume confirmation
  if (signals.volume_ratio > 1.2) score += 5;
  
  // Clamp to 0-100
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Condense raw NoFx data for a single symbol
 */
function condenseSymbol(symbolData, config = {}) {
  const symbol = symbolData.symbol || symbolData.coin || 'UNKNOWN';
  
  // Extract raw values
  const price = parseNumeric(symbolData.currentPrice || symbolData.price || symbolData.lastPrice) 
    || extractPriceFromKlines(symbolData);
  
  const atr = parseNumeric(symbolData.atr || symbolData.atr_14 || symbolData.indicators?.atr);
  const rsi = parseNumeric(symbolData.rsi || symbolData.rsi_14 || symbolData.indicators?.rsi);
  
  const macd_3m = parseNumeric(
    symbolData.macd_3m 
    || symbolData.macd?.['3m'] 
    || symbolData.indicators?.['3m']?.macd
  );
  
  const macd_4h = parseNumeric(
    symbolData.macd_4h 
    || symbolData.macd?.['4h'] 
    || symbolData.indicators?.['4h']?.macd
  );
  
  const ema20 = parseNumeric(symbolData.ema20 || symbolData.indicators?.ema20);
  const ema50 = parseNumeric(symbolData.ema50 || symbolData.indicators?.ema50);
  const ema200 = parseNumeric(symbolData.ema200 || symbolData.indicators?.ema200);
  
  const volume = parseNumeric(symbolData.volume || symbolData.currentVolume);
  const avgVolume = parseNumeric(symbolData.avgVolume || symbolData.volume_avg_20);
  
  const oi = parseNumeric(symbolData.openInterest || symbolData.oi);
  const oiChange = parseNumeric(symbolData.oiChange24h || symbolData.oi_change_24h);
  const fundingRate = parseNumeric(symbolData.fundingRate || symbolData.funding_rate);
  
  const bbUpper = parseNumeric(symbolData.bb_upper || symbolData.indicators?.bb?.upper);
  const bbLower = parseNumeric(symbolData.bb_lower || symbolData.indicators?.bb?.lower);
  
  // Calculate derived signals
  const emaTrend = getEmaTrend(price, ema20, ema50, ema200);
  const rsiZone = getRsiZone(rsi, config.rsi_oversold, config.rsi_overbought);
  const volumeRatio = getVolumeRatio(volume, avgVolume);
  const bbPosition = getBbPosition(price, bbUpper, bbLower);
  const atrPct = (price && atr) ? (atr / price) * 100 : null;
  
  // MACD values
  const macdHistogram = macd_4h;
  const macdTrend = getMacdTrend(macdHistogram);
  
  // Extract MACD line and signal line if available
  const macdLine = parseNumeric(
    symbolData.macd_line_4h 
    || symbolData.macd?.['4h']?.line
    || symbolData.indicators?.['4h']?.macd_line
  );
  const macdSignalLine = parseNumeric(
    symbolData.macd_signal_4h 
    || symbolData.macd?.['4h']?.signal
    || symbolData.indicators?.['4h']?.macd_signal
  );
  
  // Detect MACD cross using buffer-based detection
  const macdCross = detectMACDCross(symbol, '4h', macdLine, macdSignalLine);
  
  // Build signal summary
  const signals = {
    symbol,
    timestamp: new Date().toISOString(),
    timeframe: '4h', // Primary timeframe
    
    price,
    atr,
    atr_pct: atrPct,
    
    trend: {
      ema_cross: emaTrend.ema_cross,
      ema200_pos: emaTrend.ema200_pos,
      macd_histogram: macdHistogram,
      macd_cross: macdCross,
      macd_trend: macdTrend
    },
    
    momentum: {
      rsi,
      rsi_zone: rsiZone,
      volume_ratio: volumeRatio,
      macd_3m,
      macd_4h
    },
    
    volatility: {
      atr_pct: atrPct,
      bb_position: bbPosition,
      bb_upper: bbUpper,
      bb_lower: bbLower
    },
    
    derivatives: {
      funding_rate: fundingRate,
      oi_change_24h: oiChange,
      oi: oi
    },
    
    // Raw values for calculations
    raw: {
      ema20,
      ema50,
      ema200,
      volume,
      avgVolume
    }
  };
  
  // Calculate multi-timeframe alignment
  signals.multi_tf_alignment = countTfAlignment({
    macd_3m,
    macd_4h,
    ema_cross: emaTrend.ema_cross,
    rsi_zone: rsiZone
  });
  
  // Calculate composite score
  signals.composite_score = calculateCompositeScore(signals, signals.multi_tf_alignment);
  
  return signals;
}

/**
 * Condense full market data (multiple symbols)
 */
function condenseMarketData(marketData, config = {}) {
  if (!marketData || !Array.isArray(marketData.symbols)) {
    throw new Error('Invalid market data: expected { symbols: [...] }');
  }
  
  const condensed = {
    timestamp: new Date().toISOString(),
    symbols: []
  };
  
  for (const symbolData of marketData.symbols) {
    try {
      const signal = condenseSymbol(symbolData, config);
      condensed.symbols.push(signal);
    } catch (err) {
      console.error(`[SignalCondenser] Failed to condense ${symbolData.symbol}: ${err.message}`);
    }
  }
  
  return condensed;
}

module.exports = {
  condenseSymbol,
  condenseMarketData,
  
  // Export helpers for testing
  parseNumeric,
  getRsiZone,
  getEmaTrend,
  getMacdTrend,
  calculateCompositeScore
};
