@echo off
title AMBU-ROUTEX Dual Server Launcher
color 0F
echo ============================================================
echo   AMBU-ROUTEX: Emergency Ambulance Smart Routing System
echo ============================================================
echo   Backend Server:   http://localhost:8000
echo   Frontend Server:  http://localhost:3000
echo   WebSocket Stream: ws://localhost:8000/ws/ambulance
echo ============================================================
echo.
echo Launching both servers...
echo.

:: Automatically open browser after 2 seconds in the background
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:8000"

python start_servers.py
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] An error occurred while running the servers.
    echo Please verify Python is installed on your PATH.
    pause
)
