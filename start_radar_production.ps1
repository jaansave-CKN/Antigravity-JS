# ============================================================================
# RADAR FONDOS 360 - INICIO DE SERVICIOS EN PARALELO
# ============================================================================
# Ejecutar: .\start_radar_production.ps1

param(
    [string]$Mode = "dev",
    [switch]$SkipNpm = $false
)

$ErrorActionPreference = "Stop"
$ProjectRoot = "C:\2026 AI EGIOC5\Antigravity JS\proyectos\Proy_03_RadarFondos"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  RADAR FONDOS 360 - INICIANDO SERVICIOS" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# Función para iniciar proceso en Background
function Start-ServiceProcess {
    param(
        [string]$Name,
        [string]$Command,
        [string]$WorkDir
    )

    $proc = Start-Process -FilePath "powershell" -ArgumentList "-NoProfile", "-Command", $Command -PassThru -WorkingDirectory $WorkDir
    Write-Host "[$Name] Started with PID: $($proc.Id)" -ForegroundColor Green
    return $proc
}

# Asegurar directorios
$DataDir = Join-Path $ProjectRoot "data"
$LogsDir = Join-Path $ProjectRoot "logs"
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null

# Determinar modo
if ($Mode -eq "production") {
    Write-Host "[MODE] PRODUCTION (PostgreSQL)" -ForegroundColor Yellow
    $EnvFile = ".env.production"
} else {
    Write-Host "[MODE] DEVELOPMENT (SQLite)" -ForegroundColor Yellow
    $EnvFile = ".env"
}

# ============================================================================
# 1. INICIAR SERVIDOR FASTAPI (Puerto 8000)
# ============================================================================
Write-Host ""
Write-Host "[1] Starting FastAPI Server..." -ForegroundColor White
$apiCommand = "cd '$ProjectRoot'; python -m uvicorn backend.server_fastapi:app --host 0.0.0.0 --port 8000 --reload"
$apiProcess = Start-ServiceProcess -Name "FastAPI" -Command $apiCommand -WorkDir $ProjectRoot

Start-Sleep -Seconds 3

# Verificar que el servidor responde
try {
    $response = Invoke-WebRequest -Uri "http://localhost:8000/api/health" -TimeoutSec 5 -UseBasicParsing
    if ($response.StatusCode -eq 200) {
        Write-Host "    ✅ API responding on http://localhost:8000" -ForegroundColor Green
    }
} catch {
    Write-Host "    ⚠️ API health check failed, but process started" -ForegroundColor Yellow
}

# ============================================================================
# 2. INICIAR FRONTEND (Solo si no se omite)
# ============================================================================
if (-not $SkipNpm) {
    Write-Host ""
    Write-Host "[2] Starting Frontend (npm run dev)..." -ForegroundColor White

    $frontendProcess = Start-ServiceProcess -Name "Frontend" -Command "cd '$ProjectRoot'; npm run dev" -WorkDir $ProjectRoot
    Start-Sleep -Seconds 5
}

# ============================================================================
# RESUMEN
# ============================================================================
Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  SERVICIOS INICIADOS" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  API Server    : http://localhost:8000" -ForegroundColor White
Write-Host "  WebSocket     : ws://localhost:8000/ws/convocatorias" -ForegroundColor White
if (-not $SkipNpm) {
    Write-Host "  Frontend      : http://localhost:5173" -ForegroundColor White
}
Write-Host "  Logs          : $LogsDir" -ForegroundColor White
Write-Host ""
Write-Host "Para detener todos los servicios:" -ForegroundColor Yellow
Write-Host "  Get-Process python | Stop-Process" -ForegroundColor Gray
Write-Host "  Get-Process node | Stop-Process" -ForegroundColor Gray
Write-Host ""

# Mantener el script vivo para mostrar logs
Write-Host "Presiona Ctrl+C para detener..." -ForegroundColor Gray
try {
    while ($true) { Start-Sleep -Seconds 10 }
} finally {
    Write-Host ""
    Write-Host "[Stopping all services...]" -ForegroundColor Yellow
    Stop-Process -Id $apiProcess.Id -Force -ErrorAction SilentlyContinue
    if (-not $SkipNpm) { Stop-Process -Id $frontendProcess.Id -Force -ErrorAction SilentlyContinue }
}