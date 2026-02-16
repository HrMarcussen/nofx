package mcp

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestOpenClawFullPipeline simulates the full NoFx pipeline:
// 1. OpenClaw adapter returns camelCase JSON (like the real JS adapter)
// 2. OpenClawClient.call() converts to snake_case with <decision> tags
// 3. Kernel's extractDecisions-style parsing recovers correct values
// 4. Kernel's validateDecision-style validation passes
//
// This is the end-to-end proof that the bug is fixed.
func TestOpenClawFullPipeline(t *testing.T) {
	// --- Step 1: Simulate JS adapter response (camelCase, as it really returns) ---
	adapterResponse := `{
		"decisions": [
			{
				"symbol": "BTCUSDT",
				"action": "open_long",
				"leverage": 5,
				"positionSizeUsd": 4100,
				"stopLoss": 67800,
				"takeProfit": 70500,
				"confidence": 82,
				"reasoning": "Multi-timeframe bullish, OI +6.5%, RSI 62"
			},
			{
				"symbol": "ETHUSDT",
				"action": "hold",
				"confidence": 80,
				"reasoning": "Profitable +2.2%, let it run"
			},
			{
				"symbol": "SOLUSDT",
				"action": "wait",
				"positionSizeUsd": 0,
				"confidence": 20,
				"reasoning": "No clear setup, consolidating"
			},
			{
				"symbol": "DOGEUSDT",
				"action": "close_short",
				"confidence": 90,
				"reasoning": "Hit take profit target"
			},
			{
				"symbol": "XRPUSDT",
				"action": "open_short",
				"leverage": 3,
				"positionSizeUsd": 2800,
				"stopLoss": 0.65,
				"takeProfit": 0.55,
				"confidence": 70,
				"reasoning": "Bearish divergence on 4H"
			}
		],
		"cotTrace": "1. Account equity: 10000 USDT\n2. BTC bullish setup detected\n3. SOL no clear direction",
		"timestamp": "2026-02-16T17:00:00Z",
		"processingTimeMs": 8500
	}`

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(adapterResponse))
	}))
	defer server.Close()

	// --- Step 2: Call OpenClawClient ---
	client := NewOpenClawClient(
		WithAPIKey("test-token"),
		WithBaseURL(server.URL),
	).(*OpenClawClient)

	result, err := client.call("test strategy", `{"account":{"equity":10000}}`)
	if err != nil {
		t.Fatalf("call() error: %v", err)
	}

	t.Logf("=== Full call() output ===\n%s\n===", result)

	// --- Step 3: Parse like the kernel does (extractDecisions) ---
	// Verify <reasoning> tag
	if !strings.Contains(result, "<reasoning>") {
		t.Fatal("Missing <reasoning> tag")
	}

	// Extract reasoning
	reasonStart := strings.Index(result, "<reasoning>") + len("<reasoning>")
	reasonEnd := strings.Index(result, "</reasoning>")
	reasoning := strings.TrimSpace(result[reasonStart:reasonEnd])
	if reasoning == "" {
		t.Error("Empty reasoning")
	}
	t.Logf("Reasoning: %s", reasoning)

	// Extract decision JSON
	decStart := strings.Index(result, "<decision>") + len("<decision>")
	decEnd := strings.Index(result, "</decision>")
	if decStart < 0 || decEnd < 0 {
		t.Fatal("Missing <decision> tags")
	}
	jsonStr := strings.TrimSpace(result[decStart:decEnd])

	// Kernel Decision struct (mirrors kernel/engine.go exactly)
	type KernelDecision struct {
		Symbol          string  `json:"symbol"`
		Action          string  `json:"action"`
		Leverage        int     `json:"leverage,omitempty"`
		PositionSizeUSD float64 `json:"position_size_usd,omitempty"`
		StopLoss        float64 `json:"stop_loss,omitempty"`
		TakeProfit      float64 `json:"take_profit,omitempty"`
		Confidence      int     `json:"confidence,omitempty"`
		Reasoning       string  `json:"reasoning"`
	}

	var decisions []KernelDecision
	if err := json.Unmarshal([]byte(jsonStr), &decisions); err != nil {
		t.Fatalf("Kernel JSON parse failed: %v\nJSON: %s", err, jsonStr)
	}

	if len(decisions) != 5 {
		t.Fatalf("Expected 5 decisions, got %d", len(decisions))
	}

	// --- Step 4: Validate like the kernel does (validateDecision) ---
	validActions := map[string]bool{
		"open_long": true, "open_short": true,
		"close_long": true, "close_short": true,
		"hold": true, "wait": true,
	}

	accountEquity := 10000.0
	maxLeverage := 10

	for i, d := range decisions {
		// Basic validation
		if d.Symbol == "" {
			t.Errorf("Decision %d: empty symbol", i)
		}
		if !validActions[d.Action] {
			t.Errorf("Decision %d: invalid action %q", i, d.Action)
		}
		if d.Reasoning == "" {
			t.Errorf("Decision %d: empty reasoning", i)
		}

		// Open action validation (mirrors kernel's validateDecision)
		if d.Action == "open_long" || d.Action == "open_short" {
			if d.Leverage <= 0 {
				t.Errorf("Decision %d (%s %s): leverage must be > 0, got %d",
					i, d.Symbol, d.Action, d.Leverage)
			}
			if d.Leverage > maxLeverage {
				t.Errorf("Decision %d (%s %s): leverage %d exceeds max %d",
					i, d.Symbol, d.Action, d.Leverage, maxLeverage)
			}
			// THIS IS THE ORIGINAL BUG CHECK
			if d.PositionSizeUSD <= 0 {
				t.Errorf("Decision %d (%s %s): position size must be greater than 0: %.2f (THIS IS THE BUG!)",
					i, d.Symbol, d.Action, d.PositionSizeUSD)
			}
			if d.PositionSizeUSD > accountEquity*0.5 {
				t.Logf("Decision %d (%s %s): position size %.2f exceeds 50%% of equity (warning only)",
					i, d.Symbol, d.Action, d.PositionSizeUSD)
			}
			if d.StopLoss <= 0 {
				t.Errorf("Decision %d (%s %s): stopLoss must be > 0, got %.2f",
					i, d.Symbol, d.Action, d.StopLoss)
			}
			if d.TakeProfit <= 0 {
				t.Errorf("Decision %d (%s %s): takeProfit must be > 0, got %.2f",
					i, d.Symbol, d.Action, d.TakeProfit)
			}
		}
	}

	// --- Specific checks per decision ---

	// Decision 0: BTCUSDT open_long
	btc := decisions[0]
	t.Logf("Decision 0: %s %s | leverage=%d size=%.2f SL=%.2f TP=%.2f conf=%d",
		btc.Symbol, btc.Action, btc.Leverage, btc.PositionSizeUSD, btc.StopLoss, btc.TakeProfit, btc.Confidence)
	assertEqual(t, "BTC symbol", btc.Symbol, "BTCUSDT")
	assertEqual(t, "BTC action", btc.Action, "open_long")
	assertEqualFloat(t, "BTC position_size_usd", btc.PositionSizeUSD, 4100)
	assertEqualFloat(t, "BTC stop_loss", btc.StopLoss, 67800)
	assertEqualFloat(t, "BTC take_profit", btc.TakeProfit, 70500)
	assertEqualInt(t, "BTC leverage", btc.Leverage, 5)
	assertEqualInt(t, "BTC confidence", btc.Confidence, 82)

	// Decision 1: ETHUSDT hold - no position fields
	eth := decisions[1]
	t.Logf("Decision 1: %s %s | conf=%d", eth.Symbol, eth.Action, eth.Confidence)
	assertEqual(t, "ETH action", eth.Action, "hold")
	assertEqualFloat(t, "ETH position_size_usd (should be 0)", eth.PositionSizeUSD, 0)
	assertEqualFloat(t, "ETH stop_loss (should be 0)", eth.StopLoss, 0)
	assertEqualFloat(t, "ETH take_profit (should be 0)", eth.TakeProfit, 0)
	assertEqualInt(t, "ETH leverage (should be 0)", eth.Leverage, 0)

	// Decision 2: SOLUSDT wait - THE BUG SCENARIO (adapter sent positionSizeUsd: 0)
	sol := decisions[2]
	t.Logf("Decision 2: %s %s | conf=%d (THE BUG SCENARIO)", sol.Symbol, sol.Action, sol.Confidence)
	assertEqual(t, "SOL action", sol.Action, "wait")
	assertEqualFloat(t, "SOL position_size_usd (MUST be 0, not sent)", sol.PositionSizeUSD, 0)

	// Decision 3: DOGEUSDT close_short
	doge := decisions[3]
	t.Logf("Decision 3: %s %s | conf=%d", doge.Symbol, doge.Action, doge.Confidence)
	assertEqual(t, "DOGE action", doge.Action, "close_short")

	// Decision 4: XRPUSDT open_short
	xrp := decisions[4]
	t.Logf("Decision 4: %s %s | leverage=%d size=%.2f SL=%.4f TP=%.4f conf=%d",
		xrp.Symbol, xrp.Action, xrp.Leverage, xrp.PositionSizeUSD, xrp.StopLoss, xrp.TakeProfit, xrp.Confidence)
	assertEqual(t, "XRP action", xrp.Action, "open_short")
	assertEqualFloat(t, "XRP position_size_usd", xrp.PositionSizeUSD, 2800)
	assertEqualFloat(t, "XRP stop_loss", xrp.StopLoss, 0.65)
	assertEqualFloat(t, "XRP take_profit", xrp.TakeProfit, 0.55)
	assertEqualInt(t, "XRP leverage", xrp.Leverage, 3)

	// Final verification: no camelCase keys in the JSON
	camelKeys := []string{`"positionSizeUsd"`, `"stopLoss"`, `"takeProfit"`}
	for _, key := range camelKeys {
		if strings.Contains(jsonStr, key) {
			t.Errorf("FAIL: Found camelCase key %s in output JSON!\nJSON: %s", key, jsonStr)
		}
	}

	t.Log("✅ FULL PIPELINE TEST PASSED - all decisions correctly formatted with snake_case keys")
	t.Logf("✅ BTCUSDT position_size_usd = %.2f (was 0.00 before fix)", btc.PositionSizeUSD)
	t.Logf("✅ SOLUSDT (wait) has no position fields (was positionSizeUsd: 0 before fix)")
}

