@echo off
cd /d "%~dp0"
python radar_auto.py
timeout /t 14400 /nobreak >nul
goto start