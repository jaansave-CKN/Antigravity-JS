# =============================================================================
#  INICIAR_TODO_v2.ps1
#  RADAR FONDOS 360 — Launcher PowerShell
#
#  Lanza en paralelo SIN colisiones:
#    1. FastAPI  → http://localhost:8000
#    2. Scheduler 24/7 (APScheduler) → worker en background
#    3. Vite dev server → http://localhost:5173
#
#  Uso:
#    cd C:\2026 AI EGIOC5\Antigravity JS\proyectos\Proy_03_RadarFondos
#    .\INICIAR_TODO_v2.ps1
#   ─────────────────────────────────────────────────────────────────────────
#  PowerShell: Set-ExecutionPolicy Bypass -Scope Process
# =============================================================================

$ErrorActionPreference = 'Stop'

# ── Rutas ──────────────────────────────────────────────────────────────────
$PROJECT_ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
$VENV_DIR     = Join-Path $PROJECT_ROOT ".venv"
$BACKEND_DIR  = Join-Path $PROJECT_ROOT "backend"
$SIA_DIR      = Join-Path $PROJECT_ROOT "SIA_Radar"

# Resolver python: preferir venv, luego system
$PYTHON      = if (Test-Path "$VENV_DIR\Scripts\python.exe") { "$VENV_DIR\Scripts\python.exe" } else { "python" }
$UVICORN     = if (Test-Path "$VENV_DIR\Scripts\uvicorn.exe") { "$VENV_DIR\Scripts\uvicorn.exe" } else { "uvicorn" }
$NPM_BIN     = if (Test-Path "$VENV_DIR\Scripts\npm.cmd") { "$VENV_DIR\Scripts\npm.cmd" } else { "npm" }

$API_PORT   = 8000
$FRONT_PORT = 5173

$env:PYTHONPATH = "$BACKEND_DIR;$SIA_DIR;$env:PYTHONPATH"

Write-Host ""
Write-Host "======================================================================"
Write-Host "   RADAR FONDOS 360 — LEVANTANDO SERVICIOS" -ForegroundColor Cyan
Write-Host "======================================================================"
Write-Host ""
Write-Host "[INFO] Proyecto:     $PROJECT_ROOT"
Write-Host "[INFO] Python:       $PYTHON"
Write-Host "[INFO] API Puerto:   $API_PORT"
Write-Host "[INFO] WebSocket:    ws://localhost:$API_PORT/ws/convocatorias"
Write-Host "[INFO] Frontend:     http://localhost:$FRONT_PORT"
Write-Host ""

# ── 0. Cargar variables de entorno ─────────────────────────────────────────
if (Test-Path (Join-Path $PROJECT_ROOT ".env")) {
    Get-Content (Join-Path $PROJECT_ROOT ".env") | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith('#') -and $line.Contains('=')) {
            $name, $value = $line -split '=', 2
            [System.Environment]::SetEnvironmentVariable(
                $name.Trim(), $value.Trim(), 'Process'
            )
        }
    }
    Write-Host "[OK] Variables .env cargadas"
} else {
    Write-Host "[WARN] .env no encontrado — usando valores por defecto"
}

# ── 1. Verificar puertos libres ─────────────────────────────────────────────
function Test-Puerto($puerto) {
    $conn = Get-NetTCPConnection -LocalPort $puerto -ErrorAction SilentlyContinue
    if ($conn) { Write-Host "[WARN] Puerto $puerto en uso (PID $($conn[0].OwningProcess)). Revisa si ya hay un servicio corriendo."; return $false }
    return $true
}

if (-not (Test-Puerto $API_PORT))   { Write-Host "[ERROR] Abortando: puerto $API_PORT bloqueado" -ForegroundColor Red; exit 1 }
if (-not (Test-Puerto $FRONT_PORT)) { Write-Host "[WARN] Puerto $FRONT_PORT ocupado — el frontend puede no arrancar" }

# ── 2. Inicializar base de datos ───────────────────────────────────────────
Write-Host "[1/3] Inicializando base de datos..."
& $PYTHON -c "
import sys
sys.path.insert(0, r'$BACKEND_DIR')
from database import init_db
path = init_db()
print(f'  BD lista: {path}')
"
if ($LASTEXITCODE -ne 0) { Write-Host "[ERROR] Falló init_db" -ForegroundColor Red; exit 1 }

# ── 3. Lanzar FastAPI (puerto 8000) ─────────────────────────────────────────
Write-Host "[2/3] Levantando FastAPI en puerto $API_PORT..."

$API_LOG   = Join-Path $PROJECT_ROOT "logs\api_stdout.log"
$SCHED_LOG = Join-Path $PROJECT_ROOT "logs\scheduler_stdout.log"

