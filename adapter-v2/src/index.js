#!/usr/bin/env node
/**
 * Trading Adapter V2 - Rule Engine MVP
 * 
 * Architecture: NoFx → Adapter (Rule Engine) → 90% autonomous → 10% LLM escalation
 * 
 * Flow:
 * 1. Receive market data from NoFx
 * 2. Condense signals (signal-condenser)
 * 3. Evaluate rules (rule-engine)
 * 4. Check escalation triggers (escalation)
 * 5. If escalate → call LLM, else proceed
 * 6. Calculate position (position-sizer)
 * 7. Execute trade (executor stub)
 * 8. Return decision
 * 
 * Environment Variables:
 *   PORT - Server port (default: 8888)
 *   API_TOKEN - API token for authentication
 *   CAPITAL - Total trading capital in USD (default: 10000)
 */

const http = require('http');
const { condenseMarketData } = require('./signal-condenser');
const { evaluateSignal } = require('./rule-engine');
const { calculatePosition } = require('./position-sizer');
const { shouldEscalate, buildEscalationPrompt } = require('./escalation');
const { executeTrade, getPerformanceStats } = require('./executor');
const { getConfig, startAutoReload } = require('./config');
const { handleEscalation, getEscalationStats } = require('./escalation-handler');
const { executeDailyRiskAssessment } = require('./risk-assessment');
const { getIndicatorStats } = require('./indicators');

// Configuration
const PORT = process.env.PORT || 8888;
const API_TOKEN = process.env.API_TOKEN || 'dev-token-change-me';
const CAPITAL = parseFloat(process.env.CAPITAL || '10000');

/**
 * Log with timestamp
 */
