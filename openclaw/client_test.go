package openclaw

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestGetTradingDecision(t *testing.T) {
	// Create mock server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify request
		if r.Method != "POST" {
			t.Errorf("Expected POST, got %s", r.Method)
		}
		if r.URL.Path != "/api/v1/trading/decision" {
			t.Errorf("Expected /api/v1/trading/decision, got %s", r.URL.Path)
		}

		// Parse request
		var req TradingRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("Failed to decode request: %v", err)
		}

		// Verify request content
		if req.SystemPrompt == "" {
			t.Error("Missing system prompt")
		}
		if req.UserPrompt == "" {
			t.Error("Missing user prompt")
		}

		// Send mock response
		resp := TradingResponse{
			Decisions: []Decision{
				{
					Symbol:          "ETHUSDT",
					Action:          "open_long",
					Leverage:        3,
					PositionSizeUSD: 500,
					StopLoss:        2450,
					TakeProfit:      2650,
					Confidence:      75,
					Reasoning:       "Test trade decision",
				},
			},
			CoTTrace:  "Test reasoning",
			Timestamp: time.Now().UTC().Format(time.RFC3339),
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	// Create client pointing to mock server
	client := NewClient(server.URL, "test-token")

	// Make request
	req := &TradingRequest{
		SystemPrompt: "Test strategy",
		UserPrompt:   `{"account": {"equity": 10000}}`,
	}

	resp, err := client.GetTradingDecision(req)
	if err != nil {
		t.Fatalf("GetTradingDecision failed: %v", err)
	}

	// Verify response
	if len(resp.Decisions) != 1 {
		t.Errorf("Expected 1 decision, got %d", len(resp.Decisions))
	}

	decision := resp.Decisions[0]
	if decision.Symbol != "ETHUSDT" {
		t.Errorf("Expected ETHUSDT, got %s", decision.Symbol)
	}
	if decision.Action != "open_long" {
		t.Errorf("Expected open_long, got %s", decision.Action)
	}
	if decision.Confidence != 75 {
		t.Errorf("Expected confidence 75, got %d", decision.Confidence)
	}
}

func TestGetTradingDecisionError(t *testing.T) {
	// Create mock server that returns error
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("Internal server error"))
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-token")
	req := &TradingRequest{
		SystemPrompt: "Test strategy",
		UserPrompt:   "{}",
	}

	_, err := client.GetTradingDecision(req)
	if err == nil {
		t.Error("Expected error, got nil")
	}
}

func TestHealthCheck(t *testing.T) {
	// Create mock server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/trading/health" {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"status":"healthy"}`))
		} else {
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	client := NewClient(server.URL, "")
	err := client.HealthCheck()
	if err != nil {
		t.Errorf("HealthCheck failed: %v", err)
	}
}
