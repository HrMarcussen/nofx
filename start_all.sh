#!/bin/bash

# NoFx - Start All Services
# Usage: ./start_all.sh

set -e

NOFX_DIR="/home/thomas/nofx"
cd "$NOFX_DIR"

echo "🚀 Starting NoFx Services..."
echo ""

# Check if backend is already running
if pgrep -f "./nofx" > /dev/null; then
    echo "⚠️  Backend is already running (PID: $(pgrep -f './nofx'))"
else
    echo "🔧 Starting backend on :8080..."
    ./nofx > logs/backend.log 2>&1 &
    BACKEND_PID=$!
    sleep 2
    
    if kill -0 $BACKEND_PID 2>/dev/null; then
        echo "   ✅ Backend started (PID: $BACKEND_PID)"
    else
        echo "   ❌ Backend failed to start! Check logs/backend.log"
        exit 1
    fi
fi

# Check if frontend is already running
if pgrep -f "vite" > /dev/null; then
    echo "⚠️  Frontend is already running (PID: $(pgrep -f 'vite'))"
else
    echo "🌐 Starting frontend on :3000..."
    cd web
    BROWSER=none npm run dev > ../logs/frontend.log 2>&1 &
    FRONTEND_PID=$!
    cd ..
    sleep 2
    
    if kill -0 $FRONTEND_PID 2>/dev/null; then
        echo "   ✅ Frontend started (PID: $FRONTEND_PID)"
    else
        echo "   ⚠️  Frontend may not have started - check logs/frontend.log"
    fi
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ NoFx Services Running"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🌐 Web UI:      http://localhost:3000"
echo "🔌 Backend API: http://localhost:8080"
echo ""
echo "📧 Login: thomas@marcussens.email"
echo "🔐 Pass:  Nofx2026!Secure"
echo ""
echo "📊 Check status: ps aux | grep -E 'nofx|vite' | grep -v grep"
echo "📝 View logs:    tail -f logs/backend.log"
echo "🛑 Stop all:     pkill -f 'nofx'; pkill -f 'vite'"
echo ""
