#!/bin/bash

# NoFx - Check System Status
# Usage: ./check_status.sh

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔍 NoFx System Status Check"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check backend
echo "🔧 Backend Status:"
if pgrep -f "./nofx" > /dev/null; then
    PID=$(pgrep -f "./nofx")
    echo "   ✅ Running (PID: $PID)"
    echo "   🔌 Testing API..."
    if curl -s http://localhost:8080/api/health | grep -q "ok"; then
        echo "   ✅ API responding correctly"
    else
        echo "   ⚠️  API not responding"
    fi
else
    echo "   ❌ Not running"
    echo "   💡 Start with: ./start_all.sh"
fi

echo ""

# Check frontend
echo "🌐 Frontend Status:"
if pgrep -f "vite" > /dev/null; then
    PID=$(pgrep -f "vite")
    echo "   ✅ Running (PID: $PID)"
    echo "   🌐 Testing web server..."
    if curl -s http://localhost:3000 | grep -q "html"; then
        echo "   ✅ Web server responding"
    else
        echo "   ⚠️  Web server not responding"
    fi
else
    echo "   ❌ Not running"
    echo "   💡 Start with: ./start_all.sh"
fi

echo ""

# Check OpenClaw
echo "🤖 OpenClaw Adapter Status:"
if curl -s http://localhost:8888/v1/models > /dev/null 2>&1; then
    echo "   ✅ Running on :8888"
else
    echo "   ⚠️  Not responding on :8888"
    echo "   💡 Make sure OpenClaw trading adapter is running"
fi

echo ""

# Database check
echo "💾 Database Status:"
if [ -f "/home/thomas/nofx/data/test_data.db" ]; then
    SIZE=$(du -h /home/thomas/nofx/data/test_data.db | cut -f1)
    echo "   ✅ Found at data/test_data.db ($SIZE)"
else
    echo "   ⚠️  Database file not found"
fi

echo ""

# Access URLs
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🌐 Access URLs:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "   Web UI:      http://localhost:3000"
echo "   Backend API: http://localhost:8080"
echo "   Health:      http://localhost:8080/api/health"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔐 Login Credentials:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "   Email:    thomas@marcussens.email"
echo "   Password: Nofx2026!Secure"
echo "   2FA:      Use Google Authenticator"
echo ""
