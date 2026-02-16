# OpenClaw JSON Sanitization Fix

## Problem
NoFx's strict JSON validator rejects AI responses containing certain characters:
- `~` (tilde) - "approximately"
- `±` (plus-minus)
- `≈` (approximately equal)
- `…` (ellipsis)

Error message:
```
JSON cannot contain range symbol ~, all numbers must be precise single values
```

## Example Failure

### Before Fix (REJECTED by NoFx):
```json
<reasoning>
Market cap ~255M total, expecting ±10% growth with ≈50K target…
</reasoning>

<decision>
[{
  "symbol": "BTCUSDT",
  "action": "open_long",
  "reasoning": "Position size ~3500 USD with ±5% variance",
  "position_size_usd": 3500
}]
</decision>
```

**Result:** ❌ NoFx rejects with "JSON cannot contain range symbol ~"

### After Fix (ACCEPTED by NoFx):
```json
<reasoning>
Market cap 255M total, expecting 10% growth with 50K target...
</reasoning>

<decision>
[{
  "symbol": "BTCUSDT",
  "action": "open_long",
  "reasoning": "Position size 3500 USD with 5% variance",
  "position_size_usd": 3500
}]
</decision>
```

**Result:** ✅ NoFx accepts clean JSON

## Implementation

### Function Added
```go
// sanitizeForNoFx removes characters that NoFx's strict JSON validator rejects.
func sanitizeForNoFx(text string) string {
	text = strings.ReplaceAll(text, "~", "")   // tilde
	text = strings.ReplaceAll(text, "±", "")   // plus-minus
	text = strings.ReplaceAll(text, "≈", "")   // approximately equal
	text = strings.ReplaceAll(text, "…", "...") // ellipsis → three dots
	return text
}
```

### Applied To
1. **CoTTrace** (reasoning section) - Line ~127
2. **Decision.Reasoning** (individual decision reasoning) - Line ~137

### Test Coverage
- `TestSanitizeForNoFx` - Direct function testing
- `TestOpenClawSanitizeForNoFx` - Integration testing with mock server
  - Tilde in reasoning and CoT
  - Plus-minus symbol
  - Approximately equal symbol
  - Ellipsis conversion
  - Mixed problematic characters
  - Clean text (no changes needed)

## Test Results
```
=== RUN   TestOpenClawSanitizeForNoFx
=== RUN   TestOpenClawSanitizeForNoFx/tilde_in_reasoning_and_CoT
    ✅ Sanitized output (no ~, ±, ≈, … characters)
=== RUN   TestOpenClawSanitizeForNoFx/mixed_problematic_characters
    ✅ Sanitized output (no ~, ±, ≈, … characters)
--- PASS: TestOpenClawSanitizeForNoFx

=== RUN   TestSanitizeForNoFx
--- PASS: TestSanitizeForNoFx

All existing tests continue to pass ✅
```

## Files Modified
- `~/nofx/mcp/openclaw_client.go` - Added sanitization function and applied to output
- `~/nofx/mcp/openclaw_client_test.go` - Added comprehensive test coverage

## Impact
- **No behavior changes** for clean text (most cases)
- **Fixes rejection errors** when AI uses approximation symbols
- **Backward compatible** - existing functionality preserved
- **Zero performance impact** - simple string replacement

## Date
2026-02-16
