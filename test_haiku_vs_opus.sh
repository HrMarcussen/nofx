#!/bin/bash
# Quick test: Haiku vs Opus Medium
# Compare speed AND quality

set -e

OPENCLAW_URL="http://localhost:8888"
API_TOKEN="a73be04997771d09871823955a37be6349347655898034076b57251631fbf217"

SYSTEM_PROMPT='You are an expert cryptocurrency trader. Analyze market data and make trading decisions.'

USER_PROMPT='{
  "account": {"equity": 10000, "availableBalance": 9500},
  "marketData": {
    "BTCUSDT": {
      "price": 68000,
      "ema20": 67800,
      "ema50": 67500,
      "rsi": 65,
      "atr": 1200,
      "oiDelta1h": 5.2
    }
  },
  "strategy": {
    "minRiskRewardRatio": 3.0,
    "maxPositionSize": 5000,
    "riskMultiplier": 2.0,
    "btcEthMaxLeverage": 5
  }
}'

REQUEST_PAYLOAD=$(jq -n \
  --arg system "$SYSTEM_PROMPT" \
  --arg user "$USER_PROMPT" \
  '{
    systemPrompt: $system,
    userPrompt: $user,
    metadata: {
      requestId: "haiku-test-\(now)",
      timestamp: (now | strftime("%Y-%m-%dT%H:%M:%SZ")),
      exchange: "binance",
      symbols: ["BTCUSDT"]
    }
  }')

test_model() {
  local model=$1
  local thinking=$2
  
  echo ""
  echo "=========================================="
  echo "Testing: $model (thinking: $thinking)"
  echo "=========================================="
  
  # Update session
  openclaw agent --session-id agent:opus:trading-main --model "$model" --thinking "$thinking" --message "Ready for comparison test" > /dev/null 2>&1 || true
  
  sleep 1
  
  # Send request
  START_TIME=$(date +%s%3N)
  
  RESPONSE=$(curl -s -X POST "$OPENCLAW_URL/api/v1/trading/decision" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $API_TOKEN" \
    -d "$REQUEST_PAYLOAD")
  
  END_TIME=$(date +%s%3N)
  LATENCY=$((END_TIME - START_TIME))
  
  # Extract data
  DECISION=$(echo "$RESPONSE" | jq -r '.decisions[0]')
  ACTION=$(echo "$DECISION" | jq -r '.action')
  CONFIDENCE=$(echo "$DECISION" | jq -r '.confidence')
  REASONING=$(echo "$DECISION" | jq -r '.reasoning')
  COT_LENGTH=$(echo "$RESPONSE" | jq -r '.cotTrace | length')
  
  echo "⏱️  Latency: ${LATENCY} ms"
  echo "🎯 Action: $ACTION"
  echo "📊 Confidence: $CONFIDENCE%"
  echo "💭 Chain of Thought: $COT_LENGTH chars"
  echo ""
  echo "Reasoning:"
  echo "$REASONING"
  echo ""
  
  if [ "$LATENCY" -lt 15000 ]; then
    echo "✅ LIVE READY (<15s)"
  elif [ "$LATENCY" -lt 30000 ]; then
    echo "⚠️ SWING ONLY (15-30s)"
  else
    echo "❌ BACKTEST ONLY (>30s)"
  fi
}

echo "========================================================================"
echo "Haiku vs Opus Medium - Quality & Speed Comparison"
echo "========================================================================"

# Test Haiku
test_model "haiku" "low"

# Test Opus Medium
test_model "opus" "medium"

echo ""
echo "========================================================================"
echo "Comparison Complete!"
echo "========================================================================"
echo ""
echo "Look for:"
echo "  • Speed difference"
echo "  • Quality of reasoning"
echo "  • Confidence accuracy"
echo "  • Chain of Thought depth"
echo ""
