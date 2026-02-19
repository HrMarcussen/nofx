/**
 * Pre-Processor: Extract & normalize market data for LLM consumption
 * 
 * Takes raw NoFx market data and produces a clean, compact summary
 * that the LLM can analyze without needing to parse complex structures.
 * 
 * Also extracts numeric values needed by the post-processor (ATR, MACD, prices).
 */

const fs = require('fs');
const path = require('path');

const STRATEGY_FILE = path.join(__dirname, 'nofx-strategy-hybrid-tiers.json');

/**
 * Load strategy configuration
 */
function loadStrategy() {
  const data = fs.readFileSync(STRATEGY_FILE, 'utf8');
  return JSON.parse(data);
}

/**
 * Determine if a symbol is BTC or ETH (vs altcoin)
 */
function isBtcEth(symbol) {
  const s = symbol.toUpperCase();
  return s.startsWith('BTC') || s.startsWith('ETH');
}

/**
 * Extract indicator values from NoFx market data for a single symbol.
 * NoFx sends indicators in various formats — this normalizes them.
 * 
 * Returns: { price, atr, rsi, macd3m, macd4h, ema20, ema50, volume, oi, fundingRate, ... }
 */
function extractIndicators(symbolData) {
  const result = {
    symbol: symbolData.symbol || symbolData.coin || 'UNKNOWN',
    price: null,
    atr: null,
    rsi: null,
    macd3m: null,
    macd4h: null,
    ema20: null,
    ema50: null,
    volume: null,
    oi: null,
    oiChange: null,
    fundingRate: null,
    rawKlines3m: null,
    rawKlines4h: null
  };

  // Price — try multiple locations
  result.price = symbolData.currentPrice 
    || symbolData.price 
    || symbolData.lastPrice
    || extractPriceFromKlines(symbolData);

  // ATR
  if (symbolData.atr !== undefined) {
    result.atr = parseNumeric(symbolData.atr);
  } else if (symbolData.indicators?.atr) {
    result.atr = parseNumeric(symbolData.indicators.atr);
  } else if (symbolData.atr_14) {
    result.atr = parseNumeric(symbolData.atr_14);
  }

  // RSI
  if (symbolData.rsi !== undefined) {
    result.rsi = parseNumeric(symbolData.rsi);
  } else if (symbolData.indicators?.rsi) {
    result.rsi = parseNumeric(symbolData.indicators.rsi);
  } else if (symbolData.rsi_14) {
    result.rsi = parseNumeric(symbolData.rsi_14);
  }

  // MACD — need both 3m and 4h
  if (symbolData.macd) {
    // Could be { '3m': value, '4h': value } or { macd_3m, macd_4h }
    if (typeof symbolData.macd === 'object') {
      result.macd3m = parseNumeric(symbolData.macd['3m'] ?? symbolData.macd.macd_3m ?? symbolData.macd.primary);
      result.macd4h = parseNumeric(symbolData.macd['4h'] ?? symbolData.macd.macd_4h ?? symbolData.macd.longer);
    } else {
      result.macd3m = parseNumeric(symbolData.macd);
    }
  }
  if (symbolData.macd_3m !== undefined) result.macd3m = parseNumeric(symbolData.macd_3m);
  if (symbolData.macd_4h !== undefined) result.macd4h = parseNumeric(symbolData.macd_4h);
  if (symbolData.indicators?.macd_3m !== undefined) result.macd3m = parseNumeric(symbolData.indicators.macd_3m);
  if (symbolData.indicators?.macd_4h !== undefined) result.macd4h = parseNumeric(symbolData.indicators.macd_4h);

  // Try to extract MACD from timeframe-keyed indicators
  if (symbolData.indicators) {
    if (symbolData.indicators['3m']?.macd !== undefined) {
      result.macd3m = parseNumeric(symbolData.indicators['3m'].macd);
    }
    if (symbolData.indicators['4h']?.macd !== undefined) {
      result.macd4h = parseNumeric(symbolData.indicators['4h'].macd);
    }
  }

  // EMA
  if (symbolData.ema) {
    if (typeof symbolData.ema === 'object') {
      result.ema20 = parseNumeric(symbolData.ema['20'] ?? symbolData.ema.ema20);
      result.ema50 = parseNumeric(symbolData.ema['50'] ?? symbolData.ema.ema50);
    }
  }
  if (symbolData.ema_20 !== undefined) result.ema20 = parseNumeric(symbolData.ema_20);
  if (symbolData.ema_50 !== undefined) result.ema50 = parseNumeric(symbolData.ema_50);
  if (symbolData.indicators?.ema_20 !== undefined) result.ema20 = parseNumeric(symbolData.indicators.ema_20);
  if (symbolData.indicators?.ema_50 !== undefined) result.ema50 = parseNumeric(symbolData.indicators.ema_50);

  // Volume
  result.volume = parseNumeric(symbolData.volume ?? symbolData.volume24h ?? symbolData.indicators?.volume);

  // Open Interest
  result.oi = parseNumeric(symbolData.oi ?? symbolData.openInterest ?? symbolData.indicators?.oi);
  result.oiChange = parseNumeric(symbolData.oiChange ?? symbolData.oi_change ?? symbolData.indicators?.oiChange);

  // Funding Rate
  result.fundingRate = parseNumeric(symbolData.fundingRate ?? symbolData.funding_rate ?? symbolData.indicators?.fundingRate);

  // Raw klines for context (keep compact)
  if (symbolData.klines) {
    result.rawKlines3m = symbolData.klines['3m'] || symbolData.klines.primary;
    result.rawKlines4h = symbolData.klines['4h'] || symbolData.klines.longer;
  }

  return result;
}

