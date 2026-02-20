#!/usr/bin/env node
/**
 * LLM Escalation Handler
 * 
 * Handles escalation to LLM (via OpenClaw) when rule engine is uncertain.
 * 
 * Features:
 * - Builds compact prompt with condensed signal data
 * - Sends to OpenClaw API (http://localhost:18789/v1/responses)
 * - Parses LLM response → extract action, confidence, reasoning
 * - Timeout handling (30s) → defaults to WAIT
 * - Fallback if OpenClaw is down → WAIT + alarm
 * - Logs all escalations for analysis
 * 
 * OpenClaw API Format:
 *   POST /v1/responses
 *   Body: { prompt: "..." }
 *   Response: { response: "..." }
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const OPENCLAW_HOST = 'localhost';
const OPENCLAW_PORT = 18789;
const OPENCLAW_PATH = '/v1/responses';
const ESCALATION_TIMEOUT_MS = 30000; // 30 seconds
const ESCALATION_LOG_FILE = path.join(__dirname, '..', 'logs', 'escalations.jsonl');

/**
 * Ensure log directory exists
 */
function ensureLogDir() {
  const logDir = path.dirname(ESCALATION_LOG_FILE);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

/**
 * Log escalation to JSONL
 */
function logEscalation(escalationData) {
  ensureLogDir();
  
  const logEntry = {
    timestamp: new Date().toISOString(),
    ...escalationData
  };
  
  fs.appendFileSync(ESCALATION_LOG_FILE, JSON.stringify(logEntry) + '\n');
}

/**
 * Build compact prompt for LLM
 * 
 * @param {object} escalation - Escalation data from escalation.js
 * @returns {string} Prompt text
 */
function buildCompactPrompt(escalation) {
  const { signal, ruleDecision, triggers } = escalation;
  
  let prompt = `# Trading Escalation - Decision Required\n\n`;
  
  prompt += `**Symbol:** ${signal.symbol}\n`;
  prompt += `**Price:** $${signal.price}\n`;
  prompt += `**Timestamp:** ${signal.timestamp}\n\n`;
  
  // Escalation triggers
  prompt += `## Escalation Triggers (${triggers.length}):\n`;
  triggers.forEach(t => {
    prompt += `- **[${t.severity.toUpperCase()}]** ${t.type}\n`;
    if (t.details && t.details.length > 0) {
      t.details.forEach(d => prompt += `  • ${d}\n`);
    }
  });
  prompt += `\n`;
  
  // Market signals (CONDENSED - not raw candles!)
  prompt += `## Market Signals:\n`;
  prompt += `- **Trend:** EMA ${signal.trend.ema_cross}, ${signal.trend.ema200_pos} EMA200, MACD ${signal.trend.macd_trend}\n`;
  prompt += `- **MACD:** Histogram ${signal.trend.macd_histogram?.toFixed(2)}, Cross ${signal.trend.macd_cross}\n`;
  prompt += `- **Momentum:** RSI ${signal.momentum.rsi?.toFixed(1)} (${signal.momentum.rsi_zone})\n`;
  prompt += `- **Volume:** ${signal.momentum.volume_ratio?.toFixed(2)}x average\n`;
  prompt += `- **Volatility:** ATR ${signal.volatility.atr_pct?.toFixed(2)}%\n`;
  prompt += `- **Derivatives:** Funding ${signal.derivatives.funding_rate?.toFixed(3)}%, OI change ${signal.derivatives.oi_change_24h?.toFixed(1)}%\n`;
  prompt += `- **Multi-TF alignment:** ${signal.multi_tf_alignment}/4 timeframes\n`;
  prompt += `- **Composite score:** ${signal.composite_score}/100\n`;
  prompt += `\n`;
  
  // Rule engine decision
  prompt += `## Rule Engine Decision:\n`;
  prompt += `- **Action:** ${ruleDecision.action}\n`;
  prompt += `- **Tier:** ${ruleDecision.tier || 'N/A'}\n`;
  prompt += `- **Confidence:** ${ruleDecision.confidence}%\n`;
  prompt += `- **Reasoning:** ${ruleDecision.reasoning.split('\n')[0]}\n`; // First line only
  prompt += `\n`;
  
  // Question
  prompt += `## Your Task:\n`;
  prompt += `Based on the above, decide: Should we LONG, SHORT, or WAIT?\n\n`;
  prompt += `**Respond with JSON only:**\n`;
  prompt += `\`\`\`json\n`;
  prompt += `{\n`;
  prompt += `  "action": "open_long|open_short|wait|close_long|close_short",\n`;
  prompt += `  "confidence": 0-100,\n`;
  prompt += `  "reasoning": "your analysis in 1-2 sentences"\n`;
  prompt += `}\n`;
  prompt += `\`\`\`\n`;
  
  return prompt;
}

/**
 * Call OpenClaw API
 * 
 * @param {string} prompt - Prompt text
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<string>} LLM response text
 */
function callOpenClaw(prompt, timeoutMs = ESCALATION_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ prompt });
    
    const options = {
      hostname: OPENCLAW_HOST,
      port: OPENCLAW_PORT,
      path: OPENCLAW_PATH,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: timeoutMs
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const json = JSON.parse(data);
            resolve(json.response || json.text || data);
          } catch (err) {
            reject(new Error(`Failed to parse OpenClaw response: ${err.message}`));
          }
        } else {
          reject(new Error(`OpenClaw returned ${res.statusCode}: ${data}`));
        }
      });
    });
    
    req.on('error', (err) => {
      reject(new Error(`OpenClaw connection error: ${err.message}`));
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`OpenClaw timeout after ${timeoutMs}ms`));
    });
    
    req.write(postData);
    req.end();
  });
}

