package openclaw

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Client represents the OpenClaw API client
type Client struct {
	BaseURL    string
	APIToken   string
	HTTPClient *http.Client
}

// TradingRequest represents a trading decision request
type TradingRequest struct {
	SystemPrompt string `json:"systemPrompt"`
	UserPrompt   string `json:"userPrompt"`
	Metadata     struct {
		RequestID string   `json:"requestId,omitempty"`
		Timestamp string   `json:"timestamp,omitempty"`
		Exchange  string   `json:"exchange,omitempty"`
		Symbols   []string `json:"symbols,omitempty"`
	} `json:"metadata,omitempty"`
}

// TradingResponse represents the trading decision response
type TradingResponse struct {
	Decisions        []Decision `json:"decisions"`
	CoTTrace         string     `json:"cotTrace,omitempty"`
	Timestamp        string     `json:"timestamp"`
	ProcessingTimeMs int64      `json:"processingTimeMs,omitempty"`
	Error            string     `json:"error,omitempty"`
}

// Decision represents a single trading decision
type Decision struct {
	Symbol          string  `json:"symbol"`
	Action          string  `json:"action"`
	Leverage        int     `json:"leverage,omitempty"`
	PositionSizeUSD float64 `json:"positionSizeUsd,omitempty"`
	StopLoss        float64 `json:"stopLoss,omitempty"`
	TakeProfit      float64 `json:"takeProfit,omitempty"`
	Confidence      int     `json:"confidence,omitempty"`
	Reasoning       string  `json:"reasoning"`
}

// NewClient creates a new OpenClaw client
func NewClient(baseURL, apiToken string) *Client {
	return &Client{
		BaseURL:  baseURL,
		APIToken: apiToken,
		HTTPClient: &http.Client{
			Timeout: 120 * time.Second, // Same as other MCP clients
		},
	}
}

// GetTradingDecision requests a trading decision from OpenClaw/Leeloo
func (c *Client) GetTradingDecision(req *TradingRequest) (*TradingResponse, error) {
	// Marshal request to JSON
	jsonData, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	// Build HTTP request
	url := c.BaseURL + "/api/v1/trading/decision"
	httpReq, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	// Set headers
	httpReq.Header.Set("Content-Type", "application/json")
	if c.APIToken != "" {
		httpReq.Header.Set("Authorization", "Bearer "+c.APIToken)
	}

	// Send request
	resp, err := c.HTTPClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	// Read response body
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	// Check status code
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API error (status %d): %s", resp.StatusCode, string(body))
	}

	// Parse response
	var result TradingResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal response: %w, body: %s", err, string(body))
	}

	// Check for error in response
	if result.Error != "" {
		return &result, fmt.Errorf("OpenClaw error: %s", result.Error)
	}

	return &result, nil
}

// HealthCheck checks if the OpenClaw adapter is healthy
func (c *Client) HealthCheck() error {
	url := c.BaseURL + "/api/v1/trading/health"
	httpReq, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := c.HTTPClient.Do(httpReq)
	if err != nil {
		return fmt.Errorf("health check failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("health check failed (status %d): %s", resp.StatusCode, string(body))
	}

	return nil
}
