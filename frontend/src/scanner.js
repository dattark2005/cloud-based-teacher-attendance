import { apiFetch, formatTime, getInitials, showToast, startCamera, stopCamera } from './utils.js';

// ── State ──────────────────────────────────────────────────────────────────
let cameraStream  = null;
let isScanning    = false;
let ws            = null;
let rafId         = null;          // requestAnimationFrame id (draws overlay)
let latestResult  = null;          // latest WS detection result
let pendingFrame  = false;         // back-pressure flag
let lastCheckedIn = new Set();
let fpsFrames     = 0;

const WS_URL = `ws://localhost:8000/ws/live-detect`;

// ── Animated box interpolation for smooth box rendering ────────────────────
// We store "current" boxes and smoothly animate toward "target" boxes
let currentBoxes = [];   // [{x,y,w,h,conf,identified,label}]
const LERP = 0.35;       // interpolation factor  (0=frozen, 1=snap)

// ── HTML ───────────────────────────────────────────────────────────────────
export function renderScanner() {
  return `
<div class="page" id="page-scanner">
  <div class="main-content">

    <div class="page-header flex items-center justify-between">
      <div>
        <h1>📸 Live Scanner</h1>
        <p class="text-muted">Real-time face detection — auto-mark teacher attendance</p>
      </div>
      <div class="flex gap-2" style="align-items:center">
        <span id="scan-clock" class="badge badge-blue" style="font-size:14px;padding:8px 16px"></span>
        <span id="ws-badge" class="badge" style="font-size:12px;padding:5px 12px;background:#333;color:#aaa;border-radius:20px">● WS offline</span>
        <span id="fps-badge" class="badge badge-blue" style="font-size:12px;padding:5px 12px">0 fps</span>
      </div>
    </div>

    <div class="scanner-layout">

      <!-- ── Camera Feed ─────────────────────────────────────── -->
      <div class="card" style="padding:20px">
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-bold">Camera Feed</h3>
          <div class="flex gap-2">
            <button class="btn btn-ghost btn-sm" id="btn-toggle-scan">▶ Start Scanning</button>
            <button class="btn btn-danger btn-sm"  id="btn-stop-cam">⏹ Stop</button>
          </div>
        </div>

        <!--
          The container is position:relative.
          video  — live webcam, always 30fps, fills container
          canvas — transparent overlay, position:absolute on top, draws boxes via JS
        -->
        <div id="cam-wrap" style="position:relative;border-radius:14px;overflow:hidden;background:#0d0d0d;
             min-height:340px;display:flex;align-items:center;justify-content:center">

          <!-- Start-camera placeholder -->
          <div id="cam-overlay" style="position:absolute;inset:0;display:flex;flex-direction:column;
               align-items:center;justify-content:center;gap:12px;z-index:10;background:#111">
            <div style="font-size:56px">📷</div>
            <p class="text-muted text-sm">Camera not started</p>
            <button class="btn btn-primary" id="btn-start-cam">Start Camera</button>
          </div>

          <!-- Live webcam video — always plays at 30fps -->
          <video id="scanner-video"
                 autoplay muted playsinline
                 style="width:100%;height:100%;object-fit:cover;display:block;border-radius:14px">
          </video>

          <!-- Transparent overlay canvas — JS draws boxes here each rAF tick -->
          <canvas id="overlay-canvas"
                  style="position:absolute;inset:0;width:100%;height:100%;
                         pointer-events:none;border-radius:14px">
          </canvas>

          <!-- HUD bar at bottom of video -->
          <div id="cam-hud" style="display:none;position:absolute;bottom:0;left:0;right:0;
               padding:8px 14px;background:linear-gradient(transparent,rgba(0,0,0,0.75));
               border-radius:0 0 14px 14px;backdrop-filter:blur(4px);align-items:center;gap:8px">
            <div id="hud-dot" style="width:8px;height:8px;border-radius:50%;background:var(--warning)"></div>
            <span id="hud-text" style="color:#fff;font-size:13px;font-weight:500">Ready</span>
            <span id="hud-frames" style="margin-left:auto;color:#aaa;font-size:11px">0 frames</span>
          </div>
        </div>

        <div class="flex gap-2 mt-4">
          <button class="btn btn-accent w-full" id="btn-manual-checkin" disabled>📸 Manual Check-In</button>
        </div>
      </div>

      <!-- ── Right Panel ─────────────────────────────────────── -->
      <div style="display:flex;flex-direction:column;gap:16px">

        <!-- Detected teacher card -->
        <div id="detected-panel">
          <div class="card" style="text-align:center;padding:32px 20px">
            <div style="font-size:48px;margin-bottom:8px">🎯</div>
            <p class="text-muted text-sm">No face detected yet</p>
            <p class="text-dim" style="font-size:12px;margin-top:4px">Start scanner to begin</p>
          </div>
        </div>

        <!-- Today's log -->
        <div class="card">
          <div class="flex items-center justify-between mb-4">
            <h3 class="font-bold">Today's Check-ins</h3>
            <button class="btn btn-ghost btn-sm" id="btn-refresh-log">↻</button>
          </div>
          <div id="today-log" style="display:flex;flex-direction:column;gap:10px;max-height:320px;overflow-y:auto">
            <p class="text-dim text-sm text-center" style="padding:20px">Loading…</p>
          </div>
        </div>

      </div>
    </div>
  </div>
</div>`;
}

