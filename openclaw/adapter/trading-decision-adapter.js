#!/usr/bin/env node
/**
 * OpenClaw Trading Decision Adapter
 * 
 * A lightweight HTTP server that bridges NoFx trading bot with OpenClaw/Leeloo.
 * Provides the /api/v1/trading/decision endpoint for NoFx to request trading decisions.
 * 
 * Architecture:
 *   NoFx → HTTP POST → This Adapter → OpenClaw CLI → Leeloo → Decision → Adapter → NoFx
 * 
 * Usage:
 *   node trading-decision-adapter.js
 *   # Or make executable and run: ./trading-decision-adapter.js
 * 
 * Environment Variables:
 *   PORT - Server port (default: 8888)
 *   OPENCLAW_TRADING_API_TOKEN - API token for authentication
 *   OPENCLAW_CLI_PATH - Path to openclaw CLI (default: openclaw in PATH)
 *   TRADING_SESSION - Session name (default: agent:opus:trading-main)
 * 
 * Author: Leeloo (OpenClaw Subagent)
 * Date: 2026-02-15
 */

const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const PORT = process.env.PORT || 8888;
const API_TOKEN = process.env.OPENCLAW_TRADING_API_TOKEN || 'development-token-change-me';
const OPENCLAW_CLI = process.env.OPENCLAW_CLI_PATH || 'openclaw';
const TRADING_SESSION = process.env.TRADING_SESSION || 'agent:opus:trading-main';
const WORKSPACE = process.env.TRADING_WORKSPACE || path.join(process.env.HOME, '.openclaw', 'workspace-opus', 'trading');
const TIMEOUT_MS = 120000; // 120 seconds

// Logging
const LOG_FILE = path.join(WORKSPACE, 'memory', `adapter-${new Date().toISOString().split('T')[0]}.log`);

function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    message,
    ...(data && { data })
  };
  
  const logLine = JSON.stringify(logEntry) + '\n';
  
  // Console output
  console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}`);
  if (data) {
    console.log(JSON.stringify(data, null, 2));
  }
  
  // File logging
  try {
    fs.appendFileSync(LOG_FILE, logLine);
  } catch (err) {
    console.error('Failed to write to log file:', err.message);
  }
}

// Build trading prompt for Leeloo
function buildTradingPrompt(systemPrompt, userPrompt) {
  return `You are Leeloo, the AI trading engine for NoFx AI Trading OS.

Your task is to analyze market data and provide trading decisions.

**Trading Strategy:**
${systemPrompt}

**Market Context:**
${userPrompt}

**🚨 CRITICAL FORMATTING RULES:**

1. **NO THOUSAND SEPARATORS IN NUMBERS!**
   - ✅ CORRECT: Price 68169, Stop 67800, Size 3500
   - ❌ WRONG: Price 68,169, Stop 67,800, Size 3,500
   - This applies to BOTH reasoning text AND JSON!
   - Commas in numbers break JSON parsing!

2. **Required Fields for open_long/open_short:**
   - leverage (integer 1-10)
   - positionSizeUsd (number, no commas)
   - stopLoss (price level, no commas)
   - takeProfit (price level, no commas)
   - confidence (0-100)
   - reasoning (string)

3. **Calculate from Strategy Parameters:**
   Parse userPrompt JSON and use strategy values:
   - stopLoss = entryPrice ± (ATR × strategy.riskMultiplier)
   - stopDistance = |entryPrice - stopLoss|
   - takeProfit = entryPrice + (stopDistance × strategy.riskRewardRatio)
   - **positionSizeUsd = (confidence / 100) × strategy.maxPositionSize** ⚠️ USE EXACT CONFIDENCE!
   - leverage = strategy.btcEthMaxLeverage or strategy.altcoinMaxLeverage

   **Position Size Examples:**
   - Confidence 82, maxPositionSize 5000 → (82/100) × 5000 = 4100
   - Confidence 75, maxPositionSize 5000 → (75/100) × 5000 = 3750
   - DO NOT use "90% for high confidence" or other arbitrary values!

**Response Format:**

