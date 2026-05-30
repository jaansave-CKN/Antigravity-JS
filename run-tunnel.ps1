# run-tunnel.ps1 — Cloudflare Quick Tunnel con auto-open zero-touch
# Delega la captura de streams a Node.js (start-tunnel.js), que maneja stderr/stdout de forma fiable
# Uso: .\run-tunnel.ps1

$SCRIPT_DIR   = $PSScriptRoot
$TUNNEL_JS    = "$SCRIPT_DIR\start-tunnel.js"
$MAX_INTENTOS = 10
$ESPERA_RETRY = 5   # segundos entre reintentos

if (-not (Test-Path "$SCRIPT_DIR\tools\cloudflared.exe")) {
    Write-Error "No se encontro: $SCRIPT_DIR\tools\cloudflared.exe"
    exit 1
}

if (-not (Test-Path $TUNNEL_JS)) {
    Write-Error "No se encontro: $TUNNEL_JS"
    exit 1
}

$intento = 0

while ($intento -lt $MAX_INTENTOS) {
    $intento++

    # Node.js maneja la captura de streams y apertura del navegador
    node $TUNNEL_JS $intento $MAX_INTENTOS

    $exitCode = $LASTEXITCODE

    if ($intento -ge $MAX_INTENTOS) {
        Write-Host ""
        Write-Host "[!] Se alcanzo el limite de $MAX_INTENTOS reintentos. Deteniendo." -ForegroundColor Red
        exit 1
    }

    Write-Host ""
    Write-Host "[!] Tunel caido (exit $exitCode). Reintentando en $ESPERA_RETRY segundos..." -ForegroundColor Yellow
    Start-Sleep -Seconds $ESPERA_RETRY
}
