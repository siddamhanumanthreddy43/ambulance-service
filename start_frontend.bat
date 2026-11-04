@echo off
title AMBU-ROUTEX Frontend Server (Port 3000)
color 0B
echo ============================================================
echo   AMBU-ROUTEX: Dedicated Leaflet HUD Frontend
echo ============================================================
echo   URL:          http://localhost:3000
echo   Target API:   http://localhost:8000
echo ============================================================
echo Starting HTTP server on port 3000...
echo.

python run_frontend.py
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Frontend failed to start.
    pause
)

