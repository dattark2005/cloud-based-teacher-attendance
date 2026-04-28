"""
+----------------------------------------------------------+
|        Teacher Attendance System -- Master Launcher      |
|  Starts:                                                 |
|    [1] Python Face Service  (REST + WS live-detect) :8000|
|    [2] Node.js Backend                              :5000 |
|    [3] Vite Frontend                                :3000 |
|  Usage:  python run.py                                   |
+----------------------------------------------------------+
"""

import subprocess
import sys
import os
import time
import threading
import signal
import webbrowser
from pathlib import Path

# Force UTF-8 stdout on Windows to avoid cp1252 UnicodeEncodeError
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# ── Enable ANSI color codes on Windows ──────────────────────────────────────
os.system("")

# ── Paths ────────────────────────────────────────────────────────────────────
ROOT         = Path(__file__).parent.resolve()
BACKEND_DIR  = ROOT / "backend"
FRONTEND_DIR = ROOT / "frontend"

# ── ANSI colors ──────────────────────────────────────────────────────────────
RESET   = "\033[0m"
BOLD    = "\033[1m"
RED     = "\033[91m"
GREEN   = "\033[92m"
YELLOW  = "\033[93m"
BLUE    = "\033[94m"
MAGENTA = "\033[95m"
CYAN    = "\033[96m"
WHITE   = "\033[97m"

def c(color, text):
    return f"{color}{text}{RESET}"

# ── Banner ───────────────────────────────────────────────────────────────────
def print_banner():
    print()
    print(c(CYAN,  "+======================================================+"))
    print(c(CYAN,  "|") + c(BOLD+WHITE, "     Teacher Attendance System -- Master Launcher   ") + c(CYAN, "|"))
    print(c(CYAN,  "+======================================================+"))
    print()

# ── Stream subprocess output with color label ─────────────────────────────────
def stream_output(proc, label, color):
    for line in iter(proc.stdout.readline, b""):
        text = line.decode("utf-8", errors="replace").rstrip()
        if text:
            print(f"  {color}[{label}]{RESET} {text}", flush=True)

# ── Ensure npm deps installed ─────────────────────────────────────────────────
def ensure_npm_deps(directory: Path, label: str):
    if not (directory / "node_modules").exists():
        print(c(YELLOW, f"  [*] Installing {label} npm dependencies..."))
        result = subprocess.run(
            ["npm", "install"],
            cwd=str(directory),
            capture_output=True,
            shell=True
        )
        if result.returncode != 0:
            print(c(RED, f"  [!] npm install failed for {label}"))
            print(result.stderr.decode(errors="replace"))
            sys.exit(1)
        print(c(GREEN, f"  [OK] {label} dependencies installed"))
    else:
        print(c(GREEN, f"  [OK] {label} node_modules found"))

# ── Health-check with retry ───────────────────────────────────────────────────
def wait_for_service(url: str, label: str, color: str, timeout: int = 30):
    import urllib.request
    print(c(color, f"  [...] Waiting for {label}..."), flush=True)
    for _ in range(timeout):
        try:
            urllib.request.urlopen(url, timeout=2)
            print(c(GREEN, f"  [UP] {label} -> {url}"))
            return True
        except Exception:
            time.sleep(1)
    print(c(RED, f"  [!!] {label} did not respond in {timeout}s — check logs above"))
    return False

# ── Global process registry for cleanup ──────────────────────────────────────
processes = []

def shutdown(sig=None, frame=None):
    print()
    print(c(YELLOW, "  [>>] Stopping all services..."))
    for proc, label in processes:
        try:
            proc.terminate()
            print(c(RED, f"  [--] Stopped [{label}]"))
        except Exception:
            pass
    print(c(CYAN, "  Goodbye!\n"))
    sys.exit(0)

signal.signal(signal.SIGINT,  shutdown)
signal.signal(signal.SIGTERM, shutdown)

# ── Main ─────────────────────────────────────────────────────────────────────
def main():
    print_banner()

    # Step 1 — npm deps
    print(c(BOLD+WHITE, "  [1/4] Checking npm dependencies...\n"))
    ensure_npm_deps(BACKEND_DIR,  "Backend")
    ensure_npm_deps(FRONTEND_DIR, "Frontend")
    print()

    # Step 2 — Python Face Service (port 8000)
    print(c(BOLD+WHITE, "  [2/4] Starting Python Face Service on :8000...\n"))
    face_proc = subprocess.Popen(
        [sys.executable, "face_service.py"],
        cwd=str(ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        shell=False,
    )
    processes.append((face_proc, "FaceService"))
    threading.Thread(
        target=stream_output, args=(face_proc, "FaceService", MAGENTA), daemon=True
    ).start()

    # First run downloads models (~50 MB) — allow extra time
    wait_for_service("http://localhost:8000/health", "Face Service", MAGENTA, timeout=90)
    print()

    # Step 3 — Node.js Backend (port 5000)
    print(c(BOLD+WHITE, "  [3/4] Starting Node.js Backend on :5000...\n"))
    node_proc = subprocess.Popen(
        ["npm", "run", "dev"],
        cwd=str(BACKEND_DIR),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        shell=True,
    )
    processes.append((node_proc, "Backend"))
    threading.Thread(
        target=stream_output, args=(node_proc, "Backend", GREEN), daemon=True
    ).start()

    wait_for_service("http://localhost:5000/health", "Node Backend", GREEN, timeout=20)
    print()

    # Step 4 — Vite Frontend (port 3000)
    print(c(BOLD+WHITE, "  [4/4] Starting Vite Frontend on :3000...\n"))
    vite_proc = subprocess.Popen(
        ["npm", "run", "dev"],
        cwd=str(FRONTEND_DIR),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        shell=True,
    )
    processes.append((vite_proc, "Frontend"))
    threading.Thread(
        target=stream_output, args=(vite_proc, "Frontend", BLUE), daemon=True
    ).start()

    # Give Vite a moment to bind the port
    time.sleep(5)

    # Ready banner
    print()
    print(c(CYAN,   "  +================================================+"))
    print(c(CYAN,   "  |") + c(BOLD+GREEN, "  [OK] All services are running!              ") + c(CYAN, "|"))
    print(c(CYAN,   "  +================================================+"))
    print(c(CYAN,   "  |") + f"  {c(BLUE,'Frontend')}      ->  http://localhost:3000         " + c(CYAN, "|"))
    print(c(CYAN,   "  |") + f"  {c(GREEN,'Backend')}       ->  http://localhost:5000         " + c(CYAN, "|"))
    print(c(CYAN,   "  |") + f"  {c(MAGENTA,'Face API')}     ->  http://localhost:8000         " + c(CYAN, "|"))
    print(c(CYAN,   "  |") + f"  {c(MAGENTA,'Live Detect')} ->  ws://localhost:8000/ws/live-detect" + c(CYAN, "|"))
    print(c(CYAN,   "  +================================================+"))
    print(c(CYAN,   "  |") + c(YELLOW,     "  Press Ctrl+C to stop all services           ") + c(CYAN, "|"))
    print(c(CYAN,   "  +================================================+"))
    print()

    # Open browser
    webbrowser.open("http://localhost:3000")

    # Keep alive — watch for unexpected crashes
    try:
        while True:
            for proc, label in processes:
                if proc.poll() is not None:
                    print(c(RED, f"\n  [!!] [{label}] crashed (exit {proc.returncode})"))
                    print(c(YELLOW, "  Fix the issue then re-run:  python run.py"))
                    shutdown()
            time.sleep(2)
    except KeyboardInterrupt:
        shutdown()


if __name__ == "__main__":
    main()
