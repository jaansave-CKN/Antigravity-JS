@echo off
@echo off
cd "C:\2026 AI EGIOC5\Antigravity JS"
echo Restando servidor...
taskkill /F /IM node.exe 2>nul
timeout /t 2 /nobreak >nul
start node server.js
timeout /t 3 /nobreak >nul
start http://localhost:5000/proyecto01.html