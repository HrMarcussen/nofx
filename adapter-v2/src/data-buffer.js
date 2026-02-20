#!/usr/bin/env node
/**
 * Historical Data Buffer
 * 
 * Ring buffer per symbol/timeframe for historical indicator values.
 * Used by MACD cross detection and future indicators.
 * 
 * Features:
 * - In-memory storage (reset on restart is OK for now)
 * - Auto-cleanup of old data
 * - Max 50 periods per symbol/timeframe
 * - O(1) push, O(1) get
 */

class DataBuffer {
  constructor(maxSize = 50) {
    this.maxSize = maxSize;
    this.buffers = new Map(); // key: "SYMBOL:TIMEFRAME"
    this.timestamps = new Map(); // Last update timestamp
  }

  /**
   * Get buffer key
   */
  _getKey(symbol, timeframe) {
    return `${symbol}:${timeframe}`;
  }

  /**
   * Initialize buffer if not exists
   */
  _ensureBuffer(symbol, timeframe) {
    const key = this._getKey(symbol, timeframe);
    if (!this.buffers.has(key)) {
      this.buffers.set(key, []);
      this.timestamps.set(key, null);
    }
  }

  /**
   * Push new data to buffer
   * 
   * @param {string} symbol - Trading symbol (e.g., "BTCUSDT")
   * @param {string} timeframe - Timeframe (e.g., "4h", "3m")
   * @param {object} data - Data to store (should include timestamp)
   * @returns {number} New buffer size
   */
  push(symbol, timeframe, data) {
    this._ensureBuffer(symbol, timeframe);
    
    const key = this._getKey(symbol, timeframe);
    const buffer = this.buffers.get(key);
    
    // Add timestamp if not present
    if (!data.timestamp) {
      data.timestamp = new Date().toISOString();
    }
    
    // Push to buffer
    buffer.push(data);
    
    // Trim if exceeds max size
    if (buffer.length > this.maxSize) {
      buffer.shift(); // Remove oldest
    }
    
    // Update last access timestamp
    this.timestamps.set(key, Date.now());
    
    return buffer.length;
  }

  /**
   * Get last N periods from buffer
   * 
   * @param {string} symbol - Trading symbol
   * @param {string} timeframe - Timeframe
   * @param {number} periods - Number of periods to retrieve (default: all)
   * @returns {array} Array of data points (oldest first)
   */
  get(symbol, timeframe, periods = null) {
    const key = this._getKey(symbol, timeframe);
    const buffer = this.buffers.get(key);
    
    if (!buffer || buffer.length === 0) {
      return [];
    }
    
    // Update last access timestamp
    this.timestamps.set(key, Date.now());
    
    if (periods === null) {
      return [...buffer]; // Return all
    }
    
    // Return last N periods
    return buffer.slice(-periods);
  }

  /**
   * Get the latest (most recent) data point
   * 
   * @param {string} symbol - Trading symbol
   * @param {string} timeframe - Timeframe
   * @returns {object|null} Latest data point or null
   */
  getLast(symbol, timeframe) {
    const buffer = this.get(symbol, timeframe);
    return buffer.length > 0 ? buffer[buffer.length - 1] : null;
  }

  /**
   * Get buffer size
   * 
   * @param {string} symbol - Trading symbol
   * @param {string} timeframe - Timeframe
   * @returns {number} Buffer size
   */
  size(symbol, timeframe) {
    const key = this._getKey(symbol, timeframe);
    const buffer = this.buffers.get(key);
    return buffer ? buffer.length : 0;
  }

  /**
   * Clear buffer for specific symbol/timeframe
   * 
   * @param {string} symbol - Trading symbol
   * @param {string} timeframe - Timeframe
   */
  clear(symbol, timeframe) {
    const key = this._getKey(symbol, timeframe);
    this.buffers.delete(key);
    this.timestamps.delete(key);
  }

  /**
   * Clear all buffers
   */
  clearAll() {
    this.buffers.clear();
    this.timestamps.clear();
  }

  /**
   * Auto-cleanup: Remove buffers not accessed in X milliseconds
   * 
   * @param {number} maxAgeMs - Max age in milliseconds (default: 24 hours)
   * @returns {number} Number of buffers removed
   */
  cleanup(maxAgeMs = 24 * 60 * 60 * 1000) {
    const now = Date.now();
    let removed = 0;
    
    for (const [key, lastAccess] of this.timestamps.entries()) {
      if (lastAccess && (now - lastAccess) > maxAgeMs) {
        this.buffers.delete(key);
        this.timestamps.delete(key);
        removed++;
      }
    }
    
    return removed;
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      totalBuffers: this.buffers.size,
      maxSize: this.maxSize,
      bufferSizes: Array.from(this.buffers.entries()).map(([key, buffer]) => ({
        key,
        size: buffer.length,
        lastAccess: this.timestamps.get(key)
      }))
    };
  }

  /**
   * Check if buffer has enough data
   * 
   * @param {string} symbol - Trading symbol
   * @param {string} timeframe - Timeframe
   * @param {number} minPeriods - Minimum required periods
   * @returns {boolean} True if buffer has enough data
   */
  hasEnoughData(symbol, timeframe, minPeriods) {
    return this.size(symbol, timeframe) >= minPeriods;
  }
}

// Singleton instance
let globalBuffer = null;

/**
 * Get global buffer instance
 */
function getGlobalBuffer() {
  if (!globalBuffer) {
    globalBuffer = new DataBuffer(50);
  }
  return globalBuffer;
}

module.exports = {
  DataBuffer,
  getGlobalBuffer
};
