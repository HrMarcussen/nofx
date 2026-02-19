#!/usr/bin/env node
/**
 * OpenClaw Trading Decision Adapter (HTTP Edition) — v2.0 Refactored
 * 
 * A lightweight HTTP server that bridges NoFx trading bot with OpenClaw/Leeloo.
 * Provides the /api/v1/trading/decision endpoint for NoFx to request trading decisions.
 * 
 * Architecture (v2):
 *   NoFx → HTTP POST → Pre-Processor → Compact LLM Prompt → OpenClaw Gateway → 
 *   LLM (analysis only) → Post-Processor (math/sizing/stops) → Final Decision → NoFx
 * 
 * The LLM only does market analysis and returns {action, confidence, reasoning}.
 * All position sizing, stop-loss, take-profit, tier logic is handled by script.
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
 * Date: 2026-02-15 (refactored v2 2026-02-19)
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const { preProcess } = require('./pre-processor');
const { postProcess } = require('./post-processor');

// Configuration
const PORT = process.env.PORT || 8888;
const OPENCLAW_GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'http://host.docker.internal:18789';
const OPENCLAW_GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;
const OPENCLAW_MODEL = process.env.OPENCLAW_MODEL || 'openclaw:opus';
const OPENCLAW_SESSION_KEY = process.env.OPENCLAW_SESSION_KEY || 'agent:opus:trading-main';
const THINKING_LEVEL = process.env.THINKING_LEVEL || null;
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS, 10) || 120000;
const ADAPTER_DATA_DIR = process.env.ADAPTER_DATA_DIR || '/app/data/adapter';

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

/**
 * Build the simplified LLM prompt.
 * The LLM only needs to analyze and decide — no formulas, no formatting rules.
 */
function buildLlmPrompt(marketSummary, existingPositions) {
  const hasPositions = existingPositions && existingPositions.length > 0;
  
  return `You are a crypto trading analyst. Analyze the market data below and provide trading decisions.

${marketSummary}

For each symbol in the market data, respond with a JSON array. Each entry must have:
- "symbol": the trading pair (e.g. "BTCUSDT")
- "action": one of "open_long", "open_short", "close_long", "close_short", "hold", "wait"
- "confidence": your confidence level 0-100
- "reasoning": brief explanation of your analysis

${hasPositions ? 'For existing positions, decide whether to hold or close based on current conditions.' : ''}

Consider: trend direction (EMA alignment), momentum (RSI, MACD across timeframes), volatility (ATR), volume, open interest changes, and funding rates.

Respond ONLY with a JSON array, no other text:
[{"symbol":"...","action":"...","confidence":...,"reasoning":"..."}]`;
}

/**
 * Parse the LLM's simplified response (just a JSON array)
 */
function parseLlmResponse(rawResponse) {
  // Try to extract JSON array from response
  let text = rawResponse.trim();
  
  // Strip markdown code blocks if present
  text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  
  // Try to find JSON array in the response
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (!arrayMatch) {
    throw new Error('No JSON array found in LLM response');
  }
  
  let decisions;
  try {
    decisions = JSON.parse(arrayMatch[0]);
  } catch (err) {
    // Try cleaning thousand separators
    const cleaned = arrayMatch[0].replace(/\b(\d{1,3})(,\d{3})+\b/g, (match) => match.replace(/,/g, ''));
    try {
      decisions = JSON.parse(cleaned);
    } catch (err2) {
      throw new Error(`Failed to parse LLM response as JSON: ${err2.message}`);
    }
  }
  
  if (!Array.isArray(decisions)) {
    throw new Error('LLM response is not an array');
  }
  
  // Basic validation of LLM output
  const validActions = ['open_long', 'open_short', 'close_long', 'close_short', 'hold', 'wait'];
  for (const d of decisions) {
    if (!d.symbol) throw new Error('LLM decision missing symbol');
    if (!d.action || !validActions.includes(d.action)) {
      throw new Error(`LLM decision for ${d.symbol}: invalid action "${d.action}"`);
    }
    if (d.confidence === undefined || typeof d.confidence !== 'number') {
      throw new Error(`LLM decision for ${d.symbol}: missing or non-numeric confidence`);
    }
    if (!d.reasoning) {
      d.reasoning = 'No reasoning provided';
    }
  }
  
  // Extract any non-JSON text as chain-of-thought trace
  const beforeJson = text.substring(0, text.indexOf(arrayMatch[0])).trim();
  const afterJson = text.substring(text.indexOf(arrayMatch[0]) + arrayMatch[0].length).trim();
  const cotTrace = [beforeJson, afterJson].filter(Boolean).join('\n').trim();
  
  return { decisions, cotTrace };
}

