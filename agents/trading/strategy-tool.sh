#!/bin/bash
# NoFx Strategy Management Tool
# Usage: ./strategy-tool.sh <command> [args]
#
# Commands:
#   list                    - List all strategies
#   get <id>               - Get strategy details
#   get-active             - Get active strategy config
#   update <id> <json>     - Update strategy config (partial)
#   create <name> <desc>   - Create new strategy (copies v1.2 as template)
#   activate <id>          - Activate a strategy
#   risk <id>              - Show risk control parameters
#   set-risk <id> <param> <value> - Update a single risk parameter
#
# Examples:
#   ./strategy-tool.sh list
#   ./strategy-tool.sh risk ab2e26e5-26cf-48a8-bc28-b6f01d86ac47
#   ./strategy-tool.sh set-risk ab2e26e5 min_confidence 70
#   ./strategy-tool.sh set-risk ab2e26e5 max_positions 5

set -euo pipefail

NOFX_API="http://localhost:8080/api"
LOGIN_SCRIPT="$HOME/clawd/nofx/login.py"

# Get auth token
get_token() {
    python3 "$LOGIN_SCRIPT" 2>/dev/null | grep -o 'eyJ[^"]*'
}

TOKEN=$(get_token)
AUTH="Authorization: Bearer $TOKEN"

case "${1:-help}" in
    list)
        curl -s -H "$AUTH" "$NOFX_API/strategies" | python3 -c "
import sys, json
data = json.load(sys.stdin)
strategies = data.get('strategies', [])
if not strategies:
    print('No strategies found.')
else:
    print(f'{'ID':<40} {'Name':<35} {'Active':<8} {'Default':<8}')
    print('-' * 91)
    for s in strategies:
        print(f\"{s['id']:<40} {s['name']:<35} {str(s.get('is_active',False)):<8} {str(s.get('is_default',False)):<8}\")
"
        ;;

    get)
        ID="${2:?Strategy ID required}"
        curl -s -H "$AUTH" "$NOFX_API/strategies/$ID" | python3 -m json.tool
        ;;

    get-active)
        curl -s -H "$AUTH" "$NOFX_API/strategies/active" | python3 -m json.tool
        ;;

    risk)
        ID="${2:?Strategy ID required}"
        curl -s -H "$AUTH" "$NOFX_API/strategies/$ID" | python3 -c "
import sys, json
s = json.load(sys.stdin)
config = json.loads(s['config']) if isinstance(s['config'], str) else s['config']
rc = config.get('risk_control', {})
tiers = config.get('prompt_sections', {}).get('confidence_tiers', 'N/A')
print(f\"Strategy: {s['name']}\")
print(f\"{'─' * 40}\")
print(f\"  min_confidence:                {rc.get('min_confidence')}%\")
print(f\"  max_positions:                 {rc.get('max_positions')}\")
print(f\"  btc_eth_max_leverage:          {rc.get('btc_eth_max_leverage')}x\")
print(f\"  altcoin_max_leverage:          {rc.get('altcoin_max_leverage')}x\")
print(f\"  min_risk_reward_ratio:         {rc.get('min_risk_reward_ratio')}:1\")
print(f\"  min_position_size:             \${rc.get('min_position_size')}\")
print(f\"  max_margin_usage:              {rc.get('max_margin_usage', 0)*100}%\")
print(f\"  btc_eth_max_position_value:    {rc.get('btc_eth_max_position_value_ratio')}x equity\")
print(f\"  altcoin_max_position_value:    {rc.get('altcoin_max_position_value_ratio')}x equity\")
print()
print('Confidence Tiers:')
print(tiers[:500] if isinstance(tiers, str) else 'N/A')
"
        ;;

    set-risk)
        ID="${2:?Strategy ID required}"
        PARAM="${3:?Parameter name required (e.g. min_confidence)}"
        VALUE="${4:?Value required}"
        
        # Get current config
        CURRENT=$(curl -s -H "$AUTH" "$NOFX_API/strategies/$ID")
        
        # Update risk_control parameter
        UPDATED=$(echo "$CURRENT" | python3 -c "
import sys, json
s = json.load(sys.stdin)
config = json.loads(s['config']) if isinstance(s['config'], str) else s['config']
param = '$PARAM'
value = '$VALUE'

# Auto-detect type
try:
    if '.' in value:
        value = float(value)
    else:
        value = int(value)
except ValueError:
    pass

old = config.get('risk_control', {}).get(param, 'NOT SET')
config['risk_control'][param] = value
print(json.dumps({'config': json.dumps(config)}))
import sys as _sys
print(f'Changed {param}: {old} → {value}', file=_sys.stderr)
" 2>&1)
        
        # Build update payload (config as object, not string)
        echo "$CURRENT" | python3 -c "
import sys, json
s = json.load(sys.stdin)
config = json.loads(s['config']) if isinstance(s['config'], str) else s['config']
param = '$PARAM'
value = '$VALUE'
try:
    if '.' in value: value = float(value)
    else: value = int(value)
except ValueError: pass
old = config.get('risk_control', {}).get(param, 'NOT SET')
config['risk_control'][param] = value
payload = {
    'name': s.get('name', ''),
    'description': s.get('description', ''),
    'config': config,
    'is_public': s.get('is_public', False),
    'config_visible': s.get('config_visible', True)
}
with open('/tmp/strategy-update.json', 'w') as f:
    json.dump(payload, f)
print(f'✅ {param}: {old} → {value}')
"
        # Apply update
        RESULT=$(curl -s -X PUT -H "$AUTH" -H "Content-Type: application/json" \
            "$NOFX_API/strategies/$ID" -d @/tmp/strategy-update.json)
        
        echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('message','Done'))"
        ;;

    create)
        NAME="${2:?Strategy name required}"
        DESC="${3:-Created by trading team}"
        
        # Get default config from v1.2 template
        DEFAULT_CONFIG=$(sqlite3 "$HOME/nofx/data/test_data.db" \
            "SELECT config FROM strategies WHERE name LIKE '%1.2%' LIMIT 1;")
        
        curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" \
            "$NOFX_API/strategies" \
            -d "{\"name\": \"$NAME\", \"description\": \"$DESC\", \"config\": $DEFAULT_CONFIG}" \
            | python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"Created: {d.get('id')} — {d.get('message')}\")"
        ;;

    activate)
        ID="${2:?Strategy ID required}"
        curl -s -X POST -H "$AUTH" "$NOFX_API/strategies/$ID/activate" \
            | python3 -c "import sys,json; print(json.load(sys.stdin).get('message','Done'))"
        ;;

    help|*)
        echo "NoFx Strategy Management Tool"
        echo ""
        echo "Usage: $0 <command> [args]"
        echo ""
        echo "Commands:"
        echo "  list                         List all strategies"
        echo "  get <id>                     Get full strategy JSON"
        echo "  get-active                   Get active strategy"
        echo "  risk <id>                    Show risk control parameters"
        echo "  set-risk <id> <param> <val>  Update risk parameter"
        echo "  create <name> [desc]         Create strategy (from v1.2 template)"
        echo "  activate <id>                Activate strategy"
        echo ""
        echo "Risk parameters: min_confidence, max_positions, btc_eth_max_leverage,"
        echo "  altcoin_max_leverage, min_risk_reward_ratio, min_position_size,"
        echo "  max_margin_usage, btc_eth_max_position_value_ratio,"
        echo "  altcoin_max_position_value_ratio"
        ;;
esac
