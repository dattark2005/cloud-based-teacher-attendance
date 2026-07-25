"""
+----------------------------------------------------------+
|        Teacher Attendance System -- Master Launcher      |
|  Starts:                                                 |
|    [1] Python Face Service  (REST + WS live-detect) :8000|
|    [2] Python Voice Service (resemblyzer)           :8001|
|    [3] Node.js Backend                              :5000 |
|    [4] Vite Frontend                                :3000 |
|                                                          |
|  Usage:                                                  |
|    python run.py           ← start all services          |
|    python run.py --test    ← check imports + run tests   |
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
REQ_FILE     = ROOT / "requirements.txt"

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


# ══════════════════════════════════════════════════════════════════════════════
# TEST MODE  —  python run.py --test
# ══════════════════════════════════════════════════════════════════════════════

# Maps import-name → pip package name
IMPORT_TO_PKG = {
    "fastapi":            "fastapi>=0.110.0",
    "uvicorn":            "uvicorn[standard]>=0.29.0",
    "motor":              "motor>=3.4.0",
    "PIL":                "pillow>=10.3.0",
    "numpy":              "numpy>=1.26.4",
    "cv2":                "opencv-contrib-python>=4.9.0.80",
    "cloudinary":         "cloudinary>=1.39.0",
    "dotenv":             "python-dotenv>=1.0.1",
    "multipart":          "python-multipart>=0.0.9",
    "httpx":              "httpx>=0.27.0",
    "bson":               "pymongo>=4.6.0",
    "pytest":             "pytest>=8.0.0",
    "starlette":          "starlette>=0.36.0",
    "websockets":         "websockets>=12.0",
    "torch":              "torch>=2.0.0",
    "scipy":              "scipy>=1.11.0",
    "resemblyzer":        "resemblyzer>=0.1.1.dev0",
    "soundfile":          "soundfile>=0.12.1",
    "speech_recognition": "SpeechRecognition>=3.10.0",
    "av":                 "av>=12.0.0",
}

PKG_INSTALL_NAME = {
    "fastapi":            "fastapi",
    "uvicorn":            "uvicorn[standard]",
    "motor":              "motor",
    "PIL":                "pillow",
    "numpy":              "numpy",
    "cv2":                "opencv-contrib-python",
    "cloudinary":         "cloudinary",
    "dotenv":             "python-dotenv",
    "multipart":          "python-multipart",
    "httpx":              "httpx",
    "bson":               "pymongo",
    "pytest":             "pytest",
    "starlette":          "starlette",
    "websockets":         "websockets",
    "torch":              "torch",
    "scipy":              "scipy",
    "resemblyzer":        "resemblyzer",
    "soundfile":          "soundfile",
    "speech_recognition": "SpeechRecognition",
    "av":                 "av",
}


def ensure_env_files():
    """Auto-create default .env files if missing."""
    backend_env = BACKEND_DIR / ".env"
    if not backend_env.exists():
        content = """PORT=5000
MONGODB_URI=mongodb://localhost:27017/teacher_attendance
JWT_SECRET=super_secret_jwt_key_12345
FACE_SERVICE_URL=http://localhost:8000
VOICE_SERVICE_URL=http://localhost:8001
"""
        backend_env.write_text(content, encoding="utf-8")
        print(c(GREEN, "  [+] Auto-created default backend/.env"))

    frontend_env = FRONTEND_DIR / ".env"
    if not frontend_env.exists():
        content = """VITE_API_URL=http://localhost:5000/api
