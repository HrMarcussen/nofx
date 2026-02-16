package mcp

import (
	"encoding/json"
	"fmt"
	"net/http"
	"nofx/logger"
	"nofx/openclaw"
	"time"
)

const (
	ProviderOpenClaw       = "openclaw"
	DefaultOpenClawBaseURL = "http://localhost:8888"
)

// OpenClawClient implements the AIClient interface using OpenClaw
type OpenClawClient struct {
	*Client
	oclawClient *openclaw.Client
}

// NewOpenClawClient creates a new OpenClaw AI client
//
// Usage examples:
//   // Basic usage
//   client := mcp.NewOpenClawClient()
//
//   // Custom configuration
//   client := mcp.NewOpenClawClient(
//       mcp.WithAPIKey("token123"),
//       mcp.WithBaseURL("http://localhost:8888"),
//   )
func NewOpenClawClient(opts ...ClientOption) AIClient {
	// 1. Create OpenClaw preset options
	openclawOpts := []ClientOption{
		WithProvider(ProviderOpenClaw),
		WithModel("claude-opus-leeloo"), // Informational only
		WithBaseURL(DefaultOpenClawBaseURL),
	}

	// 2. Merge user options (user options have higher priority)
	allOpts := append(openclawOpts, opts...)

	// 3. Create base client
	baseClient := NewClient(allOpts...).(*Client)

	// 4. Create OpenClaw HTTP client
	oclawHTTPClient := openclaw.NewClient(baseClient.BaseURL, baseClient.APIKey)

	// 5. Create OpenClaw client
	oclawClient := &OpenClawClient{
		Client:      baseClient,
		oclawClient: oclawHTTPClient,
	}

	// 6. Set hooks to point to this instance
	baseClient.hooks = oclawClient

	return oclawClient
}

// SetAPIKey configures the OpenClaw client (for MCP interface compatibility)
func (c *OpenClawClient) SetAPIKey(apiKey string, customURL string, customModel string) {
	if customURL != "" {
		c.BaseURL = customURL
		c.oclawClient.BaseURL = customURL
		c.logger.Infof("🔧 [MCP] OpenClaw using custom BaseURL: %s", customURL)
	} else {
		c.logger.Infof("🔧 [MCP] OpenClaw using default BaseURL: %s", c.BaseURL)
	}

	// For OpenClaw, "API key" is the auth token
	if apiKey != "" {
		c.APIKey = apiKey
		c.oclawClient.APIToken = apiKey
		if len(apiKey) > 8 {
			c.logger.Infof("🔧 [MCP] OpenClaw API Token: %s...%s", apiKey[:4], apiKey[len(apiKey)-4:])
		}
	}

	// Model name is informational only for OpenClaw
	if customModel != "" {
		c.Model = customModel
		c.logger.Infof("🔧 [MCP] OpenClaw model name (display only): %s", customModel)
	}
}

