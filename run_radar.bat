@echo off
echo ========================================
echo   RADAR WEB - BUSQUEDA DE CONVOCATORIAS
echo ========================================
echo.

cd /d "C:\2026 AI EGIOC5\Antigravity JS\proyectos\Proy_03_RadarFondos"

echo [1] Verificando token NLM...
python "C:\2026 AI EGIOC5\Antigravity JS\scripts\nlm_auth_manager.py" check

echo.
echo [2] Ejecutando busqueda (modo deep)...
echo    Para modo rapido, elimina --deep
python radar_web_agent.py --deep

echo.
echo ========================================
echo   BUSQUEDA COMPLETADA
echo ========================================
echo.
pause