/**
 * Parse LLM response
 * Extracts JSON from markdown code blocks or raw JSON
 * 
 * @param {string} responseText - Raw LLM response
 * @returns {object} Parsed decision { action, confidence, reasoning }
 */
function parseLLMResponse(responseText) {
  // Try to extract JSON from markdown code block
  const jsonMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  
  let jsonText = jsonMatch ? jsonMatch[1] : responseText;
  
  // Clean up
  jsonText = jsonText.trim();
  
  try {
    const parsed = JSON.parse(jsonText);
    
    // Validate required fields
    if (!parsed.action) {
      throw new Error('Missing "action" field');
    }
    if (parsed.confidence === undefined) {
      throw new Error('Missing "confidence" field');
    }
    
    // Normalize action
    const validActions = ['open_long', 'open_short', 'wait', 'close_long', 'close_short', 'hold'];
    if (!validActions.includes(parsed.action)) {
      console.warn(`[EscalationHandler] Invalid action "${parsed.action}", defaulting to "wait"`);
      parsed.action = 'wait';
    }
    
    // Ensure confidence is 0-100
    parsed.confidence = Math.max(0, Math.min(100, parsed.confidence));
    
    return {
      action: parsed.action,
      confidence: parsed.confidence,
      reasoning: parsed.reasoning || 'No reasoning provided',
      raw: parsed
    };
  } catch (err) {
    throw new Error(`Failed to parse LLM JSON: ${err.message}`);
  }
}

/**
 * Handle escalation to LLM
 * 
 * @param {object} escalation - Escalation data from escalation.shouldEscalate()
 * @returns {Promise<object>} Decision object
 */
async function handleEscalation(escalation) {
  const startTime = Date.now();
  const { signal } = escalation;
  
  console.log(`[EscalationHandler] ⚠️  Escalating ${signal.symbol} to LLM...`);
  
  // Build prompt
  const prompt = buildCompactPrompt(escalation);
  
  let decision = null;
  let error = null;
  let llmResponse = null;
  
  try {
    // Call OpenClaw
    llmResponse = await callOpenClaw(prompt, ESCALATION_TIMEOUT_MS);
    
    // Parse response
    decision = parseLLMResponse(llmResponse);
    
    console.log(`[EscalationHandler] ✅ LLM decision: ${decision.action} (${decision.confidence}% confidence)`);
    console.log(`[EscalationHandler] Reasoning: ${decision.reasoning}`);
    
  } catch (err) {
    error = err.message;
    console.error(`[EscalationHandler] ❌ Escalation failed: ${error}`);
    
    // FALLBACK: Default to WAIT (safety first!)
    decision = {
      action: 'wait',
      confidence: 0,
      reasoning: `LLM escalation failed: ${error}. Defaulting to WAIT for safety.`,
      fallback: true,
      error
    };
    
    console.warn(`[EscalationHandler] 🛑 Fallback to WAIT due to error`);
  }
  
  const processingTime = Date.now() - startTime;
  
  // Log escalation
  logEscalation({
    symbol: signal.symbol,
    triggers: escalation.triggers.map(t => t.type),
    prompt,
    llmResponse,
    decision,
    error,
    processingTimeMs: processingTime
  });
  
  return {
    ...decision,
    escalated: true,
    processingTimeMs: processingTime,
    promptTokensEstimate: Math.ceil(prompt.length / 4), // Rough estimate
    timestamp: new Date().toISOString()
  };
}

/**
 * Get escalation stats
 */
function getEscalationStats() {
  ensureLogDir();
  
  if (!fs.existsSync(ESCALATION_LOG_FILE)) {
    return {
      totalEscalations: 0,
      successRate: 0,
      avgProcessingTime: 0,
      lastEscalation: null
    };
  }
  
  const lines = fs.readFileSync(ESCALATION_LOG_FILE, 'utf8').trim().split('\n');
  const escalations = lines
    .filter(line => line.length > 0)
    .map(line => JSON.parse(line));
  
  const total = escalations.length;
  const successful = escalations.filter(e => !e.error).length;
  const avgTime = escalations.reduce((sum, e) => sum + (e.processingTimeMs || 0), 0) / total;
  
  return {
    totalEscalations: total,
    successRate: total > 0 ? (successful / total) * 100 : 0,
    avgProcessingTimeMs: avgTime,
    lastEscalation: escalations[escalations.length - 1] || null
  };
}

module.exports = {
  handleEscalation,
  buildCompactPrompt,
  callOpenClaw,
  parseLLMResponse,
  getEscalationStats
};
