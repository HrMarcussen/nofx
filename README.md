# NoFx Strategy Management

## Backup System

### Automatic Export
```bash
~/clawd/nofx/export_strategies.sh
```

**What it does:**
- Exports all strategies from NoFx database to JSON
- Creates timestamped backup: `backups/strategies_YYYY-MM-DD_HHMMSS.json`
- Maintains `backups/strategies_latest.json` symlink
- Includes all metadata (name, description, config, timestamps)

**Run before:**
- Making major strategy changes
- Testing new configurations
- System updates/migrations

### Manual Backup (Single Strategy)
```bash
sqlite3 ~/nofx/data/test_data.db << EOF
.mode json
SELECT * FROM strategies WHERE id = 'STRATEGY_ID';
EOF > backup_STRATEGY_NAME.json
```

### Restore Strategy
```bash
# Extract config from backup
CONFIG=$(jq -r '.[0].config' backup.json)

# Insert via REST API (requires login helper)
TOKEN=$(~/clawd/nofx/login.sh)
curl -X POST http://localhost:8080/api/strategies \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\": \"Restored Strategy\", \"config\": $CONFIG}"
```

## Login Helper
*(Will be created by Opus sub-agent)*

Script: `~/clawd/nofx/login.sh`

**Usage:**
```bash
# Get JWT token (valid 24h)
TOKEN=$(~/clawd/nofx/login.sh)

# Use token for API calls
curl http://localhost:8080/api/strategies \
  -H "Authorization: Bearer $TOKEN"
```

## Disaster Recovery

If you need to rebuild NoFx on a new machine:

1. **Clone repo:** `git clone git@github.com:HrMarcussen/nofx.git`
2. **Restore database:** Copy `~/nofx/data/test_data.db` from OneDrive backup
3. **Or restore strategies via API:**
   - Setup fresh NoFx
   - Create API user (see below)
   - Import from `~/clawd/nofx/backups/strategies_latest.json`

## API User Setup

**Current API user:** `leeloo-api@nofx.local`

**To recreate on fresh install:**
```bash
# Run Opus sub-agent setup (recommended)
# OR manual:
python3 << EOF
import bcrypt
PASSWORD = "YOUR_PASSWORD"
print(bcrypt.hashpw(PASSWORD.encode(), bcrypt.gensalt()).decode())
EOF

sqlite3 ~/nofx/data/test_data.db "
INSERT INTO users (id, email, password_hash, otp_secret, otp_verified, created_at, updated_at)
VALUES ('$(uuidgen)', 'leeloo-api@nofx.local', 'HASH_FROM_ABOVE', 'OTP_SECRET', 1, datetime('now'), datetime('now'));
"
```

## Files

- `export_strategies.sh` - Backup script
- `login.sh` - API authentication helper (created by sub-agent)
- `backups/` - Strategy JSON backups (timestamped)
- `/tmp/leeloo-api-creds.txt` - API credentials (temporary storage)

## Database Paths

- **NoFx DB:** `~/nofx/data/test_data.db`
- **Tables:** `users`, `strategies`, `traders`, `exchanges`
- **Your User ID:** `115a2f29-338a-487a-ba67-f9d2a7c780bd`
- **Current Strategy ID:** `d84d5770-44fe-4750-b504-20555b6281ed`

---

*Last updated: 2026-02-16*