// call implements the MCP call interface using OpenClaw
func (c *OpenClawClient) call(systemPrompt, userPrompt string) (string, error) {
	c.logger.Infof("📡 [OpenClaw] Requesting trading decision from Leeloo")
	c.logger.Debugf("[OpenClaw] BaseURL: %s", c.BaseURL)

	// Build OpenClaw request
	req := &openclaw.TradingRequest{
		SystemPrompt: systemPrompt,
		UserPrompt:   userPrompt,
	}

	// Set metadata
	req.Metadata.RequestID = fmt.Sprintf("nofx-%d", time.Now().UnixNano())
	req.Metadata.Timestamp = time.Now().UTC().Format(time.RFC3339)

	startTime := time.Now()

	// Call OpenClaw
	resp, err := c.oclawClient.GetTradingDecision(req)
	if err != nil {
		return "", fmt.Errorf("OpenClaw request failed: %w", err)
	}

	processingTime := time.Since(startTime)
	c.logger.Infof("✓ [OpenClaw] Received %d trading decisions from Leeloo (took %v)", len(resp.Decisions), processingTime)

	// Log Chain of Thought if available
	if resp.CoTTrace != "" {
		c.logger.Debugf("[OpenClaw] Leeloo's Chain of Thought:\n%s", resp.CoTTrace)
	}

	// Convert openclaw.Decision (camelCase JSON) to kernel-compatible snake_case format.
	// The kernel expects: position_size_usd, stop_loss, take_profit (snake_case)
	// but openclaw.Decision marshals to: positionSizeUsd, stopLoss, takeProfit (camelCase).
	kernelDecisions := make([]map[string]interface{}, 0, len(resp.Decisions))
	for _, d := range resp.Decisions {
		kd := map[string]interface{}{
			"symbol":    d.Symbol,
			"action":    d.Action,
			"reasoning": d.Reasoning,
		}
		// Always include confidence if non-zero
		if d.Confidence > 0 {
			kd["confidence"] = d.Confidence
		}
		// Only include position fields for open actions
		if d.Action == "open_long" || d.Action == "open_short" {
			if d.Leverage > 0 {
				kd["leverage"] = d.Leverage
			}
			if d.PositionSizeUSD > 0 {
				kd["position_size_usd"] = d.PositionSizeUSD
			}
			if d.StopLoss > 0 {
				kd["stop_loss"] = d.StopLoss
			}
			if d.TakeProfit > 0 {
				kd["take_profit"] = d.TakeProfit
			}
		}
		kernelDecisions = append(kernelDecisions, kd)
	}
	decisionsJSON, err := json.Marshal(kernelDecisions)
	if err != nil {
		return "", fmt.Errorf("failed to marshal decisions: %w", err)
	}

	// Report token usage (OpenClaw doesn't charge, but track for monitoring)
	if TokenUsageCallback != nil {
		// Estimate tokens for monitoring purposes
		estimatedPromptTokens := len(systemPrompt)/4 + len(userPrompt)/4
		estimatedCompletionTokens := len(decisionsJSON) / 4
		TokenUsageCallback(TokenUsage{
			Provider:         "openclaw",
			Model:            c.Model,
			PromptTokens:     estimatedPromptTokens,
			CompletionTokens: estimatedCompletionTokens,
			TotalTokens:      estimatedPromptTokens + estimatedCompletionTokens,
		})
	}

	// Wrap in <reasoning> + <decision> tags that the kernel's extractDecisions() expects.
	// This matches the format returned by all other AI providers.
	var result string
	if resp.CoTTrace != "" {
		result = fmt.Sprintf("<reasoning>\n%s\n</reasoning>\n\n<decision>\n%s\n</decision>", resp.CoTTrace, string(decisionsJSON))
	} else {
		result = fmt.Sprintf("<decision>\n%s\n</decision>", string(decisionsJSON))
	}

	return result, nil
}

// buildMCPRequestBody - Not used for OpenClaw (override to prevent base implementation)
func (c *OpenClawClient) buildMCPRequestBody(systemPrompt, userPrompt string) map[string]any {
	// OpenClaw uses its own request format, not the generic MCP format
	return nil
}

// buildUrl - Not used for OpenClaw (request built in call method)
func (c *OpenClawClient) buildUrl() string {
	return c.BaseURL + "/api/v1/trading/decision"
}

// setAuthHeader - Not used (OpenClaw client handles auth internally)
func (c *OpenClawClient) setAuthHeader(reqHeaders http.Header) {
	// OpenClaw client handles auth internally
}

// parseMCPResponse - Not used (response handled in call method)
func (c *OpenClawClient) parseMCPResponse(body []byte) (string, error) {
	// Response parsing handled in call method
	return "", nil
}

// isRetryableError - Use default implementation from base Client
func (c *OpenClawClient) isRetryableError(err error) bool {
	return c.Client.isRetryableError(err)
}

// marshalRequestBody - Not used for OpenClaw
func (c *OpenClawClient) marshalRequestBody(requestBody map[string]any) ([]byte, error) {
	// OpenClaw uses custom marshaling in call method
	return nil, nil
}

// buildRequest - Not used for OpenClaw
func (c *OpenClawClient) buildRequest(url string, jsonData []byte) (*http.Request, error) {
	// Request building handled in call method
	return nil, nil
}

// HealthCheck performs a health check on the OpenClaw adapter
func (c *OpenClawClient) HealthCheck() error {
	err := c.oclawClient.HealthCheck()
	if err != nil {
		logger.Warnf("⚠️ [OpenClaw] Health check failed: %v", err)
		return err
	}
	logger.Infof("✓ [OpenClaw] Health check passed")
	return nil
}