func assertEqual(t *testing.T, field, got, want string) {
	t.Helper()
	if got != want {
		t.Errorf("%s: got %q, want %q", field, got, want)
	}
}

func assertEqualFloat(t *testing.T, field string, got, want float64) {
	t.Helper()
	if got != want {
		t.Errorf("%s: got %.6f, want %.6f", field, got, want)
	}
}

func assertEqualInt(t *testing.T, field string, got, want int) {
	t.Helper()
	if got != want {
		t.Errorf("%s: got %d, want %d", field, got, want)
	}
}

// TestBeforeAfterComparison shows the exact before/after JSON difference
func TestBeforeAfterComparison(t *testing.T) {
	// BEFORE (bug): openclaw.Decision marshaled directly → camelCase
	type OldDecision struct {
		Symbol          string  `json:"symbol"`
		Action          string  `json:"action"`
		Leverage        int     `json:"leverage,omitempty"`
		PositionSizeUSD float64 `json:"positionSizeUsd,omitempty"` // camelCase!
		StopLoss        float64 `json:"stopLoss,omitempty"`        // camelCase!
		TakeProfit      float64 `json:"takeProfit,omitempty"`      // camelCase!
		Confidence      int     `json:"confidence,omitempty"`
		Reasoning       string  `json:"reasoning"`
	}

	// AFTER (fix): kernel-compatible snake_case
	type KernelDecision struct {
		Symbol          string  `json:"symbol"`
		Action          string  `json:"action"`
		Leverage        int     `json:"leverage,omitempty"`
		PositionSizeUSD float64 `json:"position_size_usd,omitempty"` // snake_case ✅
		StopLoss        float64 `json:"stop_loss,omitempty"`         // snake_case ✅
		TakeProfit      float64 `json:"take_profit,omitempty"`       // snake_case ✅
		Confidence      int     `json:"confidence,omitempty"`
		Reasoning       string  `json:"reasoning"`
	}

	openLong := OldDecision{
		Symbol:          "BTCUSDT",
		Action:          "open_long",
		Leverage:        5,
		PositionSizeUSD: 4100,
		StopLoss:        67800,
		TakeProfit:      70500,
		Confidence:      82,
		Reasoning:       "Bullish",
	}

	// BEFORE: marshal with old struct
	beforeJSON, _ := json.MarshalIndent(openLong, "", "  ")

	// Try to parse with kernel struct (THIS WOULD FAIL)
	var kernelParsed KernelDecision
	json.Unmarshal(beforeJSON, &kernelParsed)

	t.Logf("=== BEFORE (BUG) ===")
	t.Logf("JSON from adapter:\n%s", string(beforeJSON))
	t.Logf("Kernel sees: PositionSizeUSD=%.2f, StopLoss=%.2f, TakeProfit=%.2f",
		kernelParsed.PositionSizeUSD, kernelParsed.StopLoss, kernelParsed.TakeProfit)
	t.Logf("⚠️  All zero! Kernel validation would fail: 'position size must be greater than 0: 0.00'")

	// AFTER: marshal with kernel-compatible struct
	afterDecision := KernelDecision{
		Symbol:          "BTCUSDT",
		Action:          "open_long",
		Leverage:        5,
		PositionSizeUSD: 4100,
		StopLoss:        67800,
		TakeProfit:      70500,
		Confidence:      82,
		Reasoning:       "Bullish",
	}
	afterJSON, _ := json.MarshalIndent(afterDecision, "", "  ")

	var kernelParsed2 KernelDecision
	json.Unmarshal(afterJSON, &kernelParsed2)

	t.Logf("\n=== AFTER (FIX) ===")
	t.Logf("JSON from adapter:\n%s", string(afterJSON))
	t.Logf("Kernel sees: PositionSizeUSD=%.2f, StopLoss=%.2f, TakeProfit=%.2f",
		kernelParsed2.PositionSizeUSD, kernelParsed2.StopLoss, kernelParsed2.TakeProfit)
	t.Logf("✅ All correct! Kernel validation passes.")

	// Verify the before was broken
	if kernelParsed.PositionSizeUSD != 0 {
		t.Error("BEFORE should have PositionSizeUSD=0 (demonstrating the bug)")
	}
	// Verify the after is fixed
	if kernelParsed2.PositionSizeUSD != 4100 {
		t.Errorf("AFTER should have PositionSizeUSD=4100, got %.2f", kernelParsed2.PositionSizeUSD)
	}

	// Show the key difference
	if !strings.Contains(string(beforeJSON), "positionSizeUsd") {
		t.Error("BEFORE JSON should contain camelCase 'positionSizeUsd'")
	}
	if !strings.Contains(string(afterJSON), "position_size_usd") {
		t.Error("AFTER JSON should contain snake_case 'position_size_usd'")
	}

	t.Logf("\n=== KEY DIFFERENCE ===")
	t.Logf("BEFORE: \"positionSizeUsd\": 4100  → kernel.PositionSizeUSD = 0.00 ❌")
	t.Logf("AFTER:  \"position_size_usd\": 4100 → kernel.PositionSizeUSD = 4100.00 ✅")

	// Demonstrate the WAIT bug too
	waitBefore := fmt.Sprintf(`{"symbol":"SOLUSDT","action":"wait","positionSizeUsd":0,"confidence":20,"reasoning":"No setup"}`)
	var waitKernel KernelDecision
	json.Unmarshal([]byte(waitBefore), &waitKernel)
	t.Logf("\nWAIT BEFORE: positionSizeUsd=0 in JSON → kernel ignores (different key) → stays 0.00")
	t.Logf("WAIT AFTER:  position_size_usd omitted entirely → kernel gets 0.00 (but action=wait, so no validation)")
}
