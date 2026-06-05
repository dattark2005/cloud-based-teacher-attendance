import { apiFetch, formatTime, getInitials, showToast, startCamera, stopCamera } from './utils.js';

// ── State ──────────────────────────────────────────────────────────────────
let cameraStream  = null;
let isScanning    = false;
let ws            = null;
let rafId         = null;
let latestResult  = null;
let pendingFrame  = false;
let fpsFrames     = 0;

let lastApiCall   = new Map(); // userId -> timestamp
const THROTTLE_MS = 10000;     // 10 seconds throttle per user per gate

// Gate mode: 'auto' = automatic loop, 'in' = check-in, 'out' = check-out
let gateMode = 'auto';

const WS_URL = import.meta.env.VITE_FACE_WS_URL || `ws://localhost:8000/ws/live-detect`;

// ── Smooth box interpolation ───────────────────────────────────────────────
let currentBoxes = [];
const LERP = 0.35;

// ── HTML ───────────────────────────────────────────────────────────────────
export function renderScanner() {
  const teacher = JSON.parse(localStorage.getItem('ta_teacher')) || {};
  const isAdmin = teacher.role === 'admin';
  return `
<div class="page" id="page-scanner">
  <div class="main-content">

    <div class="page-header flex items-center justify-between">
      <div>
        <h1>📸 Live Scanner</h1>
        <p class="text-muted">Automatic face detection — select gate to mark attendance</p>
      </div>
      <div class="flex gap-2" style="align-items:center">
        <span id="scan-clock" class="badge badge-blue" style="font-size:14px;padding:8px 16px"></span>
      </div>
    </div>

    <!-- ── Gate Toggle ─────────────────────────────────────────────── -->
    <div class="gate-toggle-bar">
      <div class="gate-toggle-label">Select Gate:</div>
      <div class="gate-toggle-group">
        <button class="gate-btn active" id="btn-gate-auto" data-gate="auto">
          🔄 Auto Loop
          <span class="gate-badge">IN ⇄ OUT</span>
        </button>
        <button class="gate-btn" id="btn-gate-in" data-gate="in">
          🚪 IN Gate
          <span class="gate-badge">Check-In</span>
        </button>
        <button class="gate-btn" id="btn-gate-out" data-gate="out">
          🏁 OUT Gate
          <span class="gate-badge">Check-Out</span>
        </button>
      </div>
      <div id="gate-status-pill" class="gate-status-pill gate-auto">🔄 Auto Loop Active — Face direction auto-detected (IN ⇄ OUT)</div>
    </div>

    <div class="scanner-layout">

      <!-- ── Camera Feed ──────────────────────────────────────────── -->
      <div class="card" style="padding:20px">
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-bold">Camera Feed</h3>
          <div class="flex gap-2">
            <button class="btn btn-ghost btn-sm" id="btn-toggle-scan">▶ Start Scanning</button>
            <button class="btn btn-danger btn-sm"  id="btn-stop-cam">⏹ Stop</button>
          </div>
        </div>

        <div id="cam-wrap" style="position:relative;border-radius:14px;overflow:hidden;background:#0d0d0d;
             min-height:340px;display:flex;align-items:center;justify-content:center">

          <div id="cam-overlay" style="position:absolute;inset:0;display:flex;flex-direction:column;
               align-items:center;justify-content:center;gap:12px;z-index:10;background:#111">
            <div style="font-size:56px">📷</div>
            <p class="text-muted text-sm">Camera not started</p>
            <button class="btn btn-primary" id="btn-start-cam">Start Camera</button>
          </div>

          <video id="scanner-video" autoplay muted playsinline
                 style="width:100%;height:100%;object-fit:cover;display:block;border-radius:14px">
          </video>

          <canvas id="overlay-canvas"
                  style="position:absolute;inset:0;width:100%;height:100%;
                         pointer-events:none;border-radius:14px">
          </canvas>

          <!-- Gate mode indicator inside video -->
          <div id="cam-gate-pill" style="display:none;position:absolute;top:12px;left:12px;
               padding:5px 14px;border-radius:20px;font-size:12px;font-weight:700;
               background:rgba(0,212,136,0.85);color:#000;backdrop-filter:blur(6px)">
            📥 IN Gate
          </div>

          <div id="cam-hud" style="display:none;position:absolute;bottom:0;left:0;right:0;
               padding:8px 14px;background:linear-gradient(transparent,rgba(0,0,0,0.75));
               border-radius:0 0 14px 14px;backdrop-filter:blur(4px);align-items:center;gap:8px">
            <div id="hud-dot" style="width:8px;height:8px;border-radius:50%;background:var(--warning)"></div>
            <span id="hud-text" style="color:#fff;font-size:13px;font-weight:500">Ready</span>
            <span id="hud-frames" style="margin-left:auto;color:#aaa;font-size:11px">0 frames</span>
          </div>
        </div>

        <div class="flex gap-2 mt-4">
          <button class="btn btn-accent w-full" id="btn-manual-checkin" disabled>📸 Manual Check-In / Out</button>
        </div>
      </div>

      <!-- ── Right Panel ──────────────────────────────────────────── -->
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
            <h3 class="font-bold">Today's Activity</h3>
            <button class="btn btn-ghost btn-sm" id="btn-refresh-log">↻</button>
          </div>
          <div id="today-log" style="display:flex;flex-direction:column;gap:10px;max-height:360px;overflow-y:auto">
            <p class="text-dim text-sm text-center" style="padding:20px">Loading…</p>
          </div>
        </div>

      </div>
    </div>
  </div>
</div>`;
}

