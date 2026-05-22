$ErrorActionPreference = "Stop"
$projectDir = "C:\2026 AI EGIOC5\Antigravity JS\proyectos\Proy_03_RadarFondos"

Write-Host "[START] Starting Flask API server..." -ForegroundColor Cyan
$proc = Start-Process python -ArgumentList "$projectDir\main.py" -WorkingDirectory $projectDir -PassThru -WindowStyle Hidden

Write-Host "[PID] $($proc.Id)" -ForegroundColor Yellow
Start-Sleep 5

try {
    $response = Invoke-WebRequest -Uri "http://localhost:5000/api/health" -Method GET -TimeoutSec 5
    if ($response.StatusCode -eq 200) {
        Write-Host "[OK] API is running!" -ForegroundColor Green
    }
} catch {
    Write-Host "[ERROR] API not responding" -ForegroundColor Red
}

Write-Host ""
Write-Host "API running at: http://localhost:5000" -ForegroundColor Yellow
Write-Host "To stop: taskkill /PID $($proc.Id) /F" -ForegroundColor Gray