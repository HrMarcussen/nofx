#!/bin/bash
# Trading Model Performance Benchmark
# Tests different Claude models with varying thinking levels

set -e

OPENCLAW_URL="http://localhost:8888"
API_TOKEN="a73be04997771d09871823955a37be6349347655898034076b57251631fbf217"
RESULTS_FILE="/tmp/trading_model_benchmark_$(date +%Y%m%d_%H%M%S).txt"

echo "========================================================================"
echo "Trading Model Performance Benchmark"
echo "========================================================================"
echo "Testing: Sonnet (low/med/high) + Opus (low/med/high)"
echo "Results will be saved to: $RESULTS_FILE"
echo ""

# Sample market data (same for all tests)
SYSTEM_PROMPT='You are an expert cryptocurrency trader. Analyze and decide.'

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
      requestId: "benchmark-\(now)",
      timestamp: (now | strftime("%Y-%m-%dT%H:%M:%SZ")),
      exchange: "binance",
      symbols: ["BTCUSDT"]
    }
  }')

# Function to test a specific model
test_model() {
  local model=$1
  local thinking=$2
  local label="$model (thinking: $thinking)"
  
  echo "Testing: $label"
  
  # Update trading session with model + thinking
  openclaw agent --session-id agent:opus:trading-main --model "$model" --thinking "$thinking" --message "Ready for benchmark test" > /dev/null 2>&1 || true
  
  # Send request and measure time
  START_TIME=$(date +%s%3N)
  
  RESPONSE=$(curl -s -X POST "$OPENCLAW_URL/api/v1/trading/decision" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $API_TOKEN" \
    -d "$REQUEST_PAYLOAD")
  
  END_TIME=$(date +%s%3N)
  LATENCY=$((END_TIME - START_TIME))
  
  # Extract processing time from response
  PROCESSING_TIME=$(echo "$RESPONSE" | jq -r '.processingTimeMs // 0')
  DECISIONS_COUNT=$(echo "$RESPONSE" | jq '.decisions | length')
  
  # Calculate verdict
  if [ "$LATENCY" -lt 15000 ]; then
    VERDICT="✅ LIVE READY"
  elif [ "$LATENCY" -lt 30000 ]; then
    VERDICT="⚠️ SWING ONLY"
  else
    VERDICT="❌ BACKTEST ONLY"
  fi
  
  # Print result
  printf "%-30s | Latency: %6d ms | Processing: %6d ms | %s\n" \
    "$label" "$LATENCY" "$PROCESSING_TIME" "$VERDICT"
  
  # Save to file
  echo "$label,$LATENCY,$PROCESSING_TIME,$VERDICT" >> "$RESULTS_FILE"
  
  # Wait between tests to avoid rate limiting
  sleep 2
}

# Initialize results file with header
echo "Model,Latency (ms),Processing (ms),Verdict" > "$RESULTS_FILE"

echo "Starting benchmark..."
echo ""
echo "Model                          | Latency        | Processing     | Verdict"
echo "-------------------------------|----------------|----------------|------------------"

# Test Sonnet with different thinking levels
test_model "sonnet" "low"
test_model "sonnet" "medium"
test_model "sonnet" "high"

# Test Opus with different thinking levels
test_model "opus" "low"
test_model "opus" "medium"
test_model "opus" "high"

echo ""
echo "========================================================================"
echo "Benchmark Complete!"
echo "========================================================================"
echo ""
echo "Results saved to: $RESULTS_FILE"
echo ""
echo "Summary:"
cat "$RESULTS_FILE" | column -t -s ','
echo ""
echo "Recommendation:"
echo "  • Live trading (< 15s):   Use Sonnet (low)"
echo "  • Swing trading (< 30s):  Sonnet (med/high) or Opus (low)"
echo "  • Backtesting (any):      Opus (high) for best quality"
echo ""
