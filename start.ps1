# Teacher Attendance System — Master Start Script
Write-Host ""
Write-Host "╔════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   🎓  Teacher Attendance System — Startup      ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Definition

# 1) Install backend deps
Write-Host "📦 Installing Node.js backend dependencies..." -ForegroundColor Yellow
Push-Location "$ROOT\backend"
npm install --silent
Pop-Location

# 2) Install frontend deps
Write-Host "📦 Installing frontend dependencies..." -ForegroundColor Yellow
Push-Location "$ROOT\frontend"
npm install --silent
Pop-Location

Write-Host ""
Write-Host "🚀 Starting all services..." -ForegroundColor Green
Write-Host ""

# 3) Start Python face service
Write-Host "🐍 Starting Python Face Service (port 8000)..." -ForegroundColor Magenta
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$ROOT'; python face_service.py" -WindowStyle Normal

Start-Sleep -Seconds 3

# 4) Start Node.js backend
Write-Host "🟢 Starting Node.js Backend (port 5000)..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$ROOT\backend'; npm run dev" -WindowStyle Normal

Start-Sleep -Seconds 2

# 5) Start Frontend
Write-Host "🌐 Starting Frontend (port 3000)..." -ForegroundColor Blue
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$ROOT\frontend'; npm run dev" -WindowStyle Normal

Start-Sleep -Seconds 3

Write-Host ""
Write-Host "✅ All services started!" -ForegroundColor Green
Write-Host ""
Write-Host "   Frontend  → http://localhost:3000" -ForegroundColor Cyan
Write-Host "   Backend   → http://localhost:5000" -ForegroundColor Cyan
Write-Host "   Face API  → http://localhost:8000" -ForegroundColor Cyan
Write-Host "   Health    → http://localhost:5000/health" -ForegroundColor Cyan
Write-Host ""

# Open browser
Start-Sleep -Seconds 2
Start-Process "http://localhost:3000"
