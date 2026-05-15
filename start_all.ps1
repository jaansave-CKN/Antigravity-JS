$projectDir = "C:\2026 AI EGIOC5\Antigravity JS\proyectos\Proy_03_RadarFondos"

Write-Host "[1/4] Starting Flask API..." -ForegroundColor Cyan
Start-Process python -ArgumentList "$projectDir\main.py" -WorkingDirectory $projectDir -PassThru | Out-Null
Start-Sleep 3

Write-Host "[2/4] Starting Vite Frontend..." -ForegroundColor Cyan
Start-Process npm -ArgumentList "run dev" -WorkingDirectory $projectDir -PassThru | Out-Null
Start-Sleep 2

Write-Host "[3/4] Starting Radar Scheduler 24/7 (cada 6 horas)..." -ForegroundColor Cyan
Start-Process python -ArgumentList "$projectDir\radar_scheduler.py" -WorkingDirectory $projectDir -PassThru | Out-Null

Write-Host "[4/4] Starting Main Scheduler (scraper entidades)..." -ForegroundColor Cyan
Start-Process python -ArgumentList "$projectDir\scheduler.py" -WorkingDirectory $projectDir -PassThru | Out-Null

Start-Sleep 2

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  SERVICIOS INICIADOS 24/7" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  API:       http://localhost:5000" -ForegroundColor Yellow
Write-Host "  Web:       http://localhost:5173" -ForegroundColor Yellow
Write-Host "  Scheduler: Radar 24/7 (cada 6 horas)" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Presiona Ctrl+C en cada ventana para detener" -ForegroundColor Gray
Write-Host ""

Start-Sleep 5