@echo off
REM =============================================================================
REM  INICIAR_TODO_v2.bat
REM  RADAR FONDOS 360 — Launcher Windows Batch (equiv. a PowerShell v2)
REM
REM  Lanza:  FastAPI + Scheduler + (opcional) Vite  — tres procesos separados
REM  Sin colisiones gracias a puertos fijos y CWD explicitos.
REM =============================================================================
echo.
echo ======================================================================
echo    RADAR FONDOS 360 — LEVANTANDO SERVICIOS
echo ======================================================================
echo.

cd /d "%~dp0"

set "PROJECT_ROOT=%~dp0"
set "VENV_DIR=%PROJECT_ROOT%\.venv"
set "BACKEND_DIR=%PROJECT_ROOT%backend"
set "SIA_DIR=%PROJECT_ROOT%SIA_Radar"
set "LOGS_DIR=%PROJECT_ROOT%logs"

:: Python: preferir venv
set "PYTHON=%VENV_DIR%\Scripts\python.exe"
if not exist "%PYTHON%" set "PYTHON=python"

set "API_PORT=8000"
set "FRONT_PORT=5173"
set "PYTHONPATH=%BACKEND_DIR%;%SIA_DIR%;%PYTHONPATH%"

echo [1/3] Inicializando base de datos...
"%PYTHON%" -c "import sys; sys.path.insert(0,r'%BACKEND_DIR%'); from database import init_db; print('BD lista:', init_db())"
if errorlevel 1 (
    echo [ERROR] Fallo init_db. Abortando.
    pause
    exit /b 1
)

echo.
echo [2/3] Levantando FastAPI en puerto %API_PORT% ...
start /B "RadarFastAPI" "%PYTHON%" -m uvicorn SIA_Radar.api.main:app --host 0.0.0.0 --port %API_PORT% --reload --log-level info > "%LOGS_DIR%\api_stdout.log" 2>&1
set "API_PID=%!"
echo    [OK] API PID: %API_PID%

:: Esperar hasta max 20 s
echo    Esperando respuesta de la API...
set /a _timeout=20
set /a _waited=0
:wait_api
timeout /t 1 /nobreak >nul
set /a _waited+=1
curl -s http://localhost:%API_PORT%/health >nul 2>&1
if not errorlevel 1 goto api_ready
if %_waited% lss %_timeout% goto wait_api
echo    [WARN] API no respondio en %_timeout% s. Revisa %LOGS_DIR%\api_stdout.log

:api_ready
echo    [OK] API respondio en http://localhost:%API_PORT%

echo.
echo [3/3] Levantando Scheduler 24/7...
start /B "RadarScheduler" "%PYTHON%" -m backend.workers.scheduler > "%LOGS_DIR%\scheduler_stdout.log" 2>&1
set "SCHED_PID=%!"
echo    [OK] Scheduler PID: %SCHED_PID%

echo.
echo ======================================================================
echo    SERVICIOS ACTIVOS
echo ======================================================================
echo    API  FastAPI:     http://localhost:%API_PORT%
echo                       http://localhost:%API_PORT%/docs
echo                       http://localhost:%API_PORT%/health
echo                       ws://localhost:%API_PORT%/ws/convocatorias
echo.
echo    Scheduler 24/7:  PID %SCHED_PID%
echo    API PID:         PID %API_PID%
echo.
echo    Logs API:        logs\api_stdout.log
echo    Logs Scheduler:  logs\scheduler_stdout.log
echo.
echo    Para detener:
echo       taskkill /PID %API_PID% /F
echo       taskkill /PID %SCHED_PID% /F
echo ======================================================================
echo.
echo   Frontend: ejecutar manualmente ^<Ctrl+C para salir^>
echo       npm run dev
echo.
pause

:: Cleanup al cerrar
echo.
echo [SHUTDOWN] Deteniendo servicios...
taskkill /PID %API_PID% /F >nul 2>&1
taskkill /PID %SCHED_PID% /F >nul 2>&1
echo [DONE]
pause