<reasoning>
Your analysis (use numbers WITHOUT commas!):
1. Account Status Analysis
2. Existing Positions Review  
3. New Opportunities Analysis
4. Risk Assessment
5. Final Decisions with calculations shown
</reasoning>

<decision>
[
  {
    "symbol": "BTCUSDT",
    "action": "open_long",
    "leverage": 5,
    "positionSizeUsd": 3500,
    "stopLoss": 67800,
    "takeProfit": 70500,
    "confidence": 82,
    "reasoning": "Multi-timeframe bullish, OI +6.5%, RSI 62, R/R 6.3:1"
  },
  {
    "symbol": "ETHUSDT",
    "action": "hold",
    "confidence": 80,
    "reasoning": "Profitable +2.2%, let it run"
  }
]
</decision>

**Valid Actions:**
- "open_long" / "open_short" - Enter position (MUST include leverage, positionSizeUsd, stopLoss, takeProfit)
- "close_long" / "close_short" - Exit position
- "hold" - Keep existing position
- "wait" - No action for this symbol

Provide your analysis and decisions now. Remember: NO COMMAS IN NUMBERS!`;
}

// Helper: Strip thousand separators from numbers in text
function stripThousandSeparators(text) {
  // Replace patterns like "68,169" with "68169" but preserve quoted strings
  // This is a safe replacement for display text (reasoning)
  return text.replace(/\b(\d{1,3})(,\d{3})+\b/g, (match) => {
    return match.replace(/,/g, '');
  });
}

// Parse Leeloo's response
function parseLeelooResponse(rawResponse) {
  // Extract reasoning
  const reasoningMatch = rawResponse.match(/<reasoning>(.*?)<\/reasoning>/s);
  let cotTrace = reasoningMatch ? reasoningMatch[1].trim() : '';
  
  // Strip thousand separators from reasoning text (for display safety)
  cotTrace = stripThousandSeparators(cotTrace);
  
  // Extract decision JSON
  const decisionMatch = rawResponse.match(/<decision>(.*?)<\/decision>/s);
  if (!decisionMatch) {
    throw new Error('No <decision> tag found in Leeloo response');
  }
  
  let decisionJSON = decisionMatch[1].trim();
  
  // Parse JSON
  let decisions;
  try {
    decisions = JSON.parse(decisionJSON);
  } catch (err) {
    // Try to clean JSON (remove code fences if present)
    const cleaned = decisionJSON
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    
    try {
      decisions = JSON.parse(cleaned);
    } catch (err2) {
      // If still failing, check for thousand separators in JSON
      const hasSeparators = /\b\d{1,3}(,\d{3})+\b/.test(cleaned);
      if (hasSeparators) {
        throw new Error('JSON parsing failed: Found thousand separator commas in numbers (e.g., 68,169). Numbers must not contain commas!');
      }
      throw new Error(`JSON parsing failed: ${err2.message}`);
    }
  }
  
  // 🔍 LOG EXACT JSON RESPONSE BEFORE VALIDATION
  log('debug', '🔍 RAW DECISION JSON (before validation)', { 
    decisionsCount: decisions.length,
    decisionsJSON: JSON.stringify(decisions, null, 2)
  });
  
  // Validate decisions
  validateDecisions(decisions);
  
  return { decisions, cotTrace };
}

// Validate decision structure
function validateDecisions(decisions) {
  if (!Array.isArray(decisions)) {
    throw new Error('Decisions must be an array');
  }
  
  const validActions = ['open_long', 'open_short', 'close_long', 'close_short', 'hold', 'wait'];
  
  decisions.forEach((d, i) => {
    // Required fields for all actions
    if (!d.symbol) throw new Error(`Decision ${i}: missing symbol`);
    if (!d.action) throw new Error(`Decision ${i}: missing action`);
    if (!validActions.includes(d.action)) {
      throw new Error(`Decision ${i}: invalid action "${d.action}" (must be one of: ${validActions.join(', ')})`);
    }
    if (d.confidence === undefined || d.confidence === null) {
      throw new Error(`Decision ${i} (${d.symbol}): missing confidence`);
    }
    if (!d.reasoning) throw new Error(`Decision ${i} (${d.symbol}): missing reasoning`);
    
    // Validate confidence type and range
    if (typeof d.confidence !== 'number' || d.confidence < 0 || d.confidence > 100) {
      throw new Error(`Decision ${i} (${d.symbol}): invalid confidence ${d.confidence} (must be number 0-100)`);
    }
    
    // Require additional fields for new positions
    if (d.action.startsWith('open_')) {
      if (d.leverage === undefined || d.leverage === null) {
        throw new Error(`Decision ${i} (${d.symbol}): missing leverage (required for ${d.action})`);
      }
      if (typeof d.leverage !== 'number' || d.leverage < 1 || d.leverage > 10) {
        throw new Error(`Decision ${i} (${d.symbol}): invalid leverage ${d.leverage} (must be 1-10)`);
      }
      
      if (d.positionSizeUsd === undefined || d.positionSizeUsd === null) {
        throw new Error(`Decision ${i} (${d.symbol}): missing positionSizeUsd (required for ${d.action})`);
      }
      if (typeof d.positionSizeUsd !== 'number' || d.positionSizeUsd <= 0) {
        throw new Error(`Decision ${i} (${d.symbol}): invalid positionSizeUsd ${d.positionSizeUsd} (must be positive number)`);
      }
      
      if (d.stopLoss === undefined || d.stopLoss === null) {
        throw new Error(`Decision ${i} (${d.symbol}): missing stopLoss (required for ${d.action})`);
      }
      if (typeof d.stopLoss !== 'number' || d.stopLoss <= 0) {
        throw new Error(`Decision ${i} (${d.symbol}): invalid stopLoss ${d.stopLoss} (must be positive number)`);
      }
      
      if (d.takeProfit === undefined || d.takeProfit === null) {
        throw new Error(`Decision ${i} (${d.symbol}): missing takeProfit (required for ${d.action})`);
      }
      if (typeof d.takeProfit !== 'number' || d.takeProfit <= 0) {
        throw new Error(`Decision ${i} (${d.symbol}): invalid takeProfit ${d.takeProfit} (must be positive number)`);
      }
    }
  });
}

// Call OpenClaw CLI to send message to trading session
async function askLeeloo(prompt) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      child.kill();
      reject(new Error(`Timeout after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);
    
    // Use openclaw CLI to send message
    // openclaw agent --session-id <session> --message <prompt>
    const args = ['agent', '--session-id', TRADING_SESSION, '--message', prompt];
    
    log('debug', 'Calling OpenClaw CLI', { command: OPENCLAW_CLI, args: args.slice(0, -1) });
    
    const child = spawn(OPENCLAW_CLI, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false
    });
    
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    child.on('close', (code) => {
      clearTimeout(timeoutId);
      
      if (code !== 0) {
        reject(new Error(`OpenClaw CLI failed (exit ${code}): ${stderr}`));
      } else {
        resolve(stdout.trim());
      }
    });
    
    child.on('error', (err) => {
      clearTimeout(timeoutId);
      reject(new Error(`Failed to spawn OpenClaw CLI: ${err.message}`));
    });
  });
}