// ── Init ───────────────────────────────────────────────────────────────────
export async function initScanner() {
  const video   = document.getElementById('scanner-video');
  const canvas  = document.getElementById('overlay-canvas');
  const ctx     = canvas.getContext('2d');
  let framesSent = 0;

  // Clock
  setInterval(() => {
    const el = document.getElementById('scan-clock');
    if (el) el.textContent = new Date().toLocaleTimeString('en-IN');
  }, 1000);

  // FPS counter (counts rAF ticks while scanning)
  setInterval(() => {
    const el = document.getElementById('fps-badge');
    if (el) el.textContent = `${fpsFrames} fps`;
    fpsFrames = 0;
  }, 1000);

  // ── Start Camera ────────────────────────────────────────────
  document.getElementById('btn-start-cam').addEventListener('click', async () => {
    try {
      cameraStream = await startCamera(video);
      document.getElementById('cam-overlay').style.display = 'none';
      document.getElementById('cam-hud').style.display     = 'flex';
      document.getElementById('btn-manual-checkin').disabled = false;
      setHud('Camera ready — click Start Scanning', false);
    } catch {
      showToast('Camera Error', 'Allow camera permission and try again.', 'error');
    }
  });

  // ── Stop ────────────────────────────────────────────────────
  document.getElementById('btn-stop-cam').addEventListener('click', () => {
    teardown();
    stopCamera(cameraStream);
    cameraStream = null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    currentBoxes = [];
    document.getElementById('cam-overlay').style.display = 'flex';
    document.getElementById('cam-hud').style.display     = 'none';
    document.getElementById('btn-toggle-scan').textContent = '▶ Start Scanning';
    document.getElementById('btn-manual-checkin').disabled = true;
    setBadge(false);
  });

  // ── Toggle Scan ─────────────────────────────────────────────
  document.getElementById('btn-toggle-scan').addEventListener('click', () => {
    if (!cameraStream) { showToast('Start camera first', '', 'warning'); return; }

    if (isScanning) {
      teardown();
      lastCheckedIn = new Set();   // reset so teachers can re-check-in after pause
      document.getElementById('btn-toggle-scan').textContent = '▶ Start Scanning';
      setHud('Paused', false);
    } else {
      startScan(video, canvas, ctx);
      document.getElementById('btn-toggle-scan').textContent = '⏸ Pause';
      setHud('Connecting…', true);
    }
  });

  // ── Manual Check-In ─────────────────────────────────────────
  document.getElementById('btn-manual-checkin').addEventListener('click', async () => {
    if (!latestResult?.identified) {
      showToast('No identified teacher', 'Face camera at a registered teacher', 'warning');
      return;
    }
    await doCheckIn(latestResult, true);
  });

  document.getElementById('btn-refresh-log').addEventListener('click', loadTodayLog);
  await loadTodayLog();

  // ── Overlay draw loop (requestAnimationFrame) ────────────────
  // Runs independently from WS — always at screen refresh rate
  // so boxes feel smooth even when WS updates at ~10-15fps
  function drawLoop() {
    rafId = requestAnimationFrame(drawLoop);
    if (!isScanning) return;

    // Match canvas pixel size to element display size — fallback to offsetWidth if rAF fires before layout
    const rect = canvas.getBoundingClientRect();
    const cw = rect.width  || canvas.offsetWidth  || 640;
    const ch = rect.height || canvas.offsetHeight || 480;
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width  = cw;
      canvas.height = ch;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    fpsFrames++;

    if (!latestResult || !latestResult.faceBoxes) return;

    const { faceBoxes, frameW, frameH, identified, teacherName, confidence } = latestResult;
    if (!frameW || !frameH || !faceBoxes.length) return;

    // Scale factors: WS frames are sent at video resolution, canvas may differ
    const scaleX = canvas.width  / frameW;
    const scaleY = canvas.height / frameH;

    faceBoxes.forEach((box, i) => {
      const x = box.x * scaleX;
      const y = box.y * scaleY;
      const w = box.w * scaleX;
      const h = box.h * scaleY;
      const isIdentified = identified && i === 0;

      // ── Animated smooth interpolation toward target box ──────
      if (!currentBoxes[i]) currentBoxes[i] = { x, y, w, h };
      else {
        currentBoxes[i].x = lerp(currentBoxes[i].x, x, LERP);
        currentBoxes[i].y = lerp(currentBoxes[i].y, y, LERP);
        currentBoxes[i].w = lerp(currentBoxes[i].w, w, LERP);
        currentBoxes[i].h = lerp(currentBoxes[i].h, h, LERP);
      }
      const bx = currentBoxes[i];

      // ── Glow shadow ──────────────────────────────────────────
      const color = isIdentified ? '#00ff88' : '#00d4ff';
      ctx.shadowColor   = color;
      ctx.shadowBlur    = 18;

      // ── Bounding box ─────────────────────────────────────────
      ctx.strokeStyle = color;
      ctx.lineWidth   = 2.5;
      ctx.strokeRect(bx.x, bx.y, bx.w, bx.h);

      // Corner accents
      drawCorners(ctx, bx.x, bx.y, bx.w, bx.h, color, 18, 3);

      ctx.shadowBlur = 0;

      // ── Label pill ───────────────────────────────────────────
      const label     = isIdentified
        ? `${teacherName}  ${Math.round((confidence || 0) * 100)}%`
        : `Unknown  ${Math.round((box.conf || 0) * 100)}%`;
      const fontSize  = Math.max(12, Math.min(15, bx.w * 0.09));
      ctx.font        = `600 ${fontSize}px Inter, sans-serif`;
      const textW     = ctx.measureText(label).width;
      const pillH     = fontSize + 10;
      const pillX     = bx.x;
      const pillY     = bx.y - pillH - 4;

      // Pill background
      ctx.fillStyle = color;
      roundRect(ctx, pillX, pillY, textW + 16, pillH, 6);
      ctx.fill();

      // Label text
      ctx.shadowBlur  = 0;
      ctx.fillStyle   = isIdentified ? '#000' : '#000';
      ctx.fillText(label, pillX + 8, pillY + pillH - 6);
    });

    // Trim stale boxes if fewer faces returned
    currentBoxes = currentBoxes.slice(0, faceBoxes.length);
  }

  // ── Start scan: open WS + rAF loop ──────────────────────────
  function startScan(video, canvas, ctx) {
    isScanning   = true;
    pendingFrame = false;
    currentBoxes = [];
    latestResult = null;

    // Start overlay draw loop
    if (rafId) cancelAnimationFrame(rafId);
    drawLoop();

    // Open WebSocket
    if (ws) { try { ws.close(); } catch (_) {} }
    ws = new WebSocket(WS_URL);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      setBadge(true);
      setHud('Live detecting…', true);
      startFrameSender(video);
    };

    ws.onmessage = async (evt) => {
      pendingFrame = false;
      let data;
      try { data = JSON.parse(evt.data); } catch { return; }
      if (data.error) return;

      latestResult = data;

      // Update HUD counter
      const el = document.getElementById('hud-frames');
      if (el) el.textContent = `${++framesSent} frames sent`;

      // Update side panel
      if (data.identified && data.teacherName) {
        renderDetected(data);
        if (!lastCheckedIn.has(data.userId)) {
          await doCheckIn(data, false);
        }
      }
    };

    ws.onerror = () => {
      setBadge(false);
      setHud('WS error — is face service running on :8000?', false);
      showToast('WebSocket Error', 'Face service unreachable at port 8000', 'error');
    };

    ws.onclose = () => {
      setBadge(false);
      if (isScanning) setHud('WS disconnected', false);
    };
  }

  // ── Send frames over WS at ~15fps with back-pressure ────────
  function startFrameSender(video) {
    const FPS = 15;
    const INTERVAL = 1000 / FPS;
    const off    = document.createElement('canvas');
    const offCtx = off.getContext('2d');

    const intId = setInterval(() => {
      if (!isScanning) { clearInterval(intId); return; }
      if (pendingFrame) return;
      if (!video.videoWidth || ws?.readyState !== WebSocket.OPEN) return;

      off.width  = video.videoWidth;
      off.height = video.videoHeight;
      offCtx.drawImage(video, 0, 0);

      off.toBlob(blob => {
        if (!blob || ws?.readyState !== WebSocket.OPEN) return;
        blob.arrayBuffer().then(buf => {
          ws.send(buf);
          pendingFrame = true;
        });
      }, 'image/jpeg', 0.82);
    }, INTERVAL);
  }

  function teardown() {
    isScanning   = false;
    pendingFrame = false;
    latestResult = null;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (ws)    { try { ws.close(); } catch (_) {} ws = null; }
  }
}

