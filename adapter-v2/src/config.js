#!/usr/bin/env node
/**
 * Config Management Module
 * 
 * Provides hot-reloadable configuration for trading parameters.
 * LLM can update config file and changes take effect immediately.
 * 
 * Features:
 * - File-based config (JSON)
 * - Hot reload (no restart needed)
 * - Parameter validation
 * - Bounded ranges for safety
 */

const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '..', 'config', 'default-params.json');
const RELOAD_INTERVAL_MS = 5000; // Check for changes every 5 seconds

let cachedConfig = null;
let lastModified = null;
let fileWatchTimer = null;

/**
 * Load config from file
 */
function loadConfigFromFile() {
  try {
    const data = fs.readFileSync(CONFIG_FILE, 'utf8');
    const config = JSON.parse(data);
    validateConfig(config);
    return config;
  } catch (err) {
    throw new Error(`Failed to load config: ${err.message}`);
  }
}

/**
 * Validate config structure and ranges
 */
function validateConfig(config) {
  // Risk management validation
  if (!config.riskManagement) throw new Error('Missing riskManagement section');
  
  const rm = config.riskManagement;
  if (rm.risk_per_trade !== 0.02) {
    throw new Error('risk_per_trade MUST be 0.02 (HARD LIMIT)');
  }
  if (rm.max_leverage !== 5) {
    throw new Error('max_leverage MUST be 5 (HARD LIMIT)');
  }
  
  // risk_multiplier is dynamic but bounded
  if (rm.risk_multiplier < 0.0 || rm.risk_multiplier > 1.5) {
    throw new Error(`risk_multiplier ${rm.risk_multiplier} out of bounds [0.0, 1.5]`);
  }
  
  // Rule engine validation
  if (!config.ruleEngine) throw new Error('Missing ruleEngine section');
  
  const re = config.ruleEngine;
  if (re.rsi_oversold < 20 || re.rsi_oversold > 40) {
    throw new Error(`rsi_oversold ${re.rsi_oversold} out of bounds [20, 40]`);
  }
  if (re.rsi_overbought < 60 || re.rsi_overbought > 80) {
    throw new Error(`rsi_overbought ${re.rsi_overbought} out of bounds [60, 80]`);
  }
  
  // Position sizing validation
  if (!config.positionSizing) throw new Error('Missing positionSizing section');
  
  // Stop loss validation
  if (!config.stopLoss) throw new Error('Missing stopLoss section');
  
  // Escalation validation
  if (!config.escalation) throw new Error('Missing escalation section');
}

/**
 * Get current config (with hot reload)
 */
function getConfig() {
  try {
    const stats = fs.statSync(CONFIG_FILE);
    const currentModified = stats.mtimeMs;
    
    // If file changed or not loaded yet, reload
    if (!cachedConfig || currentModified !== lastModified) {
      console.log(`[Config] ${cachedConfig ? 'Reloading' : 'Loading'} config from ${CONFIG_FILE}`);
      cachedConfig = loadConfigFromFile();
      lastModified = currentModified;
      console.log('[Config] ✅ Config loaded successfully');
      console.log(`[Config] risk_multiplier = ${cachedConfig.riskManagement.risk_multiplier}`);
    }
    
    return cachedConfig;
  } catch (err) {
    console.error(`[Config] ❌ Failed to load config: ${err.message}`);
    
    // If we have cached config, use it as fallback
    if (cachedConfig) {
      console.log('[Config] ⚠️  Using cached config as fallback');
      return cachedConfig;
    }
    
    throw err;
  }
}

/**
 * Update config file (for LLM to call)
 */
function updateConfig(updates) {
  const config = getConfig();
  
  // Apply updates
  if (updates.risk_multiplier !== undefined) {
    if (updates.risk_multiplier < 0.0 || updates.risk_multiplier > 1.5) {
      throw new Error(`risk_multiplier ${updates.risk_multiplier} out of bounds [0.0, 1.5]`);
    }
    config.riskManagement.risk_multiplier = updates.risk_multiplier;
  }
  
  if (updates.rsi_oversold !== undefined) {
    if (updates.rsi_oversold < 20 || updates.rsi_oversold > 40) {
      throw new Error(`rsi_oversold ${updates.rsi_oversold} out of bounds [20, 40]`);
    }
    config.ruleEngine.rsi_oversold = updates.rsi_oversold;
  }
  
  if (updates.rsi_overbought !== undefined) {
    if (updates.rsi_overbought < 60 || updates.rsi_overbought > 80) {
      throw new Error(`rsi_overbought ${updates.rsi_overbought} out of bounds [60, 80]`);
    }
    config.ruleEngine.rsi_overbought = updates.rsi_overbought;
  }
  
  if (updates.min_tf_alignment !== undefined) {
    if (updates.min_tf_alignment < 2 || updates.min_tf_alignment > 4) {
      throw new Error(`min_tf_alignment ${updates.min_tf_alignment} out of bounds [2, 4]`);
    }
    config.ruleEngine.min_tf_alignment = updates.min_tf_alignment;
  }
  
  // Update metadata
  config.meta.last_updated = new Date().toISOString();
  config.meta.updated_by = updates.updated_by || 'llm';
  config.meta.notes = updates.notes || 'Parameter adjustment';
  
  // Validate before saving
  validateConfig(config);
  
  // Save to file
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  console.log('[Config] ✅ Config updated and saved');
  
  // Force reload on next getConfig()
  lastModified = null;
  
  return config;
}

/**
 * Start auto-reload watcher (optional)
 */
function startAutoReload() {
  if (fileWatchTimer) return; // Already watching
  
  fileWatchTimer = setInterval(() => {
    try {
      getConfig(); // Will reload if file changed
    } catch (err) {
      console.error(`[Config] Auto-reload failed: ${err.message}`);
    }
  }, RELOAD_INTERVAL_MS);
  
  console.log(`[Config] Auto-reload started (check every ${RELOAD_INTERVAL_MS}ms)`);
}

/**
 * Stop auto-reload watcher
 */
function stopAutoReload() {
  if (fileWatchTimer) {
    clearInterval(fileWatchTimer);
    fileWatchTimer = null;
    console.log('[Config] Auto-reload stopped');
  }
}

module.exports = {
  getConfig,
  updateConfig,
  startAutoReload,
  stopAutoReload
};