// ── Gate UI & Status helpers ────────────────────────────────────────────────
export function updateGateUI() {
  const pill   = document.getElementById('gate-status-pill');
  const camPill= document.getElementById('cam-gate-pill');
  if (!pill) return;

  // Sync the active class on the toggle buttons
  document.querySelectorAll('.gate-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.gate === gateMode);
  });

  if (gateMode === 'in') {
    pill.textContent  = '📥 IN Gate Active — Face detection will mark CHECK-IN';
    pill.className    = 'gate-status-pill gate-in';
    if (camPill) { camPill.textContent = '📥 IN Gate'; camPill.style.background = 'rgba(0,212,136,0.85)'; }
  } else if (gateMode === 'out') {
    pill.textContent  = '📤 OUT Gate Active — Face detection will mark CHECK-OUT';
    pill.className    = 'gate-status-pill gate-out';
    if (camPill) { camPill.textContent = '📤 OUT Gate'; camPill.style.background = 'rgba(245,158,11,0.85)'; }
  } else {
    pill.textContent  = '🔄 Auto Loop Active — Face direction auto-detected (IN ⇄ OUT)';
    pill.className    = 'gate-status-pill gate-auto';
    if (camPill) { camPill.textContent = '🔄 Auto Loop'; camPill.style.background = 'rgba(108,99,255,0.85)'; }
  }
}

