@echo off
echo ========================================
echo   INSTALANDO TAREAS PROGRAMADAS
echo   RADAR FONDOS 24/7
echo ========================================
echo.

set TASKS_DIR=C:\2026 AI EGIOC5\Antigravity JS\proyectos\Proy_03_RadarFondos\tasks

echo [1/4] Instalando tarea API Server...
schtasks /create /tn "RadarFondos_API" /xml "%TASKS_DIR%\radar_api_task.xml" /f
if %errorlevel% equ 0 (
    echo    [OK] API Server instalado
) else (
    echo    [ERROR] API Server
)

echo [2/4] Instalando tarea Frontend...
schtasks /create /tn "RadarFondos_Frontend" /xml "%TASKS_DIR%\radar_frontend_task.xml" /f
if %errorlevel% equ 0 (
    echo    [OK] Frontend instalado
) else (
    echo    [ERROR] Frontend
)

echo [3/4] Instalando tarea RadarWeb Agent...
schtasks /create /tn "RadarFondos_Agent" /xml "%TASKS_DIR%\radar_agent_task.xml" /f
if %errorlevel% equ 0 (
    echo    [OK] RadarWeb Agent instalado
) else (
    echo    [ERROR] RadarWeb Agent
)

echo [4/4] Instalando tarea NLM Auth...
schtasks /create /tn "Antigravity_NLM_Auth" /xml "C:\2026 AI EGIOC5\Antigravity JS\scripts\nlm_scheduler_task.xml" /f
if %errorlevel% equ 0 (
    echo    [OK] NLM Auth instalado
) else (
    echo    [ERROR] NLM Auth
)

echo.
echo ========================================
echo   TAREAS INSTALADAS
echo ========================================
echo.
echo   RadarFondos_API      - Inicia con Windows
echo   RadarFondos_Frontend - Inicia con Windows
echo   RadarFondos_Agent    - 6AM, 12PM, 6PM daily
echo   Antigravity_NLM_Auth - 8AM, 8PM daily
echo.
echo   Ver tareas: schtasks /query /tn "RadarFondos_API"
echo   Eliminar:   schtasks /delete /tn "RadarFondos_API" /f
echo.
pause