// Call OpenClaw Gateway via HTTP POST to /v1/responses
async function askLeeloo(prompt) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new url.URL(`${OPENCLAW_GATEWAY_URL}/v1/responses`);
    const isHttps = parsedUrl.protocol === 'https:';
    const httpModule = isHttps ? https : http;
    
    const bodyObj = {
      model: OPENCLAW_MODEL,
      input: prompt
    };
    
    if (THINKING_LEVEL) {
      bodyObj.thinking = THINKING_LEVEL;
    }
    
    const requestBody = JSON.stringify(bodyObj);
    
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
    
    log('debug', 'Calling OpenClaw Gateway (HTTP)', { 
      url: `${OPENCLAW_GATEWAY_URL}/v1/responses`,
      model: OPENCLAW_MODEL,
      session: OPENCLAW_SESSION_KEY,
      thinkingLevel: THINKING_LEVEL || 'default',
      promptLength: prompt.length
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
        
        if (response.output && Array.isArray(response.output)) {
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
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: '/',
      method: 'GET',
      timeout: 5000
    };
    
    const req = httpModule.request(options, (res) => {
      res.resume();
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
  
  // Health check endpoint
  if (req.method === 'GET' && (req.url === '/health' || req.url === '/api/v1/trading/health')) {
    const gatewayStatus = await checkGatewayHealth();
    const healthy = gatewayStatus.connected;
    
    const health = {
      status: healthy ? 'healthy' : 'degraded',
      version: '2.0',
      architecture: 'pre-process → LLM (analysis) → post-process (math)',
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
          const { metadata } = request;
          
          log('info', '📥 Trading decision requested', { 
            requestId: metadata?.requestId,
            exchange: metadata?.exchange,
            symbols: metadata?.symbols
          });
          
          if (!request.userPrompt) {
            throw new Error('Missing userPrompt');
          }
          
          // === PHASE 1: PRE-PROCESS ===
          const preStart = Date.now();
          const preprocessed = preProcess(request);
          const preTimeMs = Date.now() - preStart;
          
          log('info', '🔧 Pre-processing complete', {
            isLegacy: preprocessed.isLegacyFormat,
            symbolCount: Object.keys(preprocessed.symbolIndicators).length,
            symbols: Object.keys(preprocessed.symbolIndicators),
            promptLength: preprocessed.llmPrompt.length,
            preProcessMs: preTimeMs
          });
          
          // === PHASE 2: LLM ANALYSIS ===
          const llmPrompt = buildLlmPrompt(
            preprocessed.llmPrompt,
            preprocessed.existingPositions
          );
          
          log('info', '🤖 Sending to LLM', { 
            promptChars: llmPrompt.length,
            promptTokensEstimate: Math.round(llmPrompt.length / 4)
          });
          
          const llmStart = Date.now();
          const rawResponse = await askLeeloo(llmPrompt);
          const llmTimeMs = Date.now() - llmStart;
          
          const { decisions: llmDecisions, cotTrace } = parseLlmResponse(rawResponse);
          
          log('info', '🤖 LLM response received', {
            decisionsCount: llmDecisions.length,
            llmTimeMs,
            decisions: llmDecisions.map(d => ({ symbol: d.symbol, action: d.action, confidence: d.confidence }))
          });
          
          // === PHASE 3: POST-PROCESS ===
          const postStart = Date.now();
          const finalDecisions = postProcess(
            llmDecisions,
            preprocessed.symbolIndicators,
            preprocessed.strategy
          );
          const postTimeMs = Date.now() - postStart;
          
          log('info', '📊 Post-processing complete', {
            postProcessMs: postTimeMs,
            decisions: finalDecisions.map(d => ({
              symbol: d.symbol,
              action: d.action,
              confidence: d.confidence,
              positionSizeUsd: d.positionSizeUsd,
              leverage: d.leverage,
              stopLoss: d.stopLoss,
              takeProfit: d.takeProfit
            }))
          });
          
          const processingTime = Date.now() - startTime;
          
          const response = {
            decisions: finalDecisions,
            cotTrace,
            timestamp: new Date().toISOString(),
            processingTimeMs: processingTime,
            timing: {
              preProcessMs: preTimeMs,
              llmMs: llmTimeMs,
              postProcessMs: postTimeMs
            }
          };
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response, null, 2));
          
          log('info', '✅ Trading decision completed', {
            requestId: metadata?.requestId,
            decisionsCount: finalDecisions.length,
            processingTimeMs: processingTime
          });
          
          logDecisions(metadata?.requestId, finalDecisions, cotTrace, processingTime);
          
        } catch (err) {
          const processingTime = Date.now() - startTime;
          
          log('error', '❌ Request processing failed', {
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
  log('info', `Trading Decision Adapter v2.0 started`, {
    port: PORT,
    session: OPENCLAW_SESSION_KEY,
    model: OPENCLAW_MODEL,
    gateway: OPENCLAW_GATEWAY_URL,
    dataDir: ADAPTER_DATA_DIR,
    pid: process.pid
  });
  
  console.log('');
  console.log('='.repeat(70));
  console.log('  OpenClaw Trading Decision Adapter v2.0 (Refactored)');
  console.log('  Pre-Process → LLM (analysis) → Post-Process (math)');
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
