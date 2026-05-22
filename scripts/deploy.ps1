# ========================================================
# Deploy rápido - RadarFondos
# Build + Deploy en un solo comando
# ========================================================

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot

Write-Host "`n🚀 RADAR FONDOS - BUILD & DEPLOY`n" -ForegroundColor Cyan

Push-Location $ProjectRoot
try {
    # Paso 1: Build
    Write-Host "📦 Ejecutando build..." -ForegroundColor Yellow
    npm run build
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Build falló" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "✅ Build exitoso" -ForegroundColor Green
    
    # Paso 2: Deploy
    Write-Host "`n🔥 Deploying a Firebase..." -ForegroundColor Yellow
    firebase deploy --only hosting
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Deploy falló" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "`n✅ Deploy completado!" -ForegroundColor Green
    Write-Host "🌐 URL: https://antigravity-jairo-2026.web.app`n" -ForegroundColor Cyan
    
}
finally {
    Pop-Location
}