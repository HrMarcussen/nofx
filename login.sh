#!/bin/bash
# NoFx API Login Helper (Shell Wrapper)
# Gets JWT token for leeloo-api@nofx.local user

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
python3 "$SCRIPT_DIR/login.py" 2>/dev/null
