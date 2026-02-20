#!/usr/bin/env python3
"""
NoFx API Login Helper
Performs full authentication flow: login → generate OTP → verify → get JWT token
"""

import os
import sys
import json
import time
import hmac
import struct
import base64
import hashlib
import requests


def _load_env(path="/home/thomas/projects/nofx/.env"):
    """Load environment variables from .env file if not already set."""
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, _, value = line.partition('=')
                    key = key.strip()
                    value = value.strip()
                    # Only set if not already in environment
                    if key and key not in os.environ:
                        os.environ[key] = value
    except FileNotFoundError:
        pass  # .env is optional


_load_env()

# Configuration
API_BASE_URL = "http://localhost:8080/api"
EMAIL = "thomas@marcussens.email"
PASSWORD = os.getenv("NOFX_PASSWORD")
OTP_SECRET = os.getenv("NOFX_OTP_SECRET")


def generate_totp(secret, time_step=30, digits=6):
    """
    Generate TOTP code from secret.
    Compatible with RFC 6238 (TOTP: Time-Based One-Time Password Algorithm)
    """
    # Decode base32 secret
    try:
        key = base64.b32decode(secret + '=' * ((8 - len(secret) % 8) % 8))
    except Exception as e:
        print(f"Error decoding secret: {e}", file=sys.stderr)
        sys.exit(1)
    
    # Get current time counter
    counter = int(time.time() / time_step)
    
    # Generate HMAC-SHA1
    msg = struct.pack(">Q", counter)
    hmac_hash = hmac.new(key, msg, hashlib.sha1).digest()
    
    # Dynamic truncation
    offset = hmac_hash[-1] & 0x0F
    code = struct.unpack(">I", hmac_hash[offset:offset + 4])[0] & 0x7FFFFFFF
    
    # Generate n-digit code
    code = code % (10 ** digits)
    
    return str(code).zfill(digits)


def login():
    """
    Perform full login flow and return JWT token.
    Returns: JWT token string or None on failure
    """
    if not PASSWORD:
        print("Error: NOFX_PASSWORD environment variable not set", file=sys.stderr)
        return None
    if not OTP_SECRET:
        print("Error: NOFX_OTP_SECRET environment variable not set", file=sys.stderr)
        return None

    try:
        # Step 1: Initial login
        print("Step 1: Logging in...", file=sys.stderr)
        response = requests.post(
            f"{API_BASE_URL}/login",
            json={"email": EMAIL, "password": PASSWORD},
            headers={"Content-Type": "application/json"}
        )
        
        if response.status_code != 200:
            print(f"Login failed: {response.status_code}", file=sys.stderr)
            print(f"Response: {response.text}", file=sys.stderr)
            return None
        
        data = response.json()
        
        # Check if OTP is required
        if not data.get("requires_otp"):
            print("Warning: OTP not required, unexpected behavior", file=sys.stderr)
            if "token" in data:
                return data["token"]
            return None
        
        user_id = data.get("user_id")
        if not user_id:
            print("Error: No user_id in login response", file=sys.stderr)
            return None
        
        print(f"User ID: {user_id}", file=sys.stderr)
        
        # Step 2: Generate TOTP code
        print("Step 2: Generating TOTP code...", file=sys.stderr)
        otp_code = generate_totp(OTP_SECRET)
        print(f"OTP Code: {otp_code}", file=sys.stderr)
        
        # Step 3: Verify OTP
        print("Step 3: Verifying OTP...", file=sys.stderr)
        response = requests.post(
            f"{API_BASE_URL}/verify-otp",
            json={"user_id": user_id, "otp_code": otp_code},
            headers={"Content-Type": "application/json"}
        )
        
        if response.status_code != 200:
            print(f"OTP verification failed: {response.status_code}", file=sys.stderr)
            print(f"Response: {response.text}", file=sys.stderr)
            return None
        
        data = response.json()
        token = data.get("token")
        
        if not token:
            print("Error: No token in verify-otp response", file=sys.stderr)
            return None
        
        print("Login successful!", file=sys.stderr)
        return token
        
    except requests.exceptions.RequestException as e:
        print(f"Request error: {e}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"Unexpected error: {e}", file=sys.stderr)
        return None


if __name__ == "__main__":
    token = login()
    if token:
        # Output token to stdout for easy capture
        print(token)
        sys.exit(0)
    else:
        print("Login failed", file=sys.stderr)
        sys.exit(1)
