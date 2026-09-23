@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo.
echo ====================================================
echo   RADAR FORMULADOR 360 -- AI Service (Puerto 8100)
echo   LangGraph + FastAPI + Gemini -- Fase 3
echo ====================================================
echo.

set "ROOT=%~dp0"
set "VENV=%ROOT%.venv"
set "AI_REQ=%ROOT%ai_service\requirements.txt"
set "AI_PORT=8100"
set "LOG_DIR=%ROOT%logs"

:: ── Verificar que ai_service\main.py existe ────────────────────────────────
if not exist "%ROOT%ai_service\main.py" (
    echo [ERROR] No se encuentra ai_service\main.py
    echo         Asegurate de estar en la carpeta raiz del proyecto.
    pause & exit /b 1
)

:: ── Crear carpeta de logs si no existe ────────────────────────────────────
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

:: ── Detectar Python (venv primero, luego sistema) ─────────────────────────
set "PY=%VENV%\Scripts\python.exe"
if not exist "%PY%" (
    echo [INFO] .venv no encontrado. Usando Python del sistema...
    set "PY=python"
    python --version >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Python no esta instalado o no esta en el PATH.
        echo         Instala Python 3.11+ desde https://python.org
        pause & exit /b 1
    )
)

:: ── Mostrar version de Python ─────────────────────────────────────────────
echo [1/4] Verificando Python...
"%PY%" --version
echo       Ejecutable: %PY%

:: ── Crear venv si no existe ───────────────────────────────────────────────
if not exist "%VENV%\Scripts\python.exe" (
    echo.
    echo [2/4] Creando entorno virtual .venv ...
    python -m venv "%VENV%"
    if errorlevel 1 (
        echo [ERROR] No se pudo crear el entorno virtual.
        pause & exit /b 1
    )
    set "PY=%VENV%\Scripts\python.exe"
    echo       [OK] .venv creado en %VENV%
) else (
    echo [2/4] Entorno virtual .venv encontrado. [OK]
)

:: ── Instalar / actualizar dependencias ────────────────────────────────────
echo.
echo [3/4] Instalando dependencias desde ai_service\requirements.txt ...
"%PY%" -m pip install --upgrade pip --quiet
"%PY%" -m pip install -r "%AI_REQ%" --quiet
if errorlevel 1 (
    echo [ERROR] Fallo la instalacion de dependencias.
    echo         Revisa ai_service\requirements.txt y tu conexion a internet.
    pause & exit /b 1
)
echo       [OK] Dependencias instaladas.

:: ── Verificar puerto libre ────────────────────────────────────────────────
echo.
echo [4/4] Verificando puerto %AI_PORT%...
netstat -ano | findstr ":%AI_PORT% " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo [WARN] El puerto %AI_PORT% ya esta en uso.
    echo        Puede que el servicio ya este corriendo.
    echo        Continuar de todas formas? ^(S/N^)
    set /p CONT=">>> "
    if /i "!CONT!" neq "S" (
        echo Abortado.
        pause & exit /b 0
    )
)

:: ── Lanzar el servicio ────────────────────────────────────────────────────
echo.
echo ====================================================
echo   Lanzando AI Service en http://localhost:%AI_PORT%
echo   Docs:   http://localhost:%AI_PORT%/docs
echo   Health: http://localhost:%AI_PORT%/health
echo.
echo   Trabajando desde: %ROOT%
echo   Modulo:           ai_service.main:app
echo   Log:              %LOG_DIR%\ai_service.log
echo ====================================================
echo.
echo   Presiona Ctrl+C para detener el servicio.
echo.

"%PY%" -m uvicorn ai_service.main:app ^
    --host 0.0.0.0 ^
    --port %AI_PORT% ^
    --reload ^
    --reload-dir ai_service ^
    --log-level info ^
    2>&1 | tee "%LOG_DIR%\ai_service.log"

echo.
echo [AI Service detenido]
pause
