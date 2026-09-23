$ProjectRoot = "C:\2026 AI EGIOC5\Antigravity JS\proyectos\Proy_03_RadarFondos"

# Start Backend
Start-Process powershell -ArgumentList "-NoProfile", "-Command", "cd '$ProjectRoot'; python -m uvicorn backend.server_fastapi:app --host 0.0.0.0 --port 8000" -PassThru -WindowStyle Hidden

# Start Frontend 
Start-Process powershell -ArgumentList "-NoProfile", "-Command", "cd '$ProjectRoot'; npm run dev" -PassThru -WindowStyle Hidden

Start-Sleep -Seconds 8

Write-Host "=== SERVICIOS INICIADOS ==="
Write-Host "Backend API: http://localhost:8000"
Write-Host "Frontend: http://localhost:5173 (o el puerto disponible)"
Write-Host ""
Write-Host "Presiona cualquier tecla para salir..."
[Console]::ReadKey($true)