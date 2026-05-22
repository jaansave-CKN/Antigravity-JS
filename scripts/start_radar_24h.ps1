# ========================================================
# RADAR 360 - INICIO AUTOMÁTICO 24/7
# ========================================================
# Este script inicia:
# 1. API de Flask
# 2. Radar automático (scheduler + miner + validator)
# 3. Frontend

param(
    [int]$IntervaloHoras = 6
)

$ErrorActionPreference = "Stop"
$ProjectRoot = "C:\2026 AI EGIOC5\Antigravity JS\proyectos\Proy_03_RadarFondos"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   RADAR 360 - INICIO 24/7 AUTOMÁTICO" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Inicializar base de datos
Write-Host "[1/5] Inicializando base de datos..." -ForegroundColor Yellow
cd $ProjectRoot\backend
python -c "from database import init_db; init_db(); print('DBOK')"
if ($LASTEXITCODE -ne 0) { throw "Error inicializando DB" }

# 2. Iniciar API Flask en background
Write-Host "[2/5] Iniciando servidor API..." -ForegroundColor Yellow
$apiJob = Start-Job -ScriptBlock {
    param($root)
    Set-Location $root\backend
    python api.py
} -ArgumentList $ProjectRoot

Start-Sleep -Seconds 3

# Verificar API
try {
    $response = Invoke-RestMethod -Uri "http://localhost:5000/api/health" -TimeoutSec 5
    Write-Host "      API iniciada: http://localhost:5000" -ForegroundColor Green
} catch {
    Write-Host "      Advertencia: API no responde aún" -ForegroundColor Yellow
}

# 3. Iniciar Radar 24/7 (Scheduler + Agentes)
Write-Host "[3/5] Iniciando Radar 24/7 automático..." -ForegroundColor Yellow
$radarJob = Start-Job -ScriptBlock {
    param($root, $interval)
    Set-Location $root\backend
    
    # Configurar variables de entorno
    $env:RADAR_INTERVAL_HOURS = $interval
    $env:TARGET_COUNTRY = "Colombia"
    $env:TARGET_COUNTRIES = "Colombia,Venezuela,Canada,Estados Unidos"
    
    python main.py
} -ArgumentList $ProjectRoot, $IntervaloHoras

Write-Host "      Radar activo - ciclo cada $IntervaloHoras horas" -ForegroundColor Green

# 4. Motor A (Barrido automático cada 6 horas)
Write-Host "[4/5] Configurando Motor A (Barrido automático)..." -ForegroundColor Yellow
$motorAJob = Start-Job -ScriptBlock {
    param($root)
    Set-Location $root\backend
    python radar_scheduler.py
} -ArgumentList $ProjectRoot

Write-Host "      Motor A configurado" -ForegroundColor Green

# 5. Iniciar Frontend (opcional - solo si npm está disponible)
Write-Host "[5/5] Verificando frontend..." -ForegroundColor Yellow
if (Test-Path "$ProjectRoot\node_modules") {
    $frontendJob = Start-Job -ScriptBlock {
        param($root)
        Set-Location $root
        npm run dev
    } -ArgumentList $ProjectRoot
    Write-Host "      Frontend disponible en: http://localhost:5173" -ForegroundColor Green
} else {
    Write-Host "      Frontend no instalado (npm install)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   RADAR 360 - ACTIVO 24/7" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Servicios activos:" -ForegroundColor White
Write-Host "  - API:          http://localhost:5000" -ForegroundColor Gray
Write-Host "  - Radar 24/7:   Buscando cada $IntervaloHoras horas" -ForegroundColor Gray
Write-Host "  - Motor A:      Barrido automático" -ForegroundColor Gray
Write-Host "  - Frontend:    http://localhost:5173" -ForegroundColor Gray
Write-Host ""
Write-Host "Presiona Ctrl+C para detener" -ForegroundColor Yellow
Write-Host ""

# Mantener script vivo
try {
    while ($true) { Start-Sleep -Seconds 60 }
} finally {
    Write-Host ""
    Write-Host "Deteniendo servicios..." -ForegroundColor Yellow
    Stop-Job -Job $apiJob -ErrorAction SilentlyContinue
    Stop-Job -Job $radarJob -ErrorAction SilentlyContinue
    Stop-Job -Job $motorAJob -ErrorAction SilentlyContinue
    Write-Host "Servicios detenidos" -ForegroundColor Green
}