"""
Dedicated Frontend Server Launcher
Serves the static web dashboard on http://localhost:3000
and automatically connects to the FastAPI backend running on http://localhost:8000
"""

import os
import subprocess
import sys
import time
from pathlib import Path
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# Ensure UTF-8 output on Windows consoles
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

PORT = 3000
STATIC_DIR = Path(__file__).resolve().parent / "static"

def free_port(port: int):
    """Frees the specified port by terminating any stale process listening on it to prevent Errno 10048."""
    try:
        my_pid = os.getpid()
        out = subprocess.run(['netstat', '-ano'], capture_output=True, text=True, errors='replace').stdout
        pids = set()
        for line in out.splitlines():
            if f':{port} ' in line or f':{port}\t' in line:
                parts = line.strip().split()
                if parts and parts[-1].isdigit():
                    pid = int(parts[-1])
                    if pid not in (0, 4, my_pid):
                        pids.add(str(pid))
        for pid in pids:
            print(f"[PORT CHECK] Freed port {port} (terminated previous process PID {pid})")
            subprocess.run(['taskkill', '/F', '/T', '/PID', pid], capture_output=True)
        if pids:
            time.sleep(0.8)
    except Exception:
        pass

app = FastAPI(title="AmbuRouteX Frontend Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files directly at root with HTML mode
app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")

if __name__ == "__main__":
    free_port(PORT)
    print("=" * 60)
    print("🚑 AMBU-ROUTEX FRONTEND SERVER")
    print(f"Serving Static Files from: {STATIC_DIR}")
    print(f"Frontend URL: http://localhost:{PORT}")
    print("Connected Backend: http://localhost:8000 (REST & WebSockets)")
    print("=" * 60)
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="warning")
