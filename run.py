"""
Convenience entry point to run the Emergency Ambulance Routing server.
"""
import os
import subprocess
import sys
import time
import uvicorn

# Ensure UTF-8 output on Windows consoles to prevent cp1252 crashes
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

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

if __name__ == "__main__":
    free_port(8000)
    print("[AMBULANCE] Starting Emergency Ambulance Smart Routing Server on http://localhost:8000 ...")
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=False)