// ── Check-in via REST ──────────────────────────────────────────────────────
async function doCheckIn(identity, manual) {
  try {
    const res = await apiFetch('/attendance/camera-scan', {
      method: 'POST',
      body: JSON.stringify({ userId: identity.userId }),
    });
    if (res.data?.autoCheckedIn || manual) {
      lastCheckedIn.add(identity.userId);
      showToast(`✅ ${identity.teacherName}`, 'Check-in recorded!', 'success');
      await loadTodayLog();
    }
  } catch { /* already checked-in or transient error */ }
}

// ── Render detected-teacher card ───────────────────────────────────────────
function renderDetected(data) {
  const pct  = Math.round((data.confidence || 0) * 100);
  const name = data.teacherName || 'Unknown';
  document.getElementById('detected-panel').innerHTML = `
    <div class="detected-card" style="background:linear-gradient(135deg,rgba(0,255,136,0.08),rgba(0,180,216,0.08));
         border:1px solid rgba(0,255,136,0.25)">
      <div class="flex items-center gap-3 mb-3">
        <div class="teacher-avatar" style="background:linear-gradient(135deg,#00ff88,#00b4d8);
             color:#000;font-weight:800;font-size:18px">
          ${name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
        </div>
        <div>
          <div class="teacher-name">${name}</div>
          <div style="font-size:11px;color:#00ff88;font-weight:600;letter-spacing:.04em">● LIVE DETECTION</div>
        </div>
      </div>
      <div class="flex items-center justify-between text-sm mb-1">
        <span class="text-muted">Confidence</span>
        <span class="font-bold" style="color:${pct > 75 ? '#00ff88' : '#f59e0b'}">${pct}%</span>
      </div>
      <div class="confidence-bar"><div class="confidence-fill" style="width:${pct}%;
           background:${pct > 75 ? 'var(--success)' : 'var(--warning)'}"></div></div>
      <div class="mt-3 flex gap-2">
        <span class="badge badge-green" style="animation:pulse 1.4s infinite">🟢 Detected</span>
      </div>
    </div>`;
}

