@echo off
echo ========================================
echo   RADAR 360 - INICIANDO SISTEMA
echo ========================================
echo.

cd /d "%~dp0"

echo [1/3] Verificando Python...
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python no esta instalado
    pause
    exit /b 1
)

echo [2/3] Iniciando API (Backend)...
start "RadarAPI" cmd /k "cd /d "%~dp0backend" && python api.py"

timeout /t 5 /nobreak > nul

echo [3/3] Iniciando Frontend...
start "RadarWeb" cmd /k "cd /d "%~dp0" && npm run dev"

echo.
echo ========================================
echo   SISTEMA INICIADO
echo ========================================
echo.
echo ABRE ESTE ENLACE EN TU NAVEGADOR:
echo.
echo   http://localhost:5173
echo.
echo Presiona cualquier tecla para abrirlo...
echo.
pause > nul

start http://localhost:5173