function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}`);
  if (data) {
    console.log(JSON.stringify(data, null, 2));
  }
}

/**
 * Handle health check
 */
function handleHealth(req, res) {
  const config = getConfig();
  const stats = getPerformanceStats();
  const escalationStats = getEscalationStats();
  const indicatorStats = getIndicatorStats();
  
  const health = {
    status: 'healthy',
    version: '2.0.0-fase2',
    mode: 'rule-engine-llm-escalation',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    config: {
      risk_multiplier: config.riskManagement.risk_multiplier,
      leverage: config.riskManagement.max_leverage,
      risk_per_trade: config.riskManagement.risk_per_trade,
      last_updated: config.meta.last_updated,
      updated_by: config.meta.updated_by
    },
    stats,
    escalationStats,
    indicatorBuffers: indicatorStats.totalBuffers
  };
  
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(health, null, 2));
  log('info', 'Health check', health);
}

/**
 * Handle config get (for monitoring)
 */
function handleConfigGet(req, res) {
  try {
    const config = getConfig();
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      config,
      timestamp: new Date().toISOString()
    }, null, 2));
    
    log('info', 'Config retrieved');
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: err.message
    }));
    log('error', 'Config get failed', { error: err.message });
  }
}

/**
 * Handle config update (for LLM)
 */
async function handleConfigUpdate(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk.toString(); });
  req.on('end', async () => {
    try {
      const updates = JSON.parse(body);
      
      const { updateConfig } = require('./config');
      const newConfig = updateConfig(updates);
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        message: 'Config updated successfully',
        config: newConfig,
        timestamp: new Date().toISOString()
      }, null, 2));
      
      log('info', 'Config updated', updates);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: err.message
      }));
      log('error', 'Config update failed', { error: err.message });
    }
  });
}

/**
 * Handle risk assessment endpoint
 */
async function handleRiskAssessment(req, res) {
  try {
    log('info', 'Risk assessment requested');
    
    const result = await executeDailyRiskAssessment();
    
    res.writeHead(result.success ? 200 : 500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result, null, 2));
    
    log('info', 'Risk assessment completed', { 
      success: result.success, 
      processingTimeMs: result.processingTimeMs 
    });
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: false,
      error: err.message,
      timestamp: new Date().toISOString()
    }));
    log('error', 'Risk assessment failed', { error: err.message });
  }
}

/**
 * Handle trading decision request
 */
async function handleTradingDecision(req, res) {
  const startTime = Date.now();
  
  let body = '';
  req.on('data', chunk => { body += chunk.toString(); });
  req.on('end', async () => {
    try {
      const request = JSON.parse(body);
      const { marketData, existingPositions, metadata } = request;
      
      log('info', 'Trading decision requested', {
        requestId: metadata?.requestId,
        symbolCount: marketData?.symbols?.length
      });
      
      // Load config
      const config = getConfig();
      
      // 1. Condense signals
      const condensed = condenseMarketData(marketData, config.ruleEngine);
      log('debug', `Condensed ${condensed.symbols.length} symbols`);
      
      // 2. Evaluate each symbol
      const decisions = [];
      
      for (const signal of condensed.symbols) {
        try {
          // Find existing position for this symbol
          const existingPos = existingPositions?.find(p => p.symbol === signal.symbol);
          
          // Evaluate rule engine
          const ruleDecision = evaluateSignal(signal, existingPos);
          
          // Check if we should escalate
          const escalation = shouldEscalate(signal, ruleDecision);
          
          // If escalate, call LLM via escalation-handler
          if (escalation.shouldEscalate) {
            log('warn', `⚠️  Escalation triggered for ${signal.symbol}`, {
              triggers: escalation.triggers.map(t => t.type),
              recommendation: escalation.recommendation
            });
            
            try {
              // Call LLM escalation handler
              const llmDecision = await handleEscalation(escalation);
              
              // Use LLM decision instead of rule decision
              ruleDecision.action = llmDecision.action;
              ruleDecision.confidence = llmDecision.confidence;
              ruleDecision.reasoning = llmDecision.reasoning;
              ruleDecision.tier = llmDecision.tier || ruleDecision.tier;
              
              log('info', `✅ LLM escalation resolved: ${llmDecision.action}`, {
                symbol: signal.symbol,
                confidence: llmDecision.confidence
              });
              
            } catch (err) {
              // Escalation failed - default to WAIT (safety first!)
              log('error', `❌ Escalation handler failed for ${signal.symbol}`, { error: err.message });
              
              decisions.push({
                symbol: signal.symbol,
                action: 'wait',
                confidence: 0,
                reasoning: `Escalation handler failed: ${err.message}. Defaulting to WAIT.`,
                escalated: true,
                escalationFailed: true,
                error: err.message
              });
              continue;
            }
          }
          
          // If force wait (risk_multiplier = 0.0)
          if (escalation.forceWait) {
            log('warn', `🛑 Force WAIT for ${signal.symbol} (risk_multiplier = 0.0)`);
            decisions.push({
              symbol: signal.symbol,
              action: 'wait',
              confidence: 0,
              reasoning: 'Risk multiplier = 0.0 (trading halted by LLM risk assessment)',
              forceWait: true
            });
            continue;
          }
          
          // 3. If action is to open position, calculate position parameters
          let position = null;
          if (ruleDecision.action === 'open_long' || ruleDecision.action === 'open_short') {
            const direction = ruleDecision.action === 'open_long' ? 'long' : 'short';
            
            position = calculatePosition({
              capital: CAPITAL,
              entryPrice: signal.price,
              atr: signal.atr,
              direction,
              tier: ruleDecision.tier,
              config
            });
            
            // Check fee efficiency
            if (!position.feeCheck.isEfficient) {
              log('warn', `⚠️  Fee-inefficient trade for ${signal.symbol}`, position.feeCheck);
              decisions.push({
                symbol: signal.symbol,
                action: 'wait',
                confidence: ruleDecision.confidence,
                reasoning: `Trade rejected: Fee-inefficient. Expected profit $${position.feeCheck.expectedProfit} < 2x fees $${position.feeCheck.totalFees * 2}`,
                feeCheck: position.feeCheck
              });
              continue;
            }
            
            // Execute trade (stub in Phase 1)
            const execution = await executeTrade(ruleDecision, signal, position);
            
            decisions.push({
              symbol: signal.symbol,
              action: ruleDecision.action,
              leverage: position.leverage,
              positionSizeUsd: position.positionSize,
              stopLoss: position.stopLoss,
              takeProfit: position.takeProfit,
              confidence: ruleDecision.confidence,
              reasoning: ruleDecision.reasoning,
              tier: ruleDecision.tier,
              riskReward: position.riskReward,
              execution
            });
          } else {
            // WAIT, HOLD, or CLOSE actions
            if (ruleDecision.action.startsWith('close_')) {
              const execution = await executeTrade(ruleDecision, signal, null);
              decisions.push({
                symbol: signal.symbol,
                action: ruleDecision.action,
                confidence: ruleDecision.confidence,
                reasoning: ruleDecision.reasoning,
                execution
              });
            } else {
              decisions.push({
                symbol: signal.symbol,
                action: ruleDecision.action,
                confidence: ruleDecision.confidence,
                reasoning: ruleDecision.reasoning
              });
            }
          }
        } catch (err) {
          log('error', `Failed to evaluate ${signal.symbol}`, { error: err.message, stack: err.stack });
          decisions.push({
            symbol: signal.symbol,
            action: 'wait',
            confidence: 0,
            reasoning: `Error: ${err.message}`,
            error: true
          });
        }
      }
      
      const processingTime = Date.now() - startTime;
      
      // Build response
      const response = {
        decisions,
        timestamp: new Date().toISOString(),
        processingTimeMs: processingTime,
        mode: 'rule-engine',
        version: '2.0.0-alpha',
        config: {
          risk_multiplier: config.riskManagement.risk_multiplier
        }
      };
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response, null, 2));
      
      log('info', 'Trading decision completed', {
        requestId: metadata?.requestId,
        decisionsCount: decisions.length,
        processingTimeMs: processingTime
      });
      
    } catch (err) {
      const processingTime = Date.now() - startTime;
      
      log('error', 'Request processing failed', {
        error: err.message,
        stack: err.stack,
        processingTimeMs: processingTime
      });
      
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: err.message,
        timestamp: new Date().toISOString(),
        processingTimeMs: processingTime
      }));
    }
  });
}

/**
 * HTTP request handler
 */
async function handleRequest(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Handle OPTIONS
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  // Health check
  if (req.method === 'GET' && req.url === '/api/v1/trading/health') {
    handleHealth(req, res);
    return;
  }
  
  // Config get endpoint
  if (req.method === 'GET' && req.url === '/api/v1/config') {
    handleConfigGet(req, res);
    return;
  }
  
  // Config update endpoint (for LLM)
  if (req.method === 'POST' && req.url === '/api/v1/config/update') {
    // Check auth
    const authHeader = req.headers.authorization;
    const token = authHeader ? authHeader.replace('Bearer ', '').trim() : '';
    
    if (token !== API_TOKEN) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
    
    handleConfigUpdate(req, res);
    return;
  }
  
  // Risk assessment endpoint
  if (req.method === 'POST' && req.url === '/api/v1/risk/assess') {
    // Check auth
    const authHeader = req.headers.authorization;
    const token = authHeader ? authHeader.replace('Bearer ', '').trim() : '';
    
    if (token !== API_TOKEN) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
    
    handleRiskAssessment(req, res);
    return;
  }
  
  // Trading decision endpoint
  if (req.method === 'POST' && req.url === '/api/v1/trading/decision') {
    // Check auth
    const authHeader = req.headers.authorization;
    const token = authHeader ? authHeader.replace('Bearer ', '').trim() : '';
    
    if (token !== API_TOKEN) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      log('warn', 'Unauthorized request', { ip: req.socket.remoteAddress });
      return;
    }
    
    handleTradingDecision(req, res);
    return;
  }
  
  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
}

// Start server
const server = http.createServer(handleRequest);

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('='.repeat(70));
  console.log('  Trading Adapter V2 - Rule Engine MVP');
  console.log('='.repeat(70));
  console.log('');
  console.log(`  Listening on:       http://0.0.0.0:${PORT}`);
  console.log(`  Health check:       http://localhost:${PORT}/api/v1/trading/health`);
  console.log(`  Trading API:        http://localhost:${PORT}/api/v1/trading/decision`);
  console.log(`  Config get:         http://localhost:${PORT}/api/v1/config`);
  console.log(`  Config update:      http://localhost:${PORT}/api/v1/config/update`);
  console.log(`  Risk assessment:    http://localhost:${PORT}/api/v1/risk/assess`);
  console.log('');
  console.log(`  Capital:         $${CAPITAL}`);
  console.log('');
  
  // Load and display config
  const config = getConfig();
  console.log('  Current Config:');
  console.log(`    Risk multiplier:  ${config.riskManagement.risk_multiplier}`);
  console.log(`    Leverage:         ${config.riskManagement.max_leverage}x`);
  console.log(`    Risk per trade:   ${config.riskManagement.risk_per_trade * 100}%`);
  console.log('');
  console.log('  Press Ctrl+C to stop');
  console.log('');
  console.log('='.repeat(70));
  console.log('');
  
  // Start config auto-reload
  startAutoReload();
  
  log('info', 'Adapter V2 started', {
    port: PORT,
    capital: CAPITAL,
    pid: process.pid
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  log('info', 'Received SIGTERM, shutting down');
  const { stopAutoReload } = require('./config');
  stopAutoReload();
  server.close(() => {
    log('info', 'Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\n');
  log('info', 'Received SIGINT, shutting down');
  const { stopAutoReload } = require('./config');
  stopAutoReload();
  server.close(() => {
    log('info', 'Server closed');
    process.exit(0);
  });
});

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  log('error', 'Uncaught exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  log('error', 'Unhandled rejection', { reason });
  process.exit(1);
});