VITE_FACE_SERVICE_URL=http://localhost:8000
VITE_VOICE_SERVICE_URL=http://localhost:8001
"""
        frontend_env.write_text(content, encoding="utf-8")
        print(c(GREEN, "  [+] Auto-created default frontend/.env"))


def check_and_install_imports():
    """Check every package needed by services. Auto-install if missing or requirement updated."""
    import importlib
    print(c(BOLD+WHITE, "  [*] Checking Python imports & dependencies...\n"))
    
    # Run pip install -r requirements.txt to ensure all exact versions are satisfied
    if REQ_FILE.exists():
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "-r", str(REQ_FILE), "--quiet"],
            shell=False
        )

    missing = []
    for mod, req in IMPORT_TO_PKG.items():
        try:
            importlib.import_module(mod)
            print(c(GREEN,  f"  [OK] import {mod}"))
        except ImportError:
            print(c(YELLOW, f"  [!]  import {mod}  → MISSING"))
            missing.append((mod, req))

    if not missing:
        print(c(GREEN, "\n  [OK] All Python packages present"))
        return

    print(c(YELLOW, f"\n  [*]  Auto-installing {len(missing)} missing package(s)..."))
    for mod, req in missing:
        name = PKG_INSTALL_NAME[mod]
        r = subprocess.run(
            [sys.executable, "-m", "pip", "install", name, "--quiet"],
            capture_output=True, text=True
        )
        if r.returncode == 0:
            print(c(GREEN, f"  [OK] Installed {name}"))
        else:
            print(c(RED,   f"  [!!] Failed: {name}"))
            print(r.stderr[:300])

    # Update requirements.txt
    existing = REQ_FILE.read_text(encoding="utf-8") if REQ_FILE.exists() else ""
    lines = [l.strip() for l in existing.splitlines() if l.strip()]
    added = []
    for mod, req in missing:
        base = req.split(">=")[0].split("[")[0]
        if not any(base.lower() in l.lower() for l in lines):
            lines.append(req)
            added.append(req)
    if added:
        REQ_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")
        for a in added:
            print(c(CYAN, f"  [+]  Added to requirements.txt: {a}"))


def run_python_tests():
    """Run pytest on tests/ directory."""
    print()
    print(c(BOLD+WHITE, "  [*] Running Python tests (pytest)...\n"))
    test_files = list((ROOT / "tests").glob("test_*.py"))
    if not test_files:
        print(c(YELLOW, "  [!]  No Python test files found in tests/"))
        return True
    args = [sys.executable, "-m", "pytest"] + [str(f) for f in test_files] + ["-v", "--tb=short", "--no-header"]
    r = subprocess.run(args, cwd=str(ROOT))
    return r.returncode == 0


def run_js_tests():
    """Run Jest tests in backend/."""
    print()
    print(c(BOLD+WHITE, "  [*] Running Node.js tests (Jest)...\n"))
    if not (BACKEND_DIR / "node_modules").exists():
        print(c(YELLOW, "  [*]  Installing backend npm deps first..."))
        subprocess.run(["npm", "install"], cwd=str(BACKEND_DIR), shell=True)
    r = subprocess.run(
        ["npm", "test", "--", "--forceExit", "--verbose"],
        cwd=str(BACKEND_DIR), shell=True
    )
    return r.returncode == 0


def run_tests():
    print_banner()
    print(c(CYAN, "  MODE: TEST\n"))

    check_and_install_imports()
    py_ok = run_python_tests()
    js_ok = run_js_tests()

    # ── Final summary ──────────────────────────────────────────────────────
    print()
    print(c(CYAN,  "  +================================================+"))
    print(c(CYAN,  "  |") + c(BOLD, "       TEST RUNNER — FINAL REPORT             ") + c(CYAN, "|"))
    print(c(CYAN,  "  +================================================+"))
    py_s = c(GREEN+BOLD, "PASSED ✓") if py_ok else c(RED+BOLD, "FAILED ✗")
    js_s = c(GREEN+BOLD, "PASSED ✓") if js_ok else c(RED+BOLD, "FAILED ✗")
    print(c(CYAN,  "  |") + f"  Python tests (pytest)  : {py_s}         " + c(CYAN, "|"))
    print(c(CYAN,  "  |") + f"  Node.js tests (Jest)   : {js_s}         " + c(CYAN, "|"))
    overall = c(GREEN+BOLD, "ALL SYSTEMS GO ✓") if (py_ok and js_ok) else c(RED+BOLD, "ISSUES FOUND ✗")
    print(c(CYAN,  "  +================================================+"))
    print(c(CYAN,  "  |") + f"  Overall : {overall}" + " " * 21 + c(CYAN, "|"))
    print(c(CYAN,  "  +================================================+"))
    print()
    sys.exit(0 if (py_ok and js_ok) else 1)


# ══════════════════════════════════════════════════════════════════════════════
# LAUNCH MODE  —  python run.py
# ══════════════════════════════════════════════════════════════════════════════

def main():
    print_banner()

    # Step 0 — Environment files setup
    ensure_env_files()

    # Step 1 — Python dependencies check & auto-install
    check_and_install_imports()
    print()

    # Step 2 — npm deps
    print(c(BOLD+WHITE, "  [2/5] Checking npm dependencies...\n"))
    ensure_npm_deps(BACKEND_DIR,  "Backend")
    ensure_npm_deps(FRONTEND_DIR, "Frontend")
    print()

    # Step 3 — Python Face Service (port 8000)
    print(c(BOLD+WHITE, "  [3/5] Starting Python Face Service on :8000...\n"))
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

    # Step 4 — Python Voice Service (port 8001)
    voice_svc_file = ROOT / "voice_service.py"
    if voice_svc_file.exists():
        print(c(BOLD+WHITE, "  [4/5] Starting Python Voice Service on :8001...\n"))
        voice_proc = subprocess.Popen(
            [sys.executable, "voice_service.py"],
            cwd=str(ROOT),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            shell=False,
        )
        processes.append((voice_proc, "VoiceService"))
        threading.Thread(
            target=stream_output, args=(voice_proc, "VoiceService", CYAN), daemon=True
        ).start()
        wait_for_service("http://localhost:8001/health", "Voice Service", CYAN, timeout=30)
    else:
        print(c(YELLOW, "  [~] voice_service.py not found — skipping Voice Service"))
    print()

    # Step 5 — Node.js Backend (port 5000)
    print(c(BOLD+WHITE, "  [5/5] Starting Node.js Backend on :5000...\n"))
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

    # Step 6 — Vite Frontend (port 3000)
    # On Windows, Vite writes to stderr which gets swallowed by pipes.
    # Launch in its own visible console window so output always shows.
    print(c(BOLD+WHITE, "  [6/6] Starting Vite Frontend on :3000...\n"))
    vite_proc = subprocess.Popen(
        'start "[Frontend] Vite Dev Server" cmd /k "npm run dev"',
        cwd=str(FRONTEND_DIR),
        shell=True,
    )
    processes.append((vite_proc, "Frontend"))

    # Wait until Vite actually binds port 3000
    frontend_up = wait_for_service("http://localhost:3000", "Vite Frontend", BLUE, timeout=30)
    print()

    # Ready banner
    print(c(CYAN,   "  +================================================+"))
    if frontend_up:
        print(c(CYAN, "  |") + c(BOLD+GREEN, "  [OK] All services are running!              ") + c(CYAN, "|"))
    else:
        print(c(CYAN, "  |") + c(BOLD+YELLOW, "  [~]  Backend/Face up; Frontend may lag      ") + c(CYAN, "|"))
    print(c(CYAN,   "  +================================================+"))
    print(c(CYAN,   "  |") + f"  {c(BLUE,'Frontend')}      -> http://localhost:3000         " + c(CYAN, "|"))
    print(c(CYAN,   "  |") + f"  {c(GREEN,'Backend')}       -> http://localhost:5000         " + c(CYAN, "|"))
    print(c(CYAN,   "  |") + f"  {c(MAGENTA,'Face API')}     -> http://localhost:8000         " + c(CYAN, "|"))
    print(c(CYAN,   "  |") + f"  {c(CYAN,'Voice API')}    -> http://localhost:8001         " + c(CYAN, "|"))
    print(c(CYAN,   "  |") + f"  {c(MAGENTA,'Live Detect')} -> ws://localhost:8000/ws/live-detect" + c(CYAN, "|"))
    print(c(CYAN,   "  +================================================+"))
    print(c(CYAN,   "  |") + c(YELLOW, "  Press Ctrl+C to stop all services           ") + c(CYAN, "|"))
    print(c(CYAN,   "  +================================================+"))
    print()

    # Open browser once frontend is confirmed up
    if frontend_up:
        webbrowser.open("http://localhost:3000")
    else:
        print(c(YELLOW, "  [!] Open http://localhost:3000 manually once Vite finishes starting."))

    # Keep alive — watch for unexpected crashes (skip Frontend; it has its own window)
    try:
        while True:
            for proc, label in processes:
                if label == "Frontend":
                    continue  # runs in its own cmd window; launcher exits 0 immediately
                if proc.poll() is not None:
                    print(c(RED, f"\n  [!!] [{label}] crashed (exit {proc.returncode})"))
                    print(c(YELLOW, "  Fix the issue then re-run:  python run.py"))
                    shutdown()
            time.sleep(2)
    except KeyboardInterrupt:
        shutdown()


if __name__ == "__main__":
    if "--test" in sys.argv:
        run_tests()
    else:
        main()

