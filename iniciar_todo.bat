@echo off
echo ========================================
echo   RADAR 360 - INICIANDO SISTEMA COMPLETO
echo ========================================
echo.

cd /d "%~dp0"

echo [1/2] Iniciando Backend (Puerto 5000)...
start "RadarAPI" cmd /k "cd /d "%~dp0backend" && python api.py"

timeout /t 4 /nobreak > nul

echo [2/2] Iniciando Frontend (Puerto 5173)...
start "RadarWeb" cmd /k "cd /d "%~dp0" && npm run dev"

echo.
echo ========================================
echo   SISTEMA INICIADO
echo ========================================
echo.
echo Backend API:   http://localhost:5000
echo Frontend Web:  http://localhost:5173
echo.
echo Presiona cualquier tecla para abrir el navegador...
pause > nul

start http://localhost:5173