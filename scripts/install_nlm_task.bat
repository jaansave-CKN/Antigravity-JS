@echo off
echo ========================================
echo   INSTALANDO TASK NLM AUTH 24/7
echo ========================================
echo.

schtasks /create /tn "Antigravity_NLM_Auth" /xml "scripts\nlm_scheduler_task.xml" /f

if %errorlevel% equ 0 (
    echo.
    echo [OK] Tarea instalada correctamente
    echo     Se ejecutara a las 8:00 AM y 8:00 PM diario
    echo.
    schtasks /query /tn "Antigravity_NLM_Auth"
) else (
    echo.
    echo [ERROR] No se pudo crear la tarea
    echo.
    pause
)