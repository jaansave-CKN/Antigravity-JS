@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo.
echo ======================================================================
echo   RADAR FORMULADOR 360 -- Arranque Completo del Sistema
echo   Node.js Backend (8000) + AI Service (8100) + Vite (5173)
echo ======================================================================
echo.

set "ROOT=%~dp0"
set "VENV=%ROOT%.venv"
set "LOG_DIR=%ROOT%logs"
set "NODE_PORT=8000"
set "AI_PORT=8100"
set "FRONT_PORT=5173"

:: ── Crear carpeta de logs ─────────────────────────────────────────────────
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

:: ── Detectar Python ───────────────────────────────────────────────────────
set "PY=%VENV%\Scripts\python.exe"
if not exist "%PY%" set "PY=python"

:: ── Detectar Node ─────────────────────────────────────────────────────────
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js no encontrado en el PATH.
    pause & exit /b 1
)

echo [CHECK] Node.js: OK  ^|  Python: %PY%
echo.

:: ======================================================================
:: PASO 1 — Node.js Backend (server.js)
:: ======================================================================
echo [1/3] Levantando Node.js Backend en puerto %NODE_PORT% ...
start "RadarBackend" cmd /k "cd /d "%ROOT%" && node --env-file=.env server.js"

:: Esperar hasta 20 s a que responda /api/health
set /a _w=0
:wait_node
timeout /t 2 /nobreak >nul
set /a _w+=2
curl -s http://localhost:%NODE_PORT%/api/health >nul 2>&1
if not errorlevel 1 goto node_ok
if %_w% lss 20 goto wait_node
echo [WARN] Node.js no respondio en 20 s. Continua de todas formas...
goto node_done
:node_ok
echo       [OK] Node.js activo en http://localhost:%NODE_PORT%
:node_done

:: ======================================================================
:: PASO 2 — AI Service (FastAPI + LangGraph, puerto 8100)
:: ======================================================================
echo.
echo [2/3] Levantando AI Service en puerto %AI_PORT% ...

:: Instalar deps si no existen (silencioso)
if exist "%VENV%\Scripts\python.exe" (
    "%PY%" -m pip install -r "%ROOT%ai_service\requirements.txt" --quiet >nul 2>&1
)

start "RadarAIService" cmd /k "cd /d "%ROOT%" && "%PY%" -m uvicorn ai_service.main:app --host 0.0.0.0 --port %AI_PORT% --reload --reload-dir ai_service --log-level info 2>&1 | tee "%LOG_DIR%\ai_service.log""

:: Esperar hasta 30 s (el microservicio Python tarda mas en arrancar)
set /a _w=0
:wait_ai
timeout /t 3 /nobreak >nul
set /a _w+=3
curl -s http://localhost:%AI_PORT%/health >nul 2>&1
if not errorlevel 1 goto ai_ok
if %_w% lss 30 goto wait_ai
echo [WARN] AI Service no respondio en 30 s. Revisa %LOG_DIR%\ai_service.log
goto ai_done
:ai_ok
echo       [OK] AI Service activo en http://localhost:%AI_PORT%/docs
:ai_done

:: ======================================================================
:: PASO 3 — Frontend Vite (puerto 5173)
:: ======================================================================
echo.
echo [3/3] Levantando Frontend Vite en puerto %FRONT_PORT% ...
start "RadarFrontend" cmd /k "cd /d "%ROOT%" && npm run dev:frontend 2>&1 | tee "%LOG_DIR%\frontend.log""

:: Esperar 8 s a Vite (es rapido)
timeout /t 8 /nobreak >nul
curl -s http://localhost:%FRONT_PORT%/ >nul 2>&1
if not errorlevel 1 (
    echo       [OK] Frontend activo en http://localhost:%FRONT_PORT%
) else (
    echo [WARN] Frontend aun arrancando en http://localhost:%FRONT_PORT%
)

:: ======================================================================
:: ESTADO FINAL
:: ======================================================================
echo.
echo ======================================================================
echo   SISTEMA ACTIVO
echo ======================================================================
echo.
echo   Frontend    http://localhost:%FRONT_PORT%
echo   Backend     http://localhost:%NODE_PORT%/api/health
echo   AI Service  http://localhost:%AI_PORT%/health
echo   Docs IA     http://localhost:%AI_PORT%/docs
echo.
echo   Logs:
echo     AI Service  logs\ai_service.log
echo     Frontend    logs\frontend.log
echo.
echo   Para detener: cierra las 3 ventanas CMD abiertas.
echo ======================================================================
echo.

:: Abrir navegador
choice /t 5 /d S /m "Abrir http://localhost:%FRONT_PORT% en el navegador? (S/N - auto en 5 s)"
if not errorlevel 2 start http://localhost:%FRONT_PORT%

pause
