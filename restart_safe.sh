#!/bin/bash
# Safe restart - stops everything first, then starts cleanly

echo "🛑 Stopping all NoFx services..."
pkill -f './nofx' 2>/dev/null || true
pkill -f 'vite' 2>/dev/null || true
sudo systemctl stop openclaw-trading-adapter 2>/dev/null || true

sleep 2

echo "🚀 Starting OpenClaw adapter..."
sudo systemctl start openclaw-trading-adapter

sleep 1

echo "🚀 Starting NoFx backend and frontend..."
./start_all.sh

echo ""
echo "✅ All services restarted safely"
