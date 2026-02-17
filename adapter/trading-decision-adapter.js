#!/usr/bin/env node
/**
 * OpenClaw Trading Decision Adapter (HTTP Edition)
 * 
 * A lightweight HTTP server that bridges NoFx trading bot with OpenClaw/Leeloo.
 * Provides the /api/v1/trading/decision endpoint for NoFx to request trading decisions.
 * 
 * Architecture:
 *   NoFx → HTTP POST → This Adapter → OpenClaw Gateway (HTTP) → Leeloo → Decision → Adapter → NoFx
 * 
 * Usage:
 *   node trading-decision-adapter.js
 * 
 * Environment Variables:
 *   PORT                  - Server port (default: 8888)
 *   OPENCLAW_GATEWAY_URL  - OpenClaw Gateway URL (default: http://host.docker.internal:18789)
 *   OPENCLAW_GATEWAY_TOKEN - Gateway auth token (REQUIRED)
 *   OPENCLAW_MODEL        - Model to use (default: openclaw:opus)
 *   OPENCLAW_SESSION_KEY  - Session key (default: agent:opus:trading-main)
 *   THINKING_LEVEL        - Thinking level: low/medium/high/off (optional)
 *   TIMEOUT_MS            - Request timeout in ms (default: 120000)
 *   ADAPTER_DATA_DIR      - Data directory for logs (default: /app/data/adapter)
 * 
 * Author: Leeloo (OpenClaw Subagent)
 * Date: 2026-02-15 (refactored 2026-02-17)
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

// Configuration
const PORT = process.env.PORT || 8888;
const OPENCLAW_GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'http://host.docker.internal:18789';
const OPENCLAW_GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;
const OPENCLAW_MODEL = process.env.OPENCLAW_MODEL || 'openclaw:opus';
const OPENCLAW_SESSION_KEY = process.env.OPENCLAW_SESSION_KEY || 'agent:opus:trading-main';
const THINKING_LEVEL = process.env.THINKING_LEVEL || null;
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS, 10) || 120000;
const ADAPTER_DATA_DIR = process.env.ADAPTER_DATA_DIR || '/app/data/adapter';
const STRATEGY_FILE = path.join(__dirname, 'nofx-strategy-hybrid-tiers.json');

// Ensure data directories exist
function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    // ignore
  }
}

ensureDir(path.join(ADAPTER_DATA_DIR, 'memory'));

// Logging
const LOG_FILE = path.join(ADAPTER_DATA_DIR, 'memory', `adapter-${new Date().toISOString().split('T')[0]}.log`);

function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    message,
    ...(data && { data })
  };
  
  const logLine = JSON.stringify(logEntry) + '\n';
  
  console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}`);
  if (data) {
    console.log(JSON.stringify(data, null, 2));
  }
  
  try {
    fs.appendFileSync(LOG_FILE, logLine);
  } catch (err) {
    // Silently ignore log write failures
  }
}

// Validate required config
if (!OPENCLAW_GATEWAY_TOKEN) {
  console.error('FATAL: OPENCLAW_GATEWAY_TOKEN environment variable is required');
  process.exit(1);
}

// Load dynamic strategy configuration
function loadStrategy() {
  try {
    const data = fs.readFileSync(STRATEGY_FILE, 'utf8');
    const strategy = JSON.parse(data);
    log('info', 'Strategy loaded', { 
      name: strategy.name,
      minConfidence: strategy.config.risk_control.min_confidence
    });
    return strategy;
  } catch (err) {
    log('error', 'Failed to load strategy file', { 
      file: STRATEGY_FILE,
      error: err.message 
    });
    throw new Error(`Strategy file not found or invalid: ${err.message}`);
  }
}

// Build trading prompt from NoFx-style strategy config
function buildTradingPrompt(systemPrompt, userPrompt) {
  const strategy = loadStrategy();
  const config = strategy.config;
  const riskControl = config.risk_control;
  const customPrompt = config.custom_prompt || '';
  
  return `You are Leeloo, the AI trading engine for NoFx AI Trading OS.

Your task is to analyze market data and provide trading decisions.

**Trading Strategy: ${strategy.name}**
${strategy.description}

**Risk Control Parameters (from active strategy):**
- Max Positions: ${riskControl.max_positions}
- BTC/ETH Max Leverage: ${riskControl.btc_eth_max_leverage}x
- Altcoin Max Leverage: ${riskControl.altcoin_max_leverage}x
- Min Risk/Reward Ratio: ${riskControl.min_risk_reward_ratio}:1
- Min Confidence: ${riskControl.min_confidence}%
- Min Position Size: $${riskControl.min_position_size}
- BTC/ETH Max Position Value Ratio: ${riskControl.btc_eth_max_position_value_ratio}x equity
- Altcoin Max Position Value Ratio: ${riskControl.altcoin_max_position_value_ratio}x equity

**Custom Strategy Instructions:**
${customPrompt}

**Market Context (from NoFx):**
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
   - stopLoss = entryPrice ± (ATR × 2.0 for ≥75%, or ATR × 1.5 for 72-74%)
   - stopDistance = |entryPrice - stopLoss|
   - takeProfit = entryPrice + (stopDistance × ${riskControl.min_risk_reward_ratio})
   - **positionSizeUsd = (confidence / 100) × maxPositionSize** ⚠️ USE EXACT CONFIDENCE!
   - leverage = ${riskControl.btc_eth_max_leverage} for BTC/ETH, ${riskControl.altcoin_max_leverage} for alts

   **Position Size Examples:**
   - Confidence 82, maxPositionSize 5000 → (82/100) × 5000 = 4100
   - Confidence 75, maxPositionSize 5000 → (75/100) × 5000 = 3750
   - Confidence 74 (tier 2), maxPositionSize 5000 → 0.5 × (74/100) × 5000 = 1850
   - DO NOT use "90% for high confidence" or other arbitrary values!

**Response Format:**

<reasoning>
Your analysis (use numbers WITHOUT commas!):
1. Account Status Analysis
2. Existing Positions Review  
3. New Opportunities Analysis (check MACD for 72-74% tier!)
4. Risk Assessment
5. Final Decisions with calculations shown
</reasoning>

<decision>
[
  {
    "symbol": "BTCUSDT",
    "action": "open_long",
    "leverage": ${riskControl.btc_eth_max_leverage},
    "positionSizeUsd": 3500,
    "stopLoss": 67800,
    "takeProfit": 70500,
    "confidence": 82,
    "reasoning": "Multi-timeframe bullish, OI +6.5%, RSI 62, R/R ${riskControl.min_risk_reward_ratio}:1"
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
  return text.replace(/\b(\d{1,3})(,\d{3})+\b/g, (match) => {
    return match.replace(/,/g, '');
  });
}

// Parse Leeloo's response
function parseLeelooResponse(rawResponse) {
  const reasoningMatch = rawResponse.match(/<reasoning>(.*?)<\/reasoning>/s);
  let cotTrace = reasoningMatch ? reasoningMatch[1].trim() : '';
  cotTrace = stripThousandSeparators(cotTrace);
  
  const decisionMatch = rawResponse.match(/<decision>(.*?)<\/decision>/s);
  if (!decisionMatch) {
    throw new Error('No <decision> tag found in Leeloo response');
  }
  
  let decisionJSON = decisionMatch[1].trim();
  
  let decisions;
  try {
    decisions = JSON.parse(decisionJSON);
  } catch (err) {
    const cleaned = decisionJSON
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    
    try {
      decisions = JSON.parse(cleaned);
    } catch (err2) {
      const hasSeparators = /\b\d{1,3}(,\d{3})+\b/.test(cleaned);
      if (hasSeparators) {
        throw new Error('JSON parsing failed: Found thousand separator commas in numbers (e.g., 68,169). Numbers must not contain commas!');
      }
      throw new Error(`JSON parsing failed: ${err2.message}`);
    }
  }
  
  log('debug', '🔍 RAW DECISION JSON (before validation)', { 
    decisionsCount: decisions.length,
    decisionsJSON: JSON.stringify(decisions, null, 2)
  });
  
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
    if (!d.symbol) throw new Error(`Decision ${i}: missing symbol`);
    if (!d.action) throw new Error(`Decision ${i}: missing action`);
    if (!validActions.includes(d.action)) {
      throw new Error(`Decision ${i}: invalid action "${d.action}" (must be one of: ${validActions.join(', ')})`);
    }
    if (d.confidence === undefined || d.confidence === null) {
      throw new Error(`Decision ${i} (${d.symbol}): missing confidence`);
    }
    if (!d.reasoning) throw new Error(`Decision ${i} (${d.symbol}): missing reasoning`);
    
    if (typeof d.confidence !== 'number' || d.confidence < 0 || d.confidence > 100) {
      throw new Error(`Decision ${i} (${d.symbol}): invalid confidence ${d.confidence} (must be number 0-100)`);
    }
    
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

// Call OpenClaw Gateway via HTTP POST to /v1/responses
async function askLeeloo(prompt) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new url.URL(`${OPENCLAW_GATEWAY_URL}/v1/responses`);
    const isHttps = parsedUrl.protocol === 'https:';
    const httpModule = isHttps ? https : http;
    
    const requestBody = JSON.stringify({
      model: OPENCLAW_MODEL,
      input: prompt
    });
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENCLAW_GATEWAY_TOKEN}`,
        'x-openclaw-session-key': OPENCLAW_SESSION_KEY,
        'Content-Length': Buffer.byteLength(requestBody)
      },
      timeout: TIMEOUT_MS
    };
    
    if (THINKING_LEVEL) {
      // Include thinking level in the request body if supported
      const bodyObj = JSON.parse(requestBody);
      bodyObj.thinking = THINKING_LEVEL;
      const updatedBody = JSON.stringify(bodyObj);
      options.headers['Content-Length'] = Buffer.byteLength(updatedBody);
      
      log('debug', 'Calling OpenClaw Gateway (HTTP)', { 
        url: `${OPENCLAW_GATEWAY_URL}/v1/responses`,
        model: OPENCLAW_MODEL,
        session: OPENCLAW_SESSION_KEY,
        thinkingLevel: THINKING_LEVEL
      });
      
      const req = httpModule.request(options, handleResponse(resolve, reject));
      req.on('error', (err) => reject(new Error(`Gateway request failed: ${err.message}`)));
      req.on('timeout', () => { req.destroy(); reject(new Error(`Gateway request timed out after ${TIMEOUT_MS}ms`)); });
      req.write(updatedBody);
      req.end();
      return;
    }
    
    log('debug', 'Calling OpenClaw Gateway (HTTP)', { 
      url: `${OPENCLAW_GATEWAY_URL}/v1/responses`,
      model: OPENCLAW_MODEL,
      session: OPENCLAW_SESSION_KEY,
      thinkingLevel: 'default'
    });
    
    const req = httpModule.request(options, handleResponse(resolve, reject));
    req.on('error', (err) => reject(new Error(`Gateway request failed: ${err.message}`)));
    req.on('timeout', () => { req.destroy(); reject(new Error(`Gateway request timed out after ${TIMEOUT_MS}ms`)); });
    req.write(requestBody);
    req.end();
  });
}

function handleResponse(resolve, reject) {
  return (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      if (res.statusCode !== 200) {
        reject(new Error(`Gateway returned HTTP ${res.statusCode}: ${data}`));
        return;
      }
      
      try {
        const response = JSON.parse(data);
        
        // Extract text from OpenResponses format
        // Response format: {"status":"completed","output":[{"content":[{"text":"..."}]}]}
        if (response.output && Array.isArray(response.output)) {
          // Find the message output (type === 'message' or has content array)
          for (const outputItem of response.output) {
            if (outputItem.content && Array.isArray(outputItem.content)) {
              for (const contentItem of outputItem.content) {
                if (contentItem.type === 'output_text' || contentItem.text) {
                  resolve(contentItem.text);
                  return;
                }
              }
            }
          }
        }
        
        reject(new Error('Could not extract text from gateway response: ' + JSON.stringify(response).substring(0, 500)));
      } catch (err) {
        reject(new Error(`Failed to parse gateway response: ${err.message}`));
      }
    });
  };
}

// Check OpenClaw Gateway connectivity
async function checkGatewayHealth() {
  return new Promise((resolve) => {
    const parsedUrl = new url.URL(`${OPENCLAW_GATEWAY_URL}/v1/responses`);
    const isHttps = parsedUrl.protocol === 'https:';
    const httpModule = isHttps ? https : http;
    
    // Simple connectivity check - just try to connect
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: '/',
      method: 'GET',
      timeout: 5000
    };
    
    const req = httpModule.request(options, (res) => {
      res.resume(); // drain response
      resolve({ connected: true, statusCode: res.statusCode });
    });
    
    req.on('error', (err) => {
      resolve({ connected: false, error: err.message });
    });
    
    req.on('timeout', () => {
      req.destroy();
      resolve({ connected: false, error: 'timeout' });
    });
    
    req.end();
  });
}

// HTTP request handler
async function handleRequest(req, res) {
  const startTime = Date.now();
  
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  // Health check endpoint (new top-level path)
  if (req.method === 'GET' && (req.url === '/health' || req.url === '/api/v1/trading/health')) {
    const gatewayStatus = await checkGatewayHealth();
    const healthy = gatewayStatus.connected;
    
    const health = {
      status: healthy ? 'healthy' : 'degraded',
      session: OPENCLAW_SESSION_KEY,
      model: OPENCLAW_MODEL,
      gateway: {
        url: OPENCLAW_GATEWAY_URL,
        ...gatewayStatus
      },
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    };
    
    res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(health, null, 2));
    log('info', 'Health check', health);
    return;
  }
  
  // Trading decision endpoint
  if (req.method === 'POST' && req.url === '/api/v1/trading/decision') {
    try {
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
          
          if (!systemPrompt || !userPrompt) {
            throw new Error('Missing systemPrompt or userPrompt');
          }
          
          const leelooPrompt = buildTradingPrompt(systemPrompt, userPrompt);
          const rawResponse = await askLeeloo(leelooPrompt);
          const { decisions, cotTrace } = parseLeelooResponse(rawResponse);
          
          const processingTime = Date.now() - startTime;
          
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
  const decisionLogFile = path.join(ADAPTER_DATA_DIR, 'memory', `${today}.md`);
  
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
    session: OPENCLAW_SESSION_KEY,
    model: OPENCLAW_MODEL,
    gateway: OPENCLAW_GATEWAY_URL,
    dataDir: ADAPTER_DATA_DIR,
    pid: process.pid
  });
  
  console.log('');
  console.log('='.repeat(70));
  console.log('  OpenClaw Trading Decision Adapter (HTTP Edition)');
  console.log('='.repeat(70));
  console.log('');
  console.log(`  Listening on:    http://0.0.0.0:${PORT}`);
  console.log(`  Health check:    http://localhost:${PORT}/health`);
  console.log(`  Trading API:     http://localhost:${PORT}/api/v1/trading/decision`);
  console.log('');
  console.log(`  Gateway:         ${OPENCLAW_GATEWAY_URL}`);
  console.log(`  Model:           ${OPENCLAW_MODEL}`);
  console.log(`  Session:         ${OPENCLAW_SESSION_KEY}`);
  console.log(`  Data dir:        ${ADAPTER_DATA_DIR}`);
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

process.on('uncaughtException', (err) => {
  log('error', 'Uncaught exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  log('error', 'Unhandled rejection', { reason, promise });
  process.exit(1);
});
