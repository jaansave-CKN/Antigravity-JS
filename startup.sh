#!/bin/bash
# Startup script for RadarFondos 360 en Render - Frontend

echo "Starting RadarFondos 360 Frontend..."

cd /app || exit 1

# Install dependencies and build frontend
npm install
npm run build

# Serve static dist folder with SPA fallback
exec npx serve -s dist -l "${PORT:-10000}"