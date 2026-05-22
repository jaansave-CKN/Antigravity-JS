# Iniciar Radar 360
$ErrorActionPreference = "Stop"

$backend = "C:\2026 AI EGIOC5\Antigravity JS\proyectos\Proy_03_RadarFondos\backend"
$frontend = "C:\2026 AI EGIOC5\Antigravity JS\proyectos\Proy_03_RadarFondos"

Write-Host "Iniciando Radar 360..." -ForegroundColor Cyan

# Iniciar API
Write-Host "[1] Iniciando API..." -ForegroundColor Yellow
$apiJob = Start-Job -ScriptBlock {
    param($path)
    Set-Location $path
    python api.py
} -ArgumentList $backend

Start-Sleep 3

# Verificar API
try {
    $health = Invoke-RestMethod -Uri "http://localhost:5000/api/health" -TimeoutSec 5
    Write-Host "    API OK: $($health.status)" -ForegroundColor Green
} catch {
    Write-Host "    API no respondió" -ForegroundColor Red
}

# Iniciar Frontend
Write-Host "[2] Iniciando Frontend..." -ForegroundColor Yellow
$webJob = Start-Job -ScriptBlock {
    param($path)
    Set-Location $path
    npm run dev
} -ArgumentList $frontend

Start-Sleep 3

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   RADAR 360 - SISTEMA ACTIVO" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Accede a: http://localhost:5173" -ForegroundColor White
Write-Host ""
Write-Host "Presiona Ctrl+C para detener" -ForegroundColor Yellow
Write-Host ""

# Mantener el script corriendo
try {
    while ($true) { Start-Sleep -Seconds 60 }
} finally {
    Stop-Job -Job $apiJob -ErrorAction SilentlyContinue
    Stop-Job -Job $webJob -ErrorAction SilentlyContinue
}