/**
 * Try to get current price from klines data
 */
function extractPriceFromKlines(data) {
  if (data.klines) {
    const tf = data.klines['3m'] || data.klines.primary;
    if (Array.isArray(tf) && tf.length > 0) {
      const last = tf[tf.length - 1];
      return parseNumeric(last.close ?? last[4]); // OHLCV format
    }
  }
  return null;
}

/**
 * Parse a value to a number, handling strings and edge cases
 */
function parseNumeric(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return isNaN(val) ? null : val;
  if (typeof val === 'string') {
    const cleaned = val.replace(/,/g, '').trim();
    const num = Number(cleaned);
    return isNaN(num) ? null : num;
  }
  return null;
}

/**
 * Calculate max position size for a symbol based on strategy and account info
 */
function calcMaxPositionSize(symbol, strategy, accountInfo) {
  const rc = strategy.config.risk_control;
  const btcEth = isBtcEth(symbol);
  const maxLeverage = btcEth ? rc.btc_eth_max_leverage : rc.altcoin_max_leverage;
  const maxValueRatio = btcEth ? rc.btc_eth_max_position_value_ratio : rc.altcoin_max_position_value_ratio;
  
  // Max position = equity × maxValueRatio (this is the notional limit)
  // But we also respect max_margin_usage
  const equity = accountInfo?.equity || accountInfo?.totalWalletBalance || accountInfo?.balance || 0;
  const availableMargin = equity * rc.max_margin_usage;
  
  // Position value limit based on ratio
  const positionValueLimit = equity * maxValueRatio;
  
  // The maxPositionSize is the margin-based limit (what you actually allocate)
  // For leverage trading: positionValue = margin × leverage
  // So max margin = positionValueLimit / leverage, but we cap at availableMargin
  const maxMargin = Math.min(positionValueLimit, availableMargin);
  
  return {
    maxPositionSize: maxMargin,
    maxLeverage,
    maxValueRatio,
    equity
  };
}

/**
 * Build a compact market summary string for the LLM.
 * Only includes what the LLM needs for analysis — no formulas, no rules.
 */
function buildMarketSummary(symbolsData, accountInfo, existingPositions) {
  const lines = [];
  
  // Account summary
  if (accountInfo) {
    const equity = accountInfo.equity || accountInfo.totalWalletBalance || accountInfo.balance || 0;
    const unrealizedPnl = accountInfo.unrealizedPnl || accountInfo.totalUnrealizedProfit || 0;
    lines.push(`ACCOUNT: Equity $${roundNum(equity)}, Unrealized PnL $${roundNum(unrealizedPnl)}`);
  }

  // Existing positions
  if (existingPositions && existingPositions.length > 0) {
    lines.push('');
    lines.push('OPEN POSITIONS:');
    for (const pos of existingPositions) {
      const side = pos.side || (pos.positionAmt > 0 ? 'LONG' : 'SHORT');
      const pnl = pos.unrealizedProfit || pos.pnl || 0;
      const entry = pos.entryPrice || pos.avgPrice || 0;
      lines.push(`  ${pos.symbol}: ${side} @ ${entry}, PnL $${roundNum(pnl)}, Size $${roundNum(Math.abs(pos.notional || pos.positionValue || 0))}`);
    }
  }

  lines.push('');
  lines.push('MARKET DATA:');

  for (const sd of symbolsData) {
    const ind = extractIndicators(sd);
    lines.push('');
    lines.push(`${ind.symbol}:`);
    if (ind.price !== null) lines.push(`  Price: ${ind.price}`);
    if (ind.rsi !== null) lines.push(`  RSI(14): ${roundNum(ind.rsi, 1)}`);
    if (ind.macd3m !== null) lines.push(`  MACD 3m: ${roundNum(ind.macd3m, 4)}`);
    if (ind.macd4h !== null) lines.push(`  MACD 4h: ${roundNum(ind.macd4h, 4)}`);
    if (ind.atr !== null) lines.push(`  ATR(14): ${roundNum(ind.atr, 4)}`);
    if (ind.ema20 !== null) lines.push(`  EMA20: ${roundNum(ind.ema20)}, EMA50: ${roundNum(ind.ema50)}`);
    if (ind.volume !== null) lines.push(`  Volume: ${roundNum(ind.volume)}`);
    if (ind.oi !== null) lines.push(`  OI: ${roundNum(ind.oi)}${ind.oiChange !== null ? ` (${ind.oiChange > 0 ? '+' : ''}${roundNum(ind.oiChange, 2)}%)` : ''}`);
    if (ind.fundingRate !== null) lines.push(`  Funding: ${roundNum(ind.fundingRate, 6)}`);
  }

  return lines.join('\n');
}

/**
 * Round a number for display (no thousand separators)
 */
function roundNum(val, decimals = 2) {
  if (val === null || val === undefined) return 'N/A';
  return Number(val.toFixed(decimals));
}

/**
 * Pre-process a NoFx request into:
 * 1. A compact market summary for the LLM
 * 2. Extracted numeric data for the post-processor
 */
function preProcess(requestBody) {
  const strategy = loadStrategy();
  
  // Parse the userPrompt — NoFx sends it as a JSON string
  let marketData;
  try {
    marketData = typeof requestBody.userPrompt === 'string' 
      ? JSON.parse(requestBody.userPrompt) 
      : requestBody.userPrompt;
  } catch (e) {
    // If it's not JSON, treat the whole userPrompt as-is (legacy format)
    return {
      strategy,
      llmPrompt: requestBody.userPrompt,
      symbolIndicators: {},
      accountInfo: null,
      existingPositions: [],
      isLegacyFormat: true
    };
  }

  // Extract parts from NoFx data structure
  const accountInfo = marketData.accountInfo || marketData.account || null;
  const existingPositions = marketData.positions || marketData.existingPositions || [];
  const symbols = marketData.symbols || marketData.coins || marketData.market || [];

  // Extract indicators per symbol for post-processor
  const symbolIndicators = {};
  for (const sd of symbols) {
    const ind = extractIndicators(sd);
    const posInfo = calcMaxPositionSize(ind.symbol, strategy, accountInfo);
    symbolIndicators[ind.symbol] = {
      ...ind,
      ...posInfo
    };
  }

  // Build compact market summary for LLM
  const marketSummary = buildMarketSummary(symbols, accountInfo, existingPositions);

  return {
    strategy,
    llmPrompt: marketSummary,
    symbolIndicators,
    accountInfo,
    existingPositions,
    isLegacyFormat: false
  };
}

module.exports = {
  preProcess,
  extractIndicators,
  calcMaxPositionSize,
  loadStrategy,
  isBtcEth,
  parseNumeric,
  roundNum
};