// HTTP request handler
async function handleRequest(req, res) {
  const startTime = Date.now();
  
  // CORS headers (if needed)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Handle OPTIONS (CORS preflight)
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  // Health check endpoint
  if (req.method === 'GET' && req.url === '/api/v1/trading/health') {
    const health = {
      status: 'healthy',
      session: TRADING_SESSION,
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(health, null, 2));
    log('info', 'Health check', health);
    return;
  }
  
  // Trading decision endpoint
  if (req.method === 'POST' && req.url === '/api/v1/trading/decision') {
    try {
      // 1. Authentication
      const authHeader = req.headers.authorization;
      const token = authHeader ? authHeader.replace('Bearer ', '').trim() : '';
      
      if (token !== API_TOKEN) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          error: 'Unauthorized',
          timestamp: new Date().toISOString()
        }));
        log('warn', 'Unauthorized request', { 
          ip: req.socket.remoteAddress,
          token: token.substring(0, 8) + '...' 
        });
        return;
      }
      
      // 2. Parse request body
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', async () => {
        try {
          const request = JSON.parse(body);
          const { systemPrompt, userPrompt, metadata } = request;
          
          log('info', 'Trading decision requested', { 
            requestId: metadata?.requestId,
            exchange: metadata?.exchange,
            symbols: metadata?.symbols
          });
          
          // Validate request
          if (!systemPrompt || !userPrompt) {
            throw new Error('Missing systemPrompt or userPrompt');
          }
          
          // 3. Build prompt for Leeloo
          const leelooPrompt = buildTradingPrompt(systemPrompt, userPrompt);
          
          // 4. Call Leeloo via OpenClaw CLI
          const rawResponse = await askLeeloo(leelooPrompt);
          
          // 5. Parse response
          const { decisions, cotTrace } = parseLeelooResponse(rawResponse);
          
          const processingTime = Date.now() - startTime;
          
          // 6. Build response
          const response = {
            decisions,
            cotTrace,
            timestamp: new Date().toISOString(),
            processingTimeMs: processingTime
          };
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response, null, 2));
          
          log('info', 'Trading decision completed', {
            requestId: metadata?.requestId,
            decisionsCount: decisions.length,
            processingTimeMs: processingTime
          });
          
          // Log decisions to daily file
          logDecisions(metadata?.requestId, decisions, cotTrace, processingTime);
          
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
      
    } catch (err) {
      log('error', 'Unexpected error', { error: err.message, stack: err.stack });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        error: 'Internal server error',
        timestamp: new Date().toISOString()
      }));
    }
    return;
  }
  
  // 404 for other routes
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ 
    error: 'Not found',
    timestamp: new Date().toISOString()
  }));
}

