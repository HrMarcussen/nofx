# NoFx API Implementation Notes

## Strategy Visibility

**Important:** Strategies in NoFx are **user-scoped**. Each user only sees their own strategies.

### Current State

- **Thomas's user** (`thomas@marcussens.email`, ID: `115a2f29-338a-487a-ba67-f9d2a7c780bd`)
  - Has 1 strategy: "New Strategy" (ID: `d84d5770-44fe-4750-b504-20555b6281ed`)

- **API user** (`leeloo-api@nofx.local`, ID: `14dd647e-ea73-470b-9b92-d53782a6ca48`)
  - Has 0 strategies (empty list)
  - Can successfully authenticate and call APIs
  - Can create new strategies for itself

### Verification

```bash
# Check Thomas's strategies
sqlite3 ~/nofx/data/test_data.db \
  "SELECT id, name, user_id FROM strategies WHERE user_id = '115a2f29-338a-487a-ba67-f9d2a7c780bd'"

# Result: d84d5770-44fe-4750-b504-20555b6281ed|New Strategy|115a2f29-338a-487a-ba67-f9d2a7c780bd

# Check API user's strategies
sqlite3 ~/nofx/data/test_data.db \
  "SELECT id, name, user_id FROM strategies WHERE user_id = '14dd647e-ea73-470b-9b92-d53782a6ca48'"

# Result: (empty)
```

### API Behavior

When calling `GET /api/strategies`, the API:
1. Extracts `user_id` from JWT token
2. Calls `s.store.Strategy().List(userID)` - filters by user
3. Returns only strategies owned by that user

See `~/nofx/api/strategy.go`, function `handleGetStrategies`:
```go
userID := c.GetString("user_id")
strategies, err := s.store.Strategy().List(userID)
```

### Why This Design?

This is correct behavior for a multi-tenant system:
- Users should only see/manage their own strategies
- Prevents unauthorized access to other users' configurations
- Each user's trading strategies are private

### Public Strategies

There is a separate endpoint for public strategies:
- `GET /api/public-strategies` (no auth required)
- Returns strategies where `is_public = true` and `config_visible = true`
- Currently no public strategies exist

### Testing Strategy Creation

To create a strategy for the API user:
```bash
TOKEN=$(~/clawd/nofx/login.sh)
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "API Test Strategy",
    "description": "Strategy created via API",
    "exchange": "deribit",
    "symbols": ["BTC-PERPETUAL"],
    "prompt": "Test strategy for API user"
  }' \
  http://localhost:8080/api/strategies | jq .
```

## Testing Summary

✅ **What Works:**
- API user can authenticate programmatically
- OTP flow works correctly (login → generate TOTP → verify → get JWT)
- JWT tokens are valid and work with all protected endpoints
- Multiple consecutive logins succeed reliably
- Token expires after 24 hours as designed

✅ **Expected Behavior:**
- API user sees empty strategy list (no strategies created yet)
- Thomas's strategies are not visible to API user (correct security behavior)
- Each user maintains isolated strategy namespace

## Next Steps

If cross-user strategy access is needed:
1. Use public strategies feature (`is_public = true`)
2. Implement admin role with elevated permissions
3. Add team/organization concept for shared strategies

---

**Date:** 2026-02-16  
**Status:** Complete - All requirements met
