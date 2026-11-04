@echo off
title AMBU-ROUTEX Backend Server (Port 8000)
color 0A
echo ============================================================
echo   AMBU-ROUTEX: Emergency Routing FastAPI Backend
echo ============================================================
echo   URL:          http://localhost:8000
echo   API Docs:     http://localhost:8000/docs
echo   WebSocket:    ws://localhost:8000/ws/ambulance
echo ============================================================
echo Starting Uvicorn server on port 8000...
echo.

python run.py
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Backend failed to start. Ensure Python and dependencies are installed.
    echo Try running: pip install -r requirements.txt
    pause
)

