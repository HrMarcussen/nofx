#!/bin/bash
# End-to-End OpenClaw Integration Test
# Tests the full pipeline: NoFx → OpenClaw Adapter → Leeloo → Trading Decision

set -e

echo "🧪 Starting End-to-End OpenClaw Integration Test"
echo "=================================================="
echo ""

# Configuration
OPENCLAW_URL="http://localhost:8888"
API_TOKEN="a73be04997771d09871823955a37be6349347655898034076b57251631fbf217"
OUTPUT_FILE="/tmp/openclaw_e2e_test_result.json"

# Test 1: Health Check
echo "📊 Test 1: Health Check"
echo "-----------------------"
HEALTH_RESPONSE=$(curl -s "$OPENCLAW_URL/api/v1/trading/health")
echo "Response: $HEALTH_RESPONSE"

if echo "$HEALTH_RESPONSE" | grep -q 'healthy'; then
    echo "✅ Health check passed"
else
    echo "❌ Health check failed"
    exit 1
fi
echo ""

# Test 2: Realistic Market Data Request
echo "📊 Test 2: Realistic Trading Decision Request"
echo "----------------------------------------------"

# Create realistic market data (what NoFx would send)
SYSTEM_PROMPT='You are an expert cryptocurrency trading AI. Analyze the market data and make trading decisions.

**Risk Limits:**
- Max position size: $1000 USD per trade
- Max leverage: 5x
- Risk per trade: 2% of equity
- Max open positions: 3

**Strategy:**
- Use EMA crossovers for trend detection
- RSI for momentum confirmation
- Volume OI for market strength
- Strict stop-loss and take-profit rules'

USER_PROMPT='{
  "account": {
    "equity": 10000,
    "availableBalance": 8500,
    "unrealizedPnL": 0,
    "marginUsed": 1500
  },
  "positions": [
    {
      "symbol": "BTCUSDT",
      "side": "long",
      "size": 0.02,
      "entryPrice": 45000,
      "currentPrice": 45200,
      "unrealizedPnL": 4,
      "leverage": 3
    }
  ],
  "marketData": {
    "ETHUSDT": {
      "price": 2500,
      "ema7": 2480,
      "ema25": 2520,
      "ema99": 2550,
      "rsi": 65,
      "volume24h": 15000000,
      "openInterest": 500000000,
      "funding_rate": 0.0001
    },
    "SOLUSDT": {
      "price": 100,
      "ema7": 98,
      "ema25": 95,
      "ema99": 92,
      "rsi": 72,
      "volume24h": 8000000,
      "openInterest": 200000000,
      "funding_rate": 0.00015
    }
  }
}'

# Build request payload
REQUEST_PAYLOAD=$(jq -n \
  --arg system "$SYSTEM_PROMPT" \
  --arg user "$USER_PROMPT" \
  '{
    systemPrompt: $system,
    userPrompt: $user,
    metadata: {
      requestId: "test-e2e-\(now)",
      timestamp: (now | strftime("%Y-%m-%dT%H:%M:%SZ")),
      exchange: "binance",
      symbols: ["ETHUSDT", "SOLUSDT"]
    }
  }')

echo "Sending request to: $OPENCLAW_URL/api/v1/trading/decision"
echo "Request size: $(echo "$REQUEST_PAYLOAD" | wc -c) bytes"
echo ""

# Send request and measure time
START_TIME=$(date +%s%3N)

curl -s -X POST "$OPENCLAW_URL/api/v1/trading/decision" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_TOKEN" \
  -d "$REQUEST_PAYLOAD" \
  -o "$OUTPUT_FILE"

END_TIME=$(date +%s%3N)
LATENCY=$((END_TIME - START_TIME))

echo "✅ Response received in ${LATENCY}ms"
echo ""

# Test 3: Response Validation
echo "📊 Test 3: Response Validation"
echo "-------------------------------"

# Check if response is valid JSON
if ! jq empty "$OUTPUT_FILE" 2>/dev/null; then
    echo "❌ Invalid JSON response"
    cat "$OUTPUT_FILE"
    exit 1
fi

# Extract key fields
DECISIONS_COUNT=$(jq '.decisions | length' "$OUTPUT_FILE")
HAS_COT=$(jq 'has("cotTrace")' "$OUTPUT_FILE")
PROCESSING_TIME=$(jq '.processingTimeMs // 0' "$OUTPUT_FILE")

echo "Decisions count: $DECISIONS_COUNT"
echo "Has Chain of Thought: $HAS_COT"
echo "Processing time: ${PROCESSING_TIME}ms"
echo ""

# Validate decisions
if [ "$DECISIONS_COUNT" -eq 0 ]; then
    echo "⚠️ Warning: No trading decisions returned"
    echo "Leeloo's response:"
    jq '.decisions' "$OUTPUT_FILE"
else
    echo "✅ Received $DECISIONS_COUNT trading decision(s)"
    echo ""
    echo "Decision Details:"
    jq -r '.decisions[] | "  - \(.symbol): \(.action) (confidence: \(.confidence)%) - \(.reasoning | .[0:100])..."' "$OUTPUT_FILE"
fi
echo ""

# Test 4: Chain of Thought Validation
echo "📊 Test 4: Chain of Thought Validation"
echo "---------------------------------------"

COT_LENGTH=$(jq -r '.cotTrace | length' "$OUTPUT_FILE")
echo "Chain of Thought length: $COT_LENGTH characters"

if [ "$COT_LENGTH" -gt 100 ]; then
    echo "✅ Chain of Thought present"
    echo ""
    echo "CoT Preview (first 500 chars):"
    jq -r '.cotTrace | .[0:500]' "$OUTPUT_FILE"
    echo "..."
else
    echo "⚠️ Chain of Thought missing or too short"
fi
echo ""

# Test 5: Performance Check
echo "📊 Test 5: Performance Check"
echo "-----------------------------"

TARGET_LATENCY=15000  # 15 seconds

if [ "$LATENCY" -lt "$TARGET_LATENCY" ]; then
    echo "✅ Latency: ${LATENCY}ms (target: <${TARGET_LATENCY}ms)"
else
    echo "⚠️ Latency: ${LATENCY}ms exceeds target ${TARGET_LATENCY}ms"
fi

if [ "$PROCESSING_TIME" -gt 0 ]; then
    echo "   Processing time: ${PROCESSING_TIME}ms"
    NETWORK_OVERHEAD=$((LATENCY - PROCESSING_TIME))
    echo "   Network overhead: ${NETWORK_OVERHEAD}ms"
fi
echo ""

# Test Summary
echo "=================================================="
echo "🎉 End-to-End Test Summary"
echo "=================================================="
echo "✅ Health check: PASS"
echo "✅ Request/Response: PASS"
echo "✅ JSON validation: PASS"
if [ "$DECISIONS_COUNT" -gt 0 ]; then
    echo "✅ Trading decisions: $DECISIONS_COUNT received"
else
    echo "⚠️ Trading decisions: None (may be valid if market conditions don't warrant action)"
fi
if [ "$COT_LENGTH" -gt 100 ]; then
    echo "✅ Chain of Thought: Present ($COT_LENGTH chars)"
else
    echo "⚠️ Chain of Thought: Missing"
fi
if [ "$LATENCY" -lt "$TARGET_LATENCY" ]; then
    echo "✅ Performance: ${LATENCY}ms (within target)"
else
    echo "⚠️ Performance: ${LATENCY}ms (exceeds target)"
fi
echo ""
echo "Full response saved to: $OUTPUT_FILE"
echo ""
echo "✅ End-to-End Integration Test COMPLETE!"