// Log trading decisions to daily file
function logDecisions(requestId, decisions, cotTrace, processingTime) {
  const today = new Date().toISOString().split('T')[0];
  const decisionLogFile = path.join(WORKSPACE, 'memory', `${today}.md`);
  
  const timestamp = new Date().toISOString();
  
  const logEntry = `
## ${timestamp} - Trading Decision

**Request ID:** ${requestId || 'N/A'}  
**Processing:** ${processingTime}ms

### Decisions
${decisions.map(d => `
- **${d.symbol}**: ${d.action}${d.leverage ? ` (${d.leverage}x)` : ''}
  - Confidence: ${d.confidence}%
  - Reasoning: ${d.reasoning}
  ${d.positionSizeUsd ? `- Position Size: $${d.positionSizeUsd}` : ''}
  ${d.stopLoss ? `- Stop Loss: $${d.stopLoss}` : ''}
  ${d.takeProfit ? `- Take Profit: $${d.takeProfit}` : ''}
`).join('\n')}

### Chain of Thought
\`\`\`
${cotTrace}
\`\`\`

---
`;
  
  try {
    fs.appendFileSync(decisionLogFile, logEntry);
  } catch (err) {
    log('error', 'Failed to write decision log', { error: err.message });
  }
}

// Start server
const server = http.createServer(handleRequest);

server.listen(PORT, '0.0.0.0', () => {
  log('info', `Trading Decision Adapter started`, {
    port: PORT,
    session: TRADING_SESSION,
    workspace: WORKSPACE,
    pid: process.pid
  });
  
  console.log('');
  console.log('='.repeat(70));
  console.log('  OpenClaw Trading Decision Adapter');
  console.log('='.repeat(70));
  console.log('');
  console.log(`  Listening on:    http://0.0.0.0:${PORT}`);
  console.log(`  Health check:    http://localhost:${PORT}/api/v1/trading/health`);
  console.log(`  Trading API:     http://localhost:${PORT}/api/v1/trading/decision`);
  console.log('');
  console.log(`  Trading session: ${TRADING_SESSION}`);
  console.log(`  Workspace:       ${WORKSPACE}`);
  console.log(`  Log file:        ${LOG_FILE}`);
  console.log('');
  console.log('  Press Ctrl+C to stop');
  console.log('');
  console.log('='.repeat(70));
  console.log('');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  log('info', 'Received SIGTERM, shutting down gracefully');
  server.close(() => {
    log('info', 'Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\n');
  log('info', 'Received SIGINT (Ctrl+C), shutting down');
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
  log('error', 'Unhandled rejection', { reason, promise });
  process.exit(1);
});
