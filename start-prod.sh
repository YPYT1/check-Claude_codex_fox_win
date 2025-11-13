#!/bin/bash
set -e

echo "========================================"
echo "  Service Monitor - Production Build"
echo "========================================"
echo ""
echo "[1/2] Building frontend..."
cd frontend
pnpm build
if [ $? -ne 0 ]; then
    echo "Build failed!"
    read -p "Press Enter to continue..."
    exit 1
fi
cd ..

echo ""
echo "[2/2] Starting server..."
node src/server.js
