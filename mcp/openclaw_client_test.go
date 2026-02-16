package mcp

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"nofx/openclaw"
	"strings"
	"testing"
)

// TestOpenClawCallSnakeCaseOutput verifies that the call() method outputs
// kernel-compatible snake_case JSON keys, not the openclaw camelCase keys.
// This is the core fix for the "position size must be greater than 0: 0.00" bug.
func TestOpenClawCallSnakeCaseOutput(t *testing.T) {
	tests := []struct {
		name           string
		decisions      []openclaw.Decision
		wantKeys       map[string]bool   // keys that MUST be present in JSON
		wantAbsent     map[string]bool   // keys that MUST NOT be present in JSON
		wantSubstrings []string          // strings that must appear in output
	}{
		{
			name: "open_long decision uses snake_case keys",
			decisions: []openclaw.Decision{
				{
					Symbol:          "BTCUSDT",
					Action:          "open_long",
					Leverage:        5,
					PositionSizeUSD: 3500,
					StopLoss:        67800,
					TakeProfit:      70500,
					Confidence:      82,
					Reasoning:       "Bullish setup",
				},
			},
			wantKeys: map[string]bool{
				"position_size_usd": true,
				"stop_loss":         true,
				"take_profit":       true,
				"leverage":          true,
				"confidence":        true,
			},
			wantAbsent: map[string]bool{
				"positionSizeUsd": true,
				"stopLoss":        true,
				"takeProfit":      true,
			},
			wantSubstrings: []string{"<decision>", "</decision>"},
		},
		{
			name: "wait decision omits position fields",
			decisions: []openclaw.Decision{
				{
					Symbol:     "ETHUSDT",
					Action:     "wait",
					Confidence: 30,
					Reasoning:  "No clear setup",
				},
			},
			wantKeys: map[string]bool{
				"symbol":    true,
				"action":    true,
				"reasoning": true,
			},
			wantAbsent: map[string]bool{
				"position_size_usd": true,
				"positionSizeUsd":   true,
				"stop_loss":         true,
				"stopLoss":          true,
				"take_profit":       true,
				"takeProfit":        true,
				"leverage":          true,
			},
		},
		{
			name: "hold decision omits position fields",
			decisions: []openclaw.Decision{
				{
					Symbol:     "BTCUSDT",
					Action:     "hold",
					Confidence: 80,
					Reasoning:  "Profitable, let it run",
				},
			},
			wantAbsent: map[string]bool{
				"position_size_usd": true,
				"positionSizeUsd":   true,
				"stop_loss":         true,
				"stopLoss":          true,
				"take_profit":       true,
				"takeProfit":        true,
				"leverage":          true,
			},
		},
		{
			name: "close_long decision omits position fields",
			decisions: []openclaw.Decision{
				{
					Symbol:     "ETHUSDT",
					Action:     "close_long",
					Confidence: 90,
					Reasoning:  "Take profit hit",
				},
			},
			wantAbsent: map[string]bool{
				"position_size_usd": true,
				"positionSizeUsd":   true,
				"stop_loss":         true,
				"stopLoss":          true,
				"take_profit":       true,
				"takeProfit":        true,
				"leverage":          true,
			},
		},
		{
			name: "mixed decisions: open, wait, hold",
			decisions: []openclaw.Decision{
				{
					Symbol:          "BTCUSDT",
					Action:          "open_long",
					Leverage:        5,
					PositionSizeUSD: 3500,
					StopLoss:        67800,
					TakeProfit:      70500,
					Confidence:      82,
					Reasoning:       "Strong bullish",
				},
				{
					Symbol:     "ETHUSDT",
					Action:     "hold",
					Confidence: 75,
					Reasoning:  "Let it run",
				},
				{
					Symbol:     "SOLUSDT",
					Action:     "wait",
					Confidence: 20,
					Reasoning:  "No setup",
				},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create mock server that returns the test decisions
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				resp := openclaw.TradingResponse{
					Decisions: tt.decisions,
					CoTTrace:  "Test reasoning chain",
					Timestamp: "2026-02-16T17:00:00Z",
				}
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(resp)
			}))
			defer server.Close()

			// Create client
			client := NewOpenClawClient(
				WithAPIKey("test-token"),
				WithBaseURL(server.URL),
			).(*OpenClawClient)

			// Call
			result, err := client.call("test system", "test user")
			if err != nil {
				t.Fatalf("call() error: %v", err)
			}

			// Verify <decision> tags present
			if !strings.Contains(result, "<decision>") || !strings.Contains(result, "</decision>") {
				t.Errorf("Missing <decision> tags in output:\n%s", result)
			}

			// Verify <reasoning> tag present (since we set CoTTrace)
			if !strings.Contains(result, "<reasoning>") {
				t.Errorf("Missing <reasoning> tag in output:\n%s", result)
			}

			// Extract JSON from <decision> tags
			start := strings.Index(result, "<decision>") + len("<decision>")
			end := strings.Index(result, "</decision>")
			jsonStr := strings.TrimSpace(result[start:end])

			// Parse the JSON
			var decisions []map[string]interface{}
			if err := json.Unmarshal([]byte(jsonStr), &decisions); err != nil {
				t.Fatalf("Failed to parse decision JSON: %v\nJSON: %s", err, jsonStr)
			}

			// Verify expected keys present
			if tt.wantKeys != nil && len(decisions) > 0 {
				for key := range tt.wantKeys {
					if _, ok := decisions[0][key]; !ok {
						t.Errorf("Expected key %q not found in decision JSON.\nDecision: %+v", key, decisions[0])
					}
				}
			}

			// Verify absent keys not present (check in raw JSON string to catch both)
			if tt.wantAbsent != nil {
				for key := range tt.wantAbsent {
					if strings.Contains(jsonStr, fmt.Sprintf("%q", key)) {
						t.Errorf("Key %q should NOT be present in decision JSON.\nJSON: %s", key, jsonStr)
					}
				}
			}

			// Verify substrings
			for _, sub := range tt.wantSubstrings {
				if !strings.Contains(result, sub) {
					t.Errorf("Expected substring %q not found in output", sub)
				}
			}
		})
	}
}

