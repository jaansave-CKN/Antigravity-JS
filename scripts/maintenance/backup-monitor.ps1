# Monitoreo de 6 pestañas - Backup automático cada 5 minutos
# Ejecutar en PowerShell: .\backup-monitor.ps1

$src = "C:\2026 AI EGIOC5\Antigravity JS\src"
$history = "C:\2026 AI EGIOC5\Antigravity JS\history"

# 6 pestañas a monitorear
$tabs = @("bitacora.json", "index_recuperado.html", "ventana2", "ventana3", "ventana4", "ventana5")

Write-Host "Iniciando monitoreo de 6 pestañas..." -ForegroundColor Green
Write-Host "Presiona Ctrl+C para detener" -ForegroundColor Yellow

while($true) {
    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $backupPath = Join-Path $history "backup_$timestamp"
    
    if (!(Test-Path $backupPath)) {
        New-Item -ItemType Directory -Path $backupPath -Force | Out-Null
    }
    
    # Copiar pestañas monitoreadas
    foreach ($tab in $tabs) {
        $sourcePath = Join-Path $src $tab
        if (Test-Path $sourcePath) {
            Copy-Item $sourcePath $backupPath -Recurse -Force -ErrorAction SilentlyContinue
            Write-Host "[$timestamp] Backup: $tab" -ForegroundColor Cyan
        }
    }
    
    Write-Host "---" -NoNewline
    Start-Sleep -Seconds 300  # 5 minutos
}