export async function refreshFacultyGateStatus() {
  try {
    const data = await apiFetch('/attendance/today');
    const log = data.data?.log;
    const lastEvent = log && log.logs && log.logs.length > 0
      ? log.logs[log.logs.length - 1].event
      : (log && log.checkInTime ? 'CHECK_IN' : null);

    if (log && lastEvent === 'CHECK_IN') {
      gateMode = 'out';
    } else {
      gateMode = 'in';
    }
    updateGateUI();
  } catch (err) {
    console.error('Failed to refresh faculty gate status:', err);
  }
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

  // FPS counter
  setInterval(() => {
    const el = document.getElementById('fps-badge');
    if (el) el.textContent = `${fpsFrames} fps`;
    fpsFrames = 0;
  }, 1000);

  // ── Gate toggle ─────────────────────────────────────────────────
  document.querySelectorAll('.gate-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      gateMode = btn.dataset.gate;
      document.querySelectorAll('.gate-btn').forEach(b => b.classList.toggle('active', b.dataset.gate === gateMode));
      updateGateUI();
      // Reset throttle on gate change
      lastApiCall.clear();
      latestResult = null;
    });
  });

  const teacher = JSON.parse(localStorage.getItem('ta_teacher')) || {};
  const isAdmin = teacher.role === 'admin';
  if (!isAdmin) {
    await refreshFacultyGateStatus();
  } else {
    gateMode = 'auto';
    updateGateUI();
  }

  // ── Start Camera ──────────────────────────────────────────────────
  document.getElementById('btn-start-cam').addEventListener('click', async () => {
    try {
      cameraStream = await startCamera(video);
      document.getElementById('cam-overlay').style.display = 'none';
      document.getElementById('cam-hud').style.display     = 'flex';
      document.getElementById('cam-gate-pill').style.display = 'block';
      document.getElementById('btn-manual-checkin').disabled = false;
      setHud('Camera ready — click Start Scanning', false);
    } catch {
      showToast('Camera Error', 'Allow camera permission and try again.', 'error');
    }
  });

  // ── Stop ──────────────────────────────────────────────────────────
  document.getElementById('btn-stop-cam').addEventListener('click', () => {
    teardown();
    stopCamera(cameraStream);
    cameraStream = null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    currentBoxes = [];
    document.getElementById('cam-overlay').style.display = 'flex';
    document.getElementById('cam-hud').style.display     = 'none';
    document.getElementById('cam-gate-pill').style.display = 'none';
    document.getElementById('btn-toggle-scan').textContent = '▶ Start Scanning';
    document.getElementById('btn-manual-checkin').disabled = true;
    setBadge(false);
  });

  // ── Toggle Scan ────────────────────────────────────────────────────
  document.getElementById('btn-toggle-scan').addEventListener('click', () => {
    if (!cameraStream) { showToast('Start camera first', '', 'warning'); return; }
    if (isScanning) {
      teardown();
      lastApiCall.clear();
      document.getElementById('btn-toggle-scan').textContent = '▶ Start Scanning';
      setHud('Paused', false);
    } else {
      startScan(video, canvas, ctx);
      document.getElementById('btn-toggle-scan').textContent = '⏸ Pause';
      setHud('Connecting…', true);
    }
  });

  // ── Manual Check-In/Out ──────────────────────────────────────────
  document.getElementById('btn-manual-checkin').addEventListener('click', async () => {
    if (!latestResult?.identified) {
      showToast('No identified teacher', 'Face camera at a registered teacher', 'warning');
      return;
    }
    await doGateAction(latestResult, true);
  });

  document.getElementById('btn-refresh-log').addEventListener('click', loadTodayLog);
  await loadTodayLog();

  // ── Overlay draw loop ──────────────────────────────────────────────
  function drawLoop() {
    rafId = requestAnimationFrame(drawLoop);
    if (!isScanning) return;

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

    const scaleX = canvas.width  / frameW;
    const scaleY = canvas.height / frameH;

    // Gate color: green for IN, amber for OUT
    const gateColor = gateMode === 'in' ? '#00ff88' : '#f59e0b';

    faceBoxes.forEach((box, i) => {
      const x = box.x * scaleX;
      const y = box.y * scaleY;
      const w = box.w * scaleX;
      const h = box.h * scaleY;
      const isIdentified = identified && i === 0;

      if (!currentBoxes[i]) currentBoxes[i] = { x, y, w, h };
      else {
        currentBoxes[i].x = lerp(currentBoxes[i].x, x, LERP);
        currentBoxes[i].y = lerp(currentBoxes[i].y, y, LERP);
        currentBoxes[i].w = lerp(currentBoxes[i].w, w, LERP);
        currentBoxes[i].h = lerp(currentBoxes[i].h, h, LERP);
      }
      const bx = currentBoxes[i];

      const color = isIdentified ? gateColor : '#00d4ff';
      ctx.shadowColor   = color;
      ctx.shadowBlur    = 18;
      ctx.strokeStyle   = color;
      ctx.lineWidth     = 2.5;
      ctx.strokeRect(bx.x, bx.y, bx.w, bx.h);
      drawCorners(ctx, bx.x, bx.y, bx.w, bx.h, color, 18, 3);
      ctx.shadowBlur = 0;

      const label     = isIdentified
        ? `${teacherName}  ${Math.round((confidence || 0) * 100)}%`
        : `Unknown  ${Math.round((box.conf || 0) * 100)}%`;
      const fontSize  = Math.max(12, Math.min(15, bx.w * 0.09));
      ctx.font        = `600 ${fontSize}px Inter, sans-serif`;
      const textW     = ctx.measureText(label).width;
      const pillH     = fontSize + 10;
      const pillX     = bx.x;
      const pillY     = bx.y - pillH - 4;

      ctx.fillStyle = color;
      roundRect(ctx, pillX, pillY, textW + 16, pillH, 6);
      ctx.fill();

      ctx.shadowBlur  = 0;
      ctx.fillStyle   = '#000';
      ctx.fillText(label, pillX + 8, pillY + pillH - 6);
    });

    currentBoxes = currentBoxes.slice(0, faceBoxes.length);
  }

  // ── Start scan ─────────────────────────────────────────────────────
  function startScan(video, canvas, ctx) {
    isScanning   = true;
    pendingFrame = false;
    currentBoxes = [];
    latestResult = null;

    if (rafId) cancelAnimationFrame(rafId);
    drawLoop();

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

      const el = document.getElementById('hud-frames');
      if (el) el.textContent = `${++framesSent} frames sent`;

      if (data.identified && data.teacherName) {
        renderDetected(data);
        const lastCall = lastApiCall.get(data.userId);
        if (!lastCall || (Date.now() - lastCall) > THROTTLE_MS) {
          lastApiCall.set(data.userId, Date.now());
          await doGateAction(data, false);
        }
      }
    };

    ws.onerror = () => {
      setBadge(false);
      setHud('WS error — is face service running on :8000?', false);
    };

    ws.onclose = () => {
      setBadge(false);
      if (isScanning) setHud('WS disconnected', false);
    };
  }

  // ── Frame sender ────────────────────────────────────────────────────
  function startFrameSender(video) {
    const FPS      = 15;
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

// ── Gate action (check-in or check-out) ────────────────────────────────────
async function doGateAction(identity, manual) {
  try {
    const res = await apiFetch('/attendance/camera-scan', {
      method: 'POST',
      body: JSON.stringify({ userId: identity.userId, gate: gateMode, confidence: identity.confidence }),
    });

    const isCheckIn = res.data?.autoCheckedIn;
    const isCheckOut = res.data?.autoCheckedOut;
    const isCooldown = res.data?.cooldown;

    if (isCooldown) {
      showToast('Please wait', res.data.message || 'Please wait before scanning again.', 'warning');
      return;
    }

    if (isCheckIn) {
      showToast(`📥 ${identity.teacherName}`, 'Check-in recorded! — ' + new Date().toLocaleTimeString('en-IN'), 'success');
      await loadTodayLog();
    } else if (isCheckOut) {
      showToast(`📤 ${identity.teacherName}`, 'Check-out recorded! — ' + new Date().toLocaleTimeString('en-IN'), 'info');
      await loadTodayLog();
    } else if (manual) {
      if (res.data?.alreadyCheckedIn) {
        showToast(`📥 ${identity.teacherName}`, 'Already checked in for today', 'warning');
      } else if (res.data?.alreadyCheckedOut) {
        showToast(`📤 ${identity.teacherName}`, 'Already checked out for today', 'warning');
      }
    }
  } catch (err) {
    console.error('[Scanner] Gate action failed:', err);
    showToast('Scanner Error', err.message || 'Gate action failed', 'error');
  }
}

// ── Render detected teacher card ───────────────────────────────────────────
function renderDetected(data) {
  const pct  = Math.round((data.confidence || 0) * 100);
  const name = data.teacherName || 'Unknown';
  const gateLabel = gateMode === 'in' ? '📥 IN Gate' : '📤 OUT Gate';
  const gateColor = gateMode === 'in' ? '#00ff88' : '#f59e0b';

  document.getElementById('detected-panel').innerHTML = `
    <div class="detected-card" style="background:linear-gradient(135deg,rgba(0,255,136,0.08),rgba(0,180,216,0.08));
         border:1px solid ${gateColor}44">
      <div class="flex items-center gap-3 mb-3">
        <div class="teacher-avatar" style="background:linear-gradient(135deg,${gateColor},#00b4d8);
             color:#000;font-weight:800;font-size:18px">
          ${name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
        </div>
        <div>
          <div class="teacher-name">${name}</div>
          <div style="font-size:11px;color:${gateColor};font-weight:600;letter-spacing:.04em">● LIVE DETECTION</div>
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
        <span class="badge" style="background:${gateColor}22;color:${gateColor};border:1px solid ${gateColor}44">${gateLabel}</span>
      </div>
    </div>`;
}

// ── Today's log — shows both check-in and check-out times ──────────────────
export async function loadTodayLog() {
  try {
    const teacher = JSON.parse(localStorage.getItem('ta_teacher')) || {};
    const isAdmin = teacher.role === 'admin';

    let logs = [];
    if (isAdmin) {
      const data = await apiFetch('/attendance/all');
      logs = data.data?.logs || [];
    } else {
      const data = await apiFetch('/attendance/today');
      const log = data.data?.log;
      logs = log ? [log] : [];
    }

    const el   = document.getElementById('today-log');
    if (!el) return;
    if (!logs.length) {
      el.innerHTML = '<p class="text-dim text-sm text-center" style="padding:20px">No activity today</p>';
      return;
    }
    el.innerHTML = logs.map(l => {
      const inTime  = l.checkInTime  ? formatTime(l.checkInTime)  : null;
      const outTime = l.checkOutTime ? formatTime(l.checkOutTime) : null;
      return `
      <div style="padding:10px 12px;background:var(--surface);border-radius:10px;
                  border:1px solid var(--border);display:flex;flex-direction:column;gap:6px">
        <div class="flex items-center gap-3">
          <div class="teacher-avatar" style="width:36px;height:36px;font-size:13px;flex-shrink:0">
            ${getInitials(l.teacherId?.fullName)}
          </div>
          <div style="flex:1;min-width:0">
            <div class="font-semibold text-sm">${l.teacherId?.fullName || 'Unknown'}</div>
            <div class="text-dim" style="font-size:11px">${(l.teacherId?.department || '').toUpperCase()}</div>
          </div>
        </div>
        <div class="flex gap-2" style="margin-left:48px;flex-wrap:wrap">
          ${inTime  ? `<span class="time-chip in">📥 ${inTime}</span>`  : ''}
          ${outTime ? `<span class="time-chip out">📤 ${outTime}</span>` : ''}
          ${!inTime && !outTime ? '<span class="text-dim text-xs">No events yet</span>' : ''}
        </div>
      </div>`;
    }).join('');
  } catch { /* silent */ }
}

// ── HUD helpers ────────────────────────────────────────────────────────────
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

// ── Canvas helpers ─────────────────────────────────────────────────────────
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
