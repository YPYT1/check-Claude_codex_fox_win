#!/bin/bash

echo "========================================"
echo "  Service Monitor System - Installation"
echo "========================================"
echo ""
echo "This script will install all dependencies"
echo "and initialize the project"
echo ""

echo "[1/3] Installing backend dependencies..."
if [ -f "package.json" ]; then
    if [ -d "node_modules" ]; then
        echo "  [OK] Backend dependencies already installed"
    else
        echo "  Installing npm dependencies..."
        npm install
    fi
else
    echo "  [!] package.json not found"
fi

echo ""
echo "[2/3] Installing frontend dependencies..."
if [ -f "frontend/package.json" ]; then
    cd frontend
    if [ -d "node_modules" ]; then
        echo "  [OK] Frontend dependencies already installed"
    else
        echo "  Installing pnpm dependencies..."
        pnpm install
    fi
    cd ..
else
    echo "  [!] frontend/package.json not found"
fi

echo ""
echo "[3/3] Initializing data directories..."
if [ ! -d "data" ]; then
    mkdir data
    echo "  [OK] Created 'data' directory"
fi
if [ ! -d "config" ]; then
    mkdir config
    echo "  [OK] Created 'config' directory"
fi

echo ""
echo "========================================"
echo "  Installation Complete!"
echo "========================================"
echo ""
echo "  Usage:"
echo "  - ./start.sh            Start full system (backend + frontend)"
echo "  - ./stop.sh             Stop all services"
echo "  - ./start-backend.sh    Start backend only"
echo "  - ./start-frontend.sh   Start frontend only"
echo "  - ./build.sh            Build production version"
echo "  - ./clean-data.sh       Clean monitoring data"
echo ""
echo "  Before first use, edit config/services.json"
echo "  to configure monitoring services"
echo ""
