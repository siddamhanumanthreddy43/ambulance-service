"""
AMBU-ROUTEX: Unified Server Launcher
Starts both the FastAPI Backend (Port 8000) and Dedicated Frontend Server (Port 3000) concurrently.
"""

import sys
import subprocess
import time
import os
import signal

# Ensure UTF-8 output on Windows
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

def main():
    root_dir = os.path.dirname(os.path.abspath(__file__))
    python_exe = sys.executable

    print("=" * 65)
    print("🚑 AMBU-ROUTEX DUAL SERVER LAUNCHER")
    print("=" * 65)
    print(f"Backend Server:   http://localhost:8000 (FastAPI REST & WebSockets)")
    print(f"Frontend Server:  http://localhost:3000 (Leaflet Driver HUD)")
    print("-" * 65)

    # Pre-flight check: ensure ports 8000 and 3000 are clean
    free_port(8000)
    free_port(3000)

    print("Starting processes...")

    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"

    backend_proc = subprocess.Popen(
        [python_exe, os.path.join(root_dir, "run.py")],
        cwd=root_dir,
        env=env
    )

    frontend_proc = subprocess.Popen(
        [python_exe, os.path.join(root_dir, "run_frontend.py")],
        cwd=root_dir,
        env=env
    )

    print("\n✅ Both servers are running!")
    print("👉 Open your browser to: http://localhost:8000  (or http://localhost:3000)")
    print("\nPress Ctrl+C to terminate both servers...\n")

    try:
        while True:
            time.sleep(1)
            # Auto-restart if any process dies unexpectedly
            if backend_proc.poll() is not None:
                print(f"[RELOAD] Restarting backend server...")
                backend_proc = subprocess.Popen(
                    [python_exe, os.path.join(root_dir, "run.py")],
                    cwd=root_dir,
                    env=env
                )
            if frontend_proc.poll() is not None:
                print(f"[RELOAD] Restarting frontend server...")
                frontend_proc = subprocess.Popen(
                    [python_exe, os.path.join(root_dir, "run_frontend.py")],
                    cwd=root_dir,
                    env=env
                )
    except KeyboardInterrupt:
        print("\n[SHUTDOWN] Stopping servers...")
    finally:
        for proc, name in [(backend_proc, "Backend"), (frontend_proc, "Frontend")]:
            if proc.poll() is None:
                try:
                    proc.terminate()
                    proc.wait(timeout=3)
                except Exception:
                    proc.kill()
        print("[SHUTDOWN] All servers stopped cleanly.")

if __name__ == "__main__":
    main()

