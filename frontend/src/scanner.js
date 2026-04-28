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
// Removed LERP interpolation because YuNet does not provide consistent face indices
// between frames, causing boxes to criss-cross when multiple faces are detected.

// ── HTML ───────────────────────────────────────────────────────────────────
export function renderScanner() {
  return `
<div class="page" id="page-scanner">
  <div class="main-content">

    <div class="page-header flex items-center justify-between">
      <div>
        <h1 id="scanner-title">📸 Live Scanner</h1>
        <p class="text-muted" id="scanner-desc">Real-time face detection — auto-mark teacher attendance</p>
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
            <select id="camera-mode" class="form-input form-select" style="min-width: 140px; background: var(--bg2); padding: 8px 16px; font-size: 13px;">
              <option value="IN">🚪 IN Gate Mode</option>
              <option value="OUT">🏃 OUT Gate Mode</option>
            </select>
            <button class="btn btn-ghost btn-sm" id="btn-toggle-scan">▶ Start</button>
            <button class="btn btn-danger btn-sm" id="btn-stop-cam">⏹ Stop</button>
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

  // Handle mode changes
  const updateScannerMode = () => {
    const mode = window.__scannerMode || 'CABIN';
    const title = document.getElementById('scanner-title');
    const desc = document.getElementById('scanner-desc');
    const select = document.getElementById('camera-mode');
    if (!title || !select) return;

    if (mode === 'CABIN') {
      title.innerHTML = '🏫 Teacher Attendance';
      desc.innerHTML = 'Official check-in and check-out for the day';
      select.innerHTML =
        '<option value="CABIN_IN">👨‍🏫 Check-In (Start Day)</option>' +
        '<option value="CABIN_OUT">🚪 Check-Out (End Day)</option>';
    } else {
      title.innerHTML = '📸 Gate Cameras';
      desc.innerHTML = 'Monitor campus entries and exits during the day';
      select.innerHTML =
        '<option value="GATE_IN">🚪 IN Gate (Return)</option>' +
        '<option value="GATE_OUT">🏃 OUT Gate (Leave)</option>';
    }
  };
  document.addEventListener('scannerModeChanged', updateScannerMode);
  updateScannerMode(); // call initially


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
    document.getElementById('cam-overlay').style.display = 'flex';
    document.getElementById('cam-hud').style.display     = 'none';
    document.getElementById('btn-toggle-scan').textContent = '▶ Start';
    document.getElementById('btn-manual-checkin').disabled = true;
    document.getElementById('camera-mode').disabled = false;
    setBadge(false);
  });

  // ── Toggle Scan ─────────────────────────────────────────────
  document.getElementById('btn-toggle-scan').addEventListener('click', () => {
    if (!cameraStream) { showToast('Start camera first', '', 'warning'); return; }

    if (isScanning) {
      teardown();
      lastCheckedIn = new Set();   // reset so teachers can re-check-in after pause
      document.getElementById('btn-toggle-scan').textContent = '▶ Start';
      document.getElementById('camera-mode').disabled = false;
      setHud('Paused', false);
    } else {
      startScan(video, canvas, ctx);
      document.getElementById('btn-toggle-scan').textContent = '⏸ Pause';
      document.getElementById('camera-mode').disabled = true;
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

      // Per-face identity from faceIdentities array
      const faceId = (latestResult.faceIdentities || [])[i] || {};
      const isIdentified = faceId.identified === true;
      const fName = faceId.teacherName || null;
      const fConf = faceId.confidence || 0;

      // ── Glow shadow ──────────────────────────────────────────
      const color = isIdentified ? '#00ff88' : '#00d4ff';
      ctx.shadowColor   = color;
      ctx.shadowBlur    = 18;

      // ── Bounding box ─────────────────────────────────────────
      ctx.strokeStyle = color;
      ctx.lineWidth   = 2.5;
      ctx.strokeRect(x, y, w, h);

      // Corner accents
      drawCorners(ctx, x, y, w, h, color, 18, 3);

      ctx.shadowBlur = 0;

      // ── Label pill ───────────────────────────────────────────
      const label     = isIdentified
        ? `${fName}  ${Math.round((fConf || 0) * 100)}%`
        : `Unknown  ${Math.round((box.conf || 0) * 100)}%`;
      const fontSize  = Math.max(12, Math.min(15, w * 0.09));
      ctx.font        = `600 ${fontSize}px Inter, sans-serif`;
      const textW     = ctx.measureText(label).width;
      const pillH     = fontSize + 10;
      const pillX     = x;
      const pillY     = y - pillH - 4;

      // Pill background
      ctx.fillStyle = color;
      roundRect(ctx, pillX, pillY, textW + 16, pillH, 6);
      ctx.fill();

      // Label text
      ctx.shadowBlur  = 0;
      ctx.fillStyle   = isIdentified ? '#000' : '#000';
      ctx.fillText(label, pillX + 8, pillY + pillH - 6);
    });
  }

  // ── Start scan: open WS + rAF loop ──────────────────────────
  function startScan(video, canvas, ctx) {
    isScanning   = true;
    pendingFrame = false;
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

      // Process ALL identified faces from faceIdentities array
      const faceIds = data.faceIdentities || [];
      const identified = faceIds.filter(f => f.identified);

      if (identified.length > 0) {
        renderDetectedAll(identified);
        // Auto check-in every identified teacher that hasn't been checked in yet
        for (const face of identified) {
          if (!lastCheckedIn.has(face.userId)) {
            lastCheckedIn.add(face.userId);
            await doCheckIn(face, false);
          }
        }
      } else if (data.identified && data.teacherName) {
        // fallback to legacy single-identity
        renderDetectedAll([data]);
        if (!lastCheckedIn.has(data.userId)) {
          lastCheckedIn.add(data.userId);
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
    const type = document.getElementById('camera-mode')?.value || 'CABIN_IN';
    const res = await apiFetch('/attendance/camera-scan', {
      method: 'POST',
      body: JSON.stringify({ userId: identity.userId, type }),
    });

    // Always add to cooldown set after a response — prevents hammering the API
    // (Already added synchronously before the await to prevent parallel spam)
    lastCheckedIn.add(identity.userId);

    if (res.data?.autoCheckedIn) {
      const labels = {
        CABIN_IN:  'Cabin Check-In',
        CABIN_OUT: 'Cabin Check-Out',
        GATE_IN:   'Gate Return',
        GATE_OUT:  'Gate Exit',
      };
      showToast(`✅ ${identity.teacherName}`, `${labels[type] || type} recorded!`, 'success');
      await loadTodayLog();
    } else if (manual) {
      showToast(`ℹ️ ${identity.teacherName}`, res.data?.reason || 'No action taken', 'info');
    }
  } catch { /* already checked-in or transient error */ }
}


// ── Render detected-teacher cards (all identified teachers) ───────────────────
function renderDetectedAll(identities) {
  if (!identities || !identities.length) return;
  const panel = document.getElementById('detected-panel');
  if (!panel) return;  // navigated away from scanner page

  panel.innerHTML = identities.map(data => {
    const pct  = Math.round((data.confidence || 0) * 100);
    const name = data.teacherName || 'Unknown';
    return `
    <div class="detected-card" style="background:linear-gradient(135deg,rgba(0,255,136,0.08),rgba(0,180,216,0.08));
         border:1px solid rgba(0,255,136,0.25);margin-bottom:10px">
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
        ${data.userId ? `<button class="btn btn-ghost btn-sm" onclick="window._showTeacherGateLogs('${data.userId}','${name}')">📋 Logs</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

// Keep old single-detect for manual check-in fallback
function renderDetected(data) { renderDetectedAll([data]); }

// ── Today's log (scanner panel) ───────────────────────────────────────────────
async function loadTodayLog() {
  try {
    const data = await apiFetch('/attendance/all');
    const logs = data.data?.logs || [];
    const el   = document.getElementById('today-log');
    if (!logs.length) {
      el.innerHTML = '<p class="text-dim text-sm text-center" style="padding:20px">No check-ins yet today</p>';
      return;
    }
    el.innerHTML = logs.map(l => {
      const isCheckedIn = !!l.checkInTime;
      const isOut       = !!l.checkOutTime;
      return `
      <div class="flex items-center gap-3"
           style="padding:10px;background:var(--surface);border-radius:10px;border:1px solid var(--border)">
        <div class="teacher-avatar" style="width:36px;height:36px;font-size:13px">
          ${getInitials(l.teacherId?.fullName)}
        </div>
        <div style="flex:1">
          <div class="font-semibold text-sm">${l.teacherId?.fullName || 'Unknown'}</div>
          <div class="text-dim" style="font-size:11px">In: ${formatTime(l.checkInTime)}${l.checkOutTime ? ` · Out: ${formatTime(l.checkOutTime)}` : ''}</div>
        </div>
        <div class="flex gap-1 flex-col items-end">
          <span class="badge badge-green">${l.status}</span>
          ${isCheckedIn && l.teacherId?._id ? `<button class="btn btn-ghost" style="font-size:10px;padding:2px 8px" onclick="window._showTeacherGateLogs('${l.teacherId._id}','${l.teacherId.fullName}')">📋 Logs</button>` : ''}
        </div>
      </div>`;
    }).join('');
  } catch { /* silent */ }
}

// ── Teacher sessions log modal ────────────────────────────────────────────────
window._showTeacherGateLogs = async function(teacherId, teacherName) {
  document.getElementById('gate-log-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'gate-log-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.78);display:flex;' +
    'align-items:center;justify-content:center;backdrop-filter:blur(6px)';
  modal.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:20px;
                padding:28px 28px 24px;min-width:380px;max-width:520px;width:93%;
                max-height:82vh;overflow-y:auto;box-shadow:0 24px 64px rgba(0,0,0,0.55)">
      <div class="flex items-center justify-between mb-4">
        <div>
          <h3 class="font-bold" style="font-size:16px">\u{1F4CB} ${teacherName}</h3>
          <div style="font-size:11px;color:#666;margin-top:2px">Today's Sessions</div>
        </div>
        <button onclick="document.getElementById('gate-log-modal').remove()"
                style="background:none;border:none;color:#aaa;font-size:22px;cursor:pointer;padding:4px">\u2715</button>
      </div>
      <div id="gate-log-list"><p class="text-dim text-sm">Loading\u2026</p></div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

  try {
    const res  = await apiFetch('/attendance/teacher-logs/' + teacherId);
    const d    = res.data;
    const list = document.getElementById('gate-log-list');

    if (!d || !d.sessions || !d.sessions.length) {
      list.innerHTML = `
        <div style="text-align:center;padding:32px;color:#555">
          <div style="font-size:40px;margin-bottom:10px">\u{1F3EB}</div>
          <p>No cabin sessions recorded today.</p>
        </div>`;
      return;
    }

    // Build HTML for each session
    const sessionsHtml = d.sessions.map((session, idx) => {
      const isOpen      = session.isOpen;
      const borderColor = isOpen ? '#00ff88' : '#333';
      const bgColor     = isOpen ? 'rgba(0,255,136,0.03)' : 'var(--bg2)';
      const glowStyle   = isOpen ? 'box-shadow:0 0 0 1px rgba(0,255,136,0.25)' : '';

      // Build timeline rows
      const rows = [];

      // Row 1: Cabin IN
      rows.push({
        icon:  '\u{1F468}\u200D\u{1F3EB}',
        label: 'Cabin Check-In',
        time:  formatTime(session.cabinInTime),
        color: 'var(--success)',
        connector: true,
      });

      // Middle: gate movements
      (session.movements || []).forEach(m => {
        rows.push({
          icon:      m.type === 'GATE_OUT' ? '\u{1F3C3}' : '\u{1F4E5}',
          label:     m.type === 'GATE_OUT' ? 'Left via Gate' : 'Returned via Gate',
          time:      formatTime(m.timestamp),
          color:     m.type === 'GATE_OUT' ? '#f59e0b' : '#00b4d8',
          connector: true,
        });
      });

      // Last row: Cabin OUT or still-in
      if (session.cabinOutTime) {
        rows.push({ icon: '\u{1F6AA}', label: 'Cabin Check-Out', time: formatTime(session.cabinOutTime), color: '#f97316', connector: false });
      } else {
        const gateNote = session.currentGateState === 'OUT' ? '(currently outside)' : '(currently inside)';
        rows.push({ icon: '\u23F3', label: 'Session open', time: gateNote, color: '#555', connector: false, dimmed: true });
      }

      const rowsHtml = rows.map(r => `
        <div style="display:flex;gap:12px;align-items:flex-start;${r.dimmed ? 'opacity:.45' : ''}">
          <div style="display:flex;flex-direction:column;align-items:center;width:36px;flex-shrink:0">
            <div style="width:34px;height:34px;border-radius:50%;background:${r.color}18;border:1.5px solid ${r.color};
                        display:flex;align-items:center;justify-content:center;font-size:16px">${r.icon}</div>
            ${r.connector ? `<div style="width:2px;min-height:14px;flex:1;background:linear-gradient(${r.color},#333);margin:2px 0"></div>` : ''}
          </div>
          <div style="padding:6px 0 ${r.connector ? '12px' : '0'}">
            <div style="font-weight:600;font-size:13px;color:${r.color}">${r.label}</div>
            <div style="font-size:11px;color:#777;margin-top:1px">${r.time}</div>
          </div>
        </div>`).join('');

      return `
      <div style="border:1.5px solid ${borderColor};border-radius:14px;padding:16px;margin-bottom:12px;
                  background:${bgColor};${glowStyle}">
        <div class="flex items-center justify-between" style="margin-bottom:12px">
          <span style="font-size:11px;color:#777;font-weight:700;letter-spacing:.06em">SESSION ${idx + 1}</span>
          <div class="flex gap-1">
            ${isOpen ? '<span class="badge badge-green" style="font-size:10px;animation:pulse 1.4s infinite">\u25cf ACTIVE</span>' : ''}
            <span class="badge badge-green" style="font-size:10px">${session.status}</span>
          </div>
        </div>
        ${rowsHtml}
      </div>`;
    }).join('');

    // Day summary bar
    const totalSessions = d.sessions.length;
    const openCount     = d.sessions.filter(s => s.isOpen).length;
    const summaryHtml = `
      <div style="background:var(--bg2);border-radius:10px;padding:11px 14px;margin-bottom:14px;
                  display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
        <div style="font-size:12px;color:#888">
          <strong style="color:#fff">${totalSessions}</strong> session${totalSessions !== 1 ? 's' : ''} today
          \u00b7 First in: <strong style="color:#fff">${d.checkInTime ? formatTime(d.checkInTime) : '\u2014'}</strong>
          \u00b7 <span class="badge badge-green" style="font-size:10px">${d.status}</span>
        </div>
        ${openCount
          ? '<span style="font-size:11px;color:#00ff88">\u25cf Currently in cabin</span>'
          : '<span style="font-size:11px;color:#555">All sessions closed</span>'}
      </div>`;

    list.innerHTML = summaryHtml + sessionsHtml;

  } catch(e) {
    document.getElementById('gate-log-list').innerHTML =
      `<p class="text-dim text-sm">Error loading sessions: ${e.message}</p>`;
  }
};

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
