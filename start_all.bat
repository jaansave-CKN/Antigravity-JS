@echo off
echo ========================================
echo   RADAR FONDOS - INICIANDO TODO
echo ========================================
echo.

cd /d "C:\2026 AI EGIOC5\Antigravity JS\proyectos\Proy_03_RadarFondos"

echo [1/3] Iniciando servidor API (Flask)...
start "RadarAPI" cmd /k "python main.py"

timeout /t 3 /nobreak > nul

echo [2/3] Verificando API...
curl -s http://localhost:5000/api/health > nul 2>&1
if %errorlevel% equ 0 (
    echo      API iniciada correctamente
) else (
    echo      Advertencia: API no respondio
)

echo [3/3] Iniciando frontend (Vite)...
start "RadarWeb" cmd /k "npm run dev"

echo.
echo ========================================
echo   SERVICIOS INICIADOS
echo ========================================
echo.
echo   API:     http://localhost:5000
echo   Web:    http://localhost:5173
echo.
echo   Presiona cualquier tecla para salir
echo   Los servicios seguiran corriendo en segundo plano
echo.
pause > nul