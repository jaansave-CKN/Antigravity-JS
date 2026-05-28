# watchdog.ps1 — Reemplaza PM2 en Windows sin conexión a internet
# Uso: powershell -ExecutionPolicy Bypass -File watchdog.ps1

$ROOT      = Split-Path -Parent $MyInvocation.MyCommand.Path
$SCRIPT    = Join-Path $ROOT "server.js"
$LOG_OUT   = Join-Path $ROOT "logs\watchdog-out.log"
$LOG_ERR   = Join-Path $ROOT "logs\watchdog-err.log"
$MAX_RESTARTS = 10
$RESTART_DELAY = 3   # segundos entre reinicios

New-Item -ItemType Directory -Force -Path (Join-Path $ROOT "logs") | Out-Null

function Log($msg) {
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
  Write-Host $line
  Add-Content -Path $LOG_OUT -Value $line
}

Log "=== WATCHDOG INICIADO — Proceso: radar-fondos ==="
Log "Script: $SCRIPT"

$restarts = 0

while ($restarts -lt $MAX_RESTARTS) {
  Log "Iniciando server.js (intento $($restarts + 1)/$MAX_RESTARTS)..."

  $proc = Start-Process -FilePath "node" -ArgumentList $SCRIPT `
    -WorkingDirectory $ROOT `
    -RedirectStandardOutput $LOG_OUT `
    -RedirectStandardError  $LOG_ERR `
    -NoNewWindow -PassThru

  Log "PID activo: $($proc.Id)"
  $proc.WaitForExit()
  $exitCode = $proc.ExitCode

  Log "Proceso terminó (exit code: $exitCode). Reiniciando en $RESTART_DELAY s..."
  $restarts++
  Start-Sleep -Seconds $RESTART_DELAY
}

Log "WATCHDOG: Límite de $MAX_RESTARTS reinicios alcanzado. Detenido."
