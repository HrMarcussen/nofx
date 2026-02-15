#!/bin/bash

# NoFx - Stop All Services
# Usage: ./stop_all.sh

echo "🛑 Stopping NoFx Services..."
echo ""

# Stop backend
if pgrep -f "./nofx" > /dev/null; then
    echo "🔧 Stopping backend..."
    pkill -f "./nofx"
    sleep 1
    if pgrep -f "./nofx" > /dev/null; then
        echo "   ⚠️  Backend still running, force killing..."
        pkill -9 -f "./nofx"
    fi
    echo "   ✅ Backend stopped"
else
    echo "⚠️  Backend was not running"
fi

# Stop frontend
if pgrep -f "vite" > /dev/null; then
    echo "🌐 Stopping frontend..."
    pkill -f "vite"
    sleep 1
    if pgrep -f "vite" > /dev/null; then
        echo "   ⚠️  Frontend still running, force killing..."
        pkill -9 -f "vite"
    fi
    echo "   ✅ Frontend stopped"
else
    echo "⚠️  Frontend was not running"
fi

echo ""
echo "✅ All services stopped"
echo ""