# El FastAPI WS expone /ws/convocatorias en el MISMO puerto que la API
$apiProc = Start-Process -FilePath $PYTHON `
    -ArgumentList  "-m", "uvicorn", "SIA_Radar.api.main:app",
                   "--host", "0.0.0.0",
                   "--port", "$API_PORT",
                   "--reload",
                   "--log-level", "info" `
    -WorkingDirectory $PROJECT_ROOT `
    -PassThru `
    -NoNewWindow `
    -RedirectStandardOutput $API_LOG `
    -RedirectStandardError  $API_LOG

Write-Host "  [OK] API PID: $($apiProc.Id)  (log: $API_LOG)"

# Esperar 3 → 5 s a que la API esté lista
Write-Host "  Esperando respuesta de la API..."
$maxWait  = 20
$elapsed  = 0
$apiOk    = $false
while ($elapsed -lt $maxWait) {
    Start-Sleep -Milliseconds 500
    $elapsed += 0.5
    try {
        $r = Invoke-WebRequest "http://localhost:$API_PORT/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        if ($r.StatusCode -eq 200) { $apiOk = $true; break }
    } catch {}
}
if ($apiOk) {
    Write-Host "  [OK] API responde en http://localhost:$API_PORT" -ForegroundColor Green
} else {
    Write-Host "[WARN] API no respondió aún (revisa $API_LOG)" -ForegroundColor Yellow
}

# ── 4. Lanzar Scheduler 24/7 (worker en background) ─────────────────────────
Write-Host "[3/3] Levantando Scheduler 24/7..."

$schedProc = Start-Process -FilePath $PYTHON `
    -ArgumentList "-m", "backend.workers.scheduler" `
    -WorkingDirectory $BACKEND_DIR `
    -PassThru `
    -NoNewWindow `
    -RedirectStandardOutput $SCHED_LOG `
    -RedirectStandardError  $SCHED_LOG

Write-Host "  [OK] Scheduler PID: $($schedProc.Id)  (log: $SCHED_LOG)"

# ── 5. Lanzar Frontend Vite (opcional) ─────────────────────────────────────
# Descomentar si quieres levantar el frontend automáticamente:
#
# Write-Host "[Extra] Levantando Vite dev server en puerto $FRONT_PORT..."
# $viteProc = Start-Process -FilePath $NPM_BIN `
#     -ArgumentList "run", "dev", "--", "--port", "$FRONT_PORT" `
#     -WorkingDirectory $PROJECT_ROOT `
#     -PassThru `
#     -NoNewWindow `
#     -RedirectStandardOutput (Join-Path $PROJECT_ROOT "logs\vite_stdout.log") `
#     -RedirectStandardError  (Join-Path $PROJECT_ROOT "logs\vite_stdout.log")
# Write-Host "  [OK] Vite PID: $($viteProc.Id)"

# ── 6. Resumen y watchdog ──────────────────────────────────────────────────
Write-Host ""
Write-Host "======================================================================"
Write-Host "   SERVICIOS ACTIVOS" -ForegroundColor Green
Write-Host "======================================================================"
Write-Host "   API  FastAPI:     http://localhost:$API_PORT"
Write-Host "                      http://localhost:$API_PORT/docs"
Write-Host "                      http://localhost:$API_PORT/health"
Write-Host "                      ws://localhost:$API_PORT/ws/convocatorias"
Write-Host ""
Write-Host "   Scheduler 24/7:  PID $($schedProc.Id)"
Write-Host "   API PID:         PID $($apiProc.Id)"
Write-Host ""
Write-Host "   Logs API:        logs\api_stdout.log"
Write-Host "   Logs Scheduler:  logs\scheduler_stdout.log"
Write-Host ""
Write-Host "   Para detener:"
Write-Host "   taskkill /PID $($apiProc.Id) /F"
Write-Host "   taskkill /PID $($schedProc.Id) /F"
Write-Host "======================================================================"
Write-Host ""
Write-Host "Presiona Ctrl+C para detener todos..." -ForegroundColor Yellow

# ── Watchdog: si algún proceso muere, avisar ─────────────────────────────
$done = $false
try {
    while (-not $done) {
        Start-Sleep -Seconds 10
        if ($apiProc.HasExited)    { Write-Host "[ALERTA] API (PID $($apiProc.Id)) se detuvo. Revisa $API_LOG" -ForegroundColor Red; $done = $true }
        if ($schedProc.HasExited)  { Write-Host "[ALERTA] Scheduler (PID $($schedProc.Id)) se detuvo. Revisa $SCHED_LOG" -ForegroundColor Red }
    }
} catch [System.Management.Automation.PipelineStoppedException] {
    Write-Host ""
    Write-Host "[SHUTDOWN] Deteniendo servicios..."
    Get-Process -Id $apiProc.Id -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Get-Process -Id $schedProc.Id -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Write-Host "[DONE] Servicios detenidos"
}