// TestOpenClawCallPositionSizeNotZero specifically tests the original bug:
// when the AI returns a WAIT decision, positionSizeUsd should NOT appear
// in the output, preventing "position size must be greater than 0: 0.00".
func TestOpenClawCallPositionSizeNotZero(t *testing.T) {
	// Simulate what happens when AI returns wait with positionSizeUsd: 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Manually construct JSON with positionSizeUsd: 0 (the bug scenario)
		resp := `{
			"decisions": [
				{
					"symbol": "BTCUSDT",
					"action": "open_long",
					"leverage": 5,
					"positionSizeUsd": 3500,
					"stopLoss": 67800,
					"takeProfit": 70500,
					"confidence": 82,
					"reasoning": "Bullish"
				},
				{
					"symbol": "ETHUSDT",
					"action": "hold",
					"confidence": 80,
					"reasoning": "Let it run"
				},
				{
					"symbol": "SOLUSDT",
					"action": "wait",
					"positionSizeUsd": 0,
					"confidence": 20,
					"reasoning": "No setup"
				}
			],
			"cotTrace": "Analysis...",
			"timestamp": "2026-02-16T17:00:00Z"
		}`
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(resp))
	}))
	defer server.Close()

	client := NewOpenClawClient(
		WithAPIKey("test-token"),
		WithBaseURL(server.URL),
	).(*OpenClawClient)

	result, err := client.call("test system", "test user")
	if err != nil {
		t.Fatalf("call() error: %v", err)
	}

	// Extract JSON
	start := strings.Index(result, "<decision>") + len("<decision>")
	end := strings.Index(result, "</decision>")
	jsonStr := strings.TrimSpace(result[start:end])

	// Parse decisions
	var decisions []map[string]interface{}
	if err := json.Unmarshal([]byte(jsonStr), &decisions); err != nil {
		t.Fatalf("Failed to parse JSON: %v\nJSON: %s", err, jsonStr)
	}

	if len(decisions) != 3 {
		t.Fatalf("Expected 3 decisions, got %d", len(decisions))
	}

	// Decision 0: open_long - MUST have position_size_usd (snake_case, not camelCase)
	d0 := decisions[0]
	if d0["action"] != "open_long" {
		t.Errorf("Decision 0: expected open_long, got %v", d0["action"])
	}
	if _, ok := d0["position_size_usd"]; !ok {
		t.Errorf("Decision 0 (open_long): missing position_size_usd")
	}
	if v, ok := d0["position_size_usd"]; ok {
		if v.(float64) != 3500 {
			t.Errorf("Decision 0: expected position_size_usd=3500, got %v", v)
		}
	}
	if _, ok := d0["stop_loss"]; !ok {
		t.Errorf("Decision 0 (open_long): missing stop_loss")
	}
	if _, ok := d0["take_profit"]; !ok {
		t.Errorf("Decision 0 (open_long): missing take_profit")
	}

	// Decision 1: hold - MUST NOT have position fields
	d1 := decisions[1]
	if d1["action"] != "hold" {
		t.Errorf("Decision 1: expected hold, got %v", d1["action"])
	}
	for _, key := range []string{"position_size_usd", "positionSizeUsd", "stop_loss", "stopLoss", "take_profit", "takeProfit", "leverage"} {
		if _, ok := d1[key]; ok {
			t.Errorf("Decision 1 (hold): should NOT have key %q, but found it with value %v", key, d1[key])
		}
	}

	// Decision 2: wait - MUST NOT have position fields (this was the original bug!)
	d2 := decisions[2]
	if d2["action"] != "wait" {
		t.Errorf("Decision 2: expected wait, got %v", d2["action"])
	}
	for _, key := range []string{"position_size_usd", "positionSizeUsd", "stop_loss", "stopLoss", "take_profit", "takeProfit", "leverage"} {
		if _, ok := d2[key]; ok {
			t.Errorf("Decision 2 (wait): should NOT have key %q, but found it with value %v (THIS IS THE ORIGINAL BUG!)", key, d2[key])
		}
	}

	// Verify no camelCase keys anywhere in the JSON
	camelCaseKeys := []string{"positionSizeUsd", "stopLoss", "takeProfit"}
	for _, key := range camelCaseKeys {
		if strings.Contains(jsonStr, key) {
			t.Errorf("Found camelCase key %q in output JSON - should be snake_case!\nJSON: %s", key, jsonStr)
		}
	}

	t.Logf("✅ Output JSON (correct snake_case format):\n%s", jsonStr)
}