// ── Today's log ────────────────────────────────────────────────────────────
async function loadTodayLog() {
  try {
    const data = await apiFetch('/attendance/all');
    const logs = data.data?.logs || [];
    const el   = document.getElementById('today-log');
    if (!logs.length) {
      el.innerHTML = '<p class="text-dim text-sm text-center" style="padding:20px">No check-ins yet today</p>';
      return;
    }
    el.innerHTML = logs.map(l => `
      <div class="flex items-center gap-3"
           style="padding:10px;background:var(--surface);border-radius:10px;border:1px solid var(--border)">
        <div class="teacher-avatar" style="width:36px;height:36px;font-size:13px">
          ${getInitials(l.teacherId?.fullName)}
        </div>
        <div style="flex:1">
          <div class="font-semibold text-sm">${l.teacherId?.fullName || 'Unknown'}</div>
          <div class="text-dim" style="font-size:11px">${formatTime(l.checkInTime)}</div>
        </div>
        <span class="badge ${l.status === 'LATE' ? 'badge-yellow' : 'badge-green'}">${l.status}</span>
      </div>`).join('');
  } catch { /* silent */ }
}

// ── HUD / badge helpers ────────────────────────────────────────────────────
function setHud(text, active) {
  const dot  = document.getElementById('hud-dot');
  const span = document.getElementById('hud-text');
  if (dot)  dot.style.background  = active ? 'var(--success)' : 'var(--warning)';
  if (span) span.textContent      = text;
}

function setBadge(online) {
  const el = document.getElementById('ws-badge');
  if (!el) return;
  el.textContent       = online ? '● WS Live' : '● WS offline';
  el.style.background  = online ? 'rgba(0,255,136,0.15)' : '#333';
  el.style.color       = online ? '#00ff88' : '#aaa';
}

// ── Canvas drawing helpers ─────────────────────────────────────────────────
function lerp(a, b, t) { return a + (b - a) * t; }

function drawCorners(ctx, x, y, w, h, color, size, lineW) {
  ctx.strokeStyle = color;
  ctx.lineWidth   = lineW;
  ctx.shadowBlur  = 0;
  const p = [[x,y,1,1],[x+w,y,-1,1],[x,y+h,1,-1],[x+w,y+h,-1,-1]];
  p.forEach(([cx,cy,dx,dy]) => {
    ctx.beginPath();
    ctx.moveTo(cx + dx * size, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + dy * size);
    ctx.stroke();
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