// TestOpenClawCallKernelCompatibility tests that the output can be parsed
// by the kernel's Decision struct (using snake_case JSON tags).
func TestOpenClawCallKernelCompatibility(t *testing.T) {
	// This struct mirrors kernel.Decision (from kernel/engine.go)
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

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := openclaw.TradingResponse{
			Decisions: []openclaw.Decision{
				{
					Symbol:          "BTCUSDT",
					Action:          "open_long",
					Leverage:        5,
					PositionSizeUSD: 4100,
					StopLoss:        67800,
					TakeProfit:      70500,
					Confidence:      82,
					Reasoning:       "Bullish setup",
				},
				{
					Symbol:     "ETHUSDT",
					Action:     "wait",
					Confidence: 25,
					Reasoning:  "No clear signal",
				},
			},
			CoTTrace:  "Market analysis...",
			Timestamp: "2026-02-16T17:00:00Z",
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := NewOpenClawClient(
		WithAPIKey("test-token"),
		WithBaseURL(server.URL),
	).(*OpenClawClient)

	result, err := client.call("test system", "test user")
	if err != nil {
		t.Fatalf("call() error: %v", err)
	}

	// Extract JSON from <decision> tag
	start := strings.Index(result, "<decision>") + len("<decision>")
	end := strings.Index(result, "</decision>")
	jsonStr := strings.TrimSpace(result[start:end])

	// Parse into kernel-compatible struct
	var decisions []KernelDecision
	if err := json.Unmarshal([]byte(jsonStr), &decisions); err != nil {
		t.Fatalf("Failed to parse into KernelDecision: %v\nJSON: %s", err, jsonStr)
	}

	if len(decisions) != 2 {
		t.Fatalf("Expected 2 decisions, got %d", len(decisions))
	}

	// Verify open_long decision has correct values
	btc := decisions[0]
	if btc.Symbol != "BTCUSDT" || btc.Action != "open_long" {
		t.Errorf("Decision 0: expected BTCUSDT open_long, got %s %s", btc.Symbol, btc.Action)
	}
	if btc.PositionSizeUSD != 4100 {
		t.Errorf("Decision 0: expected PositionSizeUSD=4100, got %.2f (THE ORIGINAL BUG WOULD SHOW 0.00 HERE)", btc.PositionSizeUSD)
	}
	if btc.StopLoss != 67800 {
		t.Errorf("Decision 0: expected StopLoss=67800, got %.2f", btc.StopLoss)
	}
	if btc.TakeProfit != 70500 {
		t.Errorf("Decision 0: expected TakeProfit=70500, got %.2f", btc.TakeProfit)
	}
	if btc.Leverage != 5 {
		t.Errorf("Decision 0: expected Leverage=5, got %d", btc.Leverage)
	}
	if btc.Confidence != 82 {
		t.Errorf("Decision 0: expected Confidence=82, got %d", btc.Confidence)
	}

	// Verify wait decision has zero position fields (omitted via omitempty)
	eth := decisions[1]
	if eth.Symbol != "ETHUSDT" || eth.Action != "wait" {
		t.Errorf("Decision 1: expected ETHUSDT wait, got %s %s", eth.Symbol, eth.Action)
	}
	if eth.PositionSizeUSD != 0 {
		t.Errorf("Decision 1 (wait): expected PositionSizeUSD=0, got %.2f", eth.PositionSizeUSD)
	}
	if eth.StopLoss != 0 {
		t.Errorf("Decision 1 (wait): expected StopLoss=0, got %.2f", eth.StopLoss)
	}
	if eth.TakeProfit != 0 {
		t.Errorf("Decision 1 (wait): expected TakeProfit=0, got %.2f", eth.TakeProfit)
	}
	if eth.Leverage != 0 {
		t.Errorf("Decision 1 (wait): expected Leverage=0, got %d", eth.Leverage)
	}

	t.Logf("✅ Kernel-compatible output:\n%s", jsonStr)
	t.Logf("✅ BTC decision: PositionSizeUSD=%.2f (was 0.00 before fix)", btc.PositionSizeUSD)
}

// TestOpenClawCallNoReasoningTag verifies output when CoTTrace is empty
func TestOpenClawCallNoReasoningTag(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := openclaw.TradingResponse{
			Decisions: []openclaw.Decision{
				{
					Symbol:     "BTCUSDT",
					Action:     "wait",
					Confidence: 20,
					Reasoning:  "No setup",
				},
			},
			CoTTrace:  "", // Empty CoT
			Timestamp: "2026-02-16T17:00:00Z",
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := NewOpenClawClient(
		WithAPIKey("test-token"),
		WithBaseURL(server.URL),
	).(*OpenClawClient)

	result, err := client.call("test system", "test user")
	if err != nil {
		t.Fatalf("call() error: %v", err)
	}

	// Should have <decision> but NOT <reasoning>
	if !strings.Contains(result, "<decision>") {
		t.Error("Missing <decision> tag")
	}
	if strings.Contains(result, "<reasoning>") {
		t.Error("Should NOT have <reasoning> tag when CoTTrace is empty")
	}
}

// TestOpenClawSanitizeForNoFx verifies that problematic characters are stripped
// from reasoning text before being sent to NoFx's strict JSON validator.
// This fixes the "JSON cannot contain range symbol ~" error.
func TestOpenClawSanitizeForNoFx(t *testing.T) {
	tests := []struct {
		name               string
		cotTrace           string
		reasoning          string
		wantCoTContains    []string
		wantCoTNotContains []string
		wantJSONContains   []string
		wantJSONNotContains []string
	}{
		{
			name:      "tilde in reasoning and CoT",
			cotTrace:  "Market cap ~255M total, expecting ~10% growth",
			reasoning: "Position size ~3500 USD with ~5x leverage",
			wantCoTContains: []string{
				"Market cap 255M total",
				"expecting 10% growth",
			},
			wantCoTNotContains: []string{"~"},
			wantJSONContains: []string{
				`"reasoning":"Position size 3500 USD with 5x leverage"`,
			},
			wantJSONNotContains: []string{"~"},
		},
		{
			name:      "plus-minus symbol",
			cotTrace:  "Expected return ±15% over 3 months",
			reasoning: "Risk tolerance ±10%",
			wantCoTContains: []string{
				"Expected return 15%",
			},
			wantCoTNotContains: []string{"±"},
			wantJSONContains: []string{
				`"reasoning":"Risk tolerance 10%"`,
			},
			wantJSONNotContains: []string{"±"},
		},
		{
			name:      "approximately equal symbol",
			cotTrace:  "Current price ≈68500 USD",
			reasoning: "Target ≈70000",
			wantCoTContains: []string{
				"Current price 68500",
			},
			wantCoTNotContains: []string{"≈"},
			wantJSONContains: []string{
				`"reasoning":"Target 70000"`,
			},
			wantJSONNotContains: []string{"≈"},
		},
		{
			name:      "ellipsis (should convert to three dots)",
			cotTrace:  "Analyzing trends…waiting for confirmation…",
			reasoning: "Setup forming…",
			wantCoTContains: []string{
				"Analyzing trends...waiting for confirmation...",
			},
			wantCoTNotContains: []string{"…"},
			wantJSONContains: []string{
				`"reasoning":"Setup forming..."`,
			},
			wantJSONNotContains: []string{"…"},
		},
		{
			name:      "mixed problematic characters",
			cotTrace:  "BTC ~68500 ±500, ETH ≈3500, waiting…",
			reasoning: "~255M market cap, ±10% variance, ≈50K target…",
			wantCoTContains: []string{
				"BTC 68500 500",
				"ETH 3500",
				"waiting...",
			},
			wantCoTNotContains: []string{"~", "±", "≈", "…"},
			wantJSONContains: []string{
				`255M market cap`,
				`10% variance`,
				`50K target...`,
			},
			wantJSONNotContains: []string{"~", "±", "≈", "…"},
		},
		{
			name:      "clean text (no sanitization needed)",
			cotTrace:  "Market cap 255M total, expecting 10% growth",
			reasoning: "Position size 3500 USD with 5x leverage",
			wantCoTContains: []string{
				"Market cap 255M total",
				"expecting 10% growth",
			},
			wantJSONContains: []string{
				`"reasoning":"Position size 3500 USD with 5x leverage"`,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create mock server that returns decisions with problematic characters
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				resp := openclaw.TradingResponse{
					Decisions: []openclaw.Decision{
						{
							Symbol:          "BTCUSDT",
							Action:          "open_long",
							Leverage:        5,
							PositionSizeUSD: 3500,
							StopLoss:        67800,
							TakeProfit:      70500,
							Confidence:      82,
							Reasoning:       tt.reasoning, // Contains problematic chars
						},
					},
					CoTTrace:  tt.cotTrace, // Contains problematic chars
					Timestamp: "2026-02-16T17:00:00Z",
				}
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(resp)
			}))
			defer server.Close()

			// Create client
			client := NewOpenClawClient(
				WithAPIKey("test-token"),
				WithBaseURL(server.URL),
			).(*OpenClawClient)

			// Call
			result, err := client.call("test system", "test user")
			if err != nil {
				t.Fatalf("call() error: %v", err)
			}

			// Extract reasoning section
			if reasoningStart := strings.Index(result, "<reasoning>"); reasoningStart >= 0 {
				reasoningEnd := strings.Index(result, "</reasoning>")
				reasoningSection := result[reasoningStart:reasoningEnd]

				// Verify CoT contains expected sanitized strings
				for _, want := range tt.wantCoTContains {
					if !strings.Contains(reasoningSection, want) {
						t.Errorf("CoT section should contain %q\nGot: %s", want, reasoningSection)
					}
				}

				// Verify CoT does NOT contain problematic characters
				for _, notWant := range tt.wantCoTNotContains {
					if strings.Contains(reasoningSection, notWant) {
						t.Errorf("CoT section should NOT contain %q (should be sanitized)\nGot: %s", notWant, reasoningSection)
					}
				}
			}

			// Extract JSON from <decision> tags
			decisionStart := strings.Index(result, "<decision>") + len("<decision>")
			decisionEnd := strings.Index(result, "</decision>")
			jsonStr := strings.TrimSpace(result[decisionStart:decisionEnd])

			// Verify JSON contains expected sanitized strings
			for _, want := range tt.wantJSONContains {
				if !strings.Contains(jsonStr, want) {
					t.Errorf("JSON should contain %q\nGot: %s", want, jsonStr)
				}
			}

			// Verify JSON does NOT contain problematic characters
			for _, notWant := range tt.wantJSONNotContains {
				if strings.Contains(jsonStr, notWant) {
					t.Errorf("JSON should NOT contain %q (should be sanitized)\nGot: %s", notWant, jsonStr)
				}
			}

			// Verify JSON is valid
			var decisions []map[string]interface{}
			if err := json.Unmarshal([]byte(jsonStr), &decisions); err != nil {
				t.Fatalf("Failed to parse sanitized JSON: %v\nJSON: %s", err, jsonStr)
			}

			t.Logf("✅ Sanitized output (no ~, ±, ≈, … characters):\n%s", result)
		})
	}
}

// TestSanitizeForNoFx tests the sanitization function directly
func TestSanitizeForNoFx(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"~255M total", "255M total"},
		{"±10% variance", "10% variance"},
		{"≈50K target", "50K target"},
		{"waiting…", "waiting..."},
		{"~255M ±10% ≈50K…", "255M 10% 50K..."},
		{"clean text", "clean text"},
		{"", ""},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := sanitizeForNoFx(tt.input)
			if result != tt.expected {
				t.Errorf("sanitizeForNoFx(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}
