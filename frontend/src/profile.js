import { apiFetch, showToast, startCamera, stopCamera, captureFrame, formatTime, formatDate, getInitials } from './utils.js';

let profStream = null;

export function renderProfile(teacher) {
  return `
<div class="page" id="page-profile">
  <div class="main-content">
    <div class="page-header"><h1>My Profile</h1><p class="text-muted">Manage your account and face biometrics</p></div>
    <div class="grid-2" style="gap:24px;align-items:start">
      <!-- Profile Info -->
      <div class="card card-glow">
        <div style="text-align:center;padding:16px 0 24px">
          <div class="teacher-avatar" style="width:80px;height:80px;font-size:28px;margin:0 auto 16px">
            ${teacher.faceImageUrl ? `<img src="${teacher.faceImageUrl}" id="prof-avatar-img" style="width:100%;height:100%;object-fit:cover;border-radius:50%" />` : `<span id="prof-initials">${getInitials(teacher.fullName)}</span>`}
          </div>
          <h2 class="font-bold" style="font-size:20px" id="prof-name">${teacher.fullName}</h2>
          <p class="text-muted text-sm" id="prof-desig">${teacher.designation}</p>
          <p class="text-dim text-xs mt-1" id="prof-email">${teacher.email}</p>
        </div>
        <div style="display:grid;gap:12px">
          <div style="display:flex;align-items:center;gap:12px;padding:12px;background:var(--surface2);border-radius:10px;border:1px solid var(--border)">
            <span style="font-size:18px">🏢</span>
            <div><div class="text-dim" style="font-size:11px">Department</div><div class="font-semibold text-sm" id="prof-dept">${teacher.role === 'ADMIN' ? 'Administrator' : teacher.department}</div></div>
          </div>
          <div style="display:flex;align-items:center;gap:12px;padding:12px;background:var(--surface2);border-radius:10px;border:1px solid var(--border)">
            <span style="font-size:18px">🪪</span>
            <div><div class="text-dim" style="font-size:11px">Employee ID</div><div class="font-semibold text-sm" id="prof-empid">${teacher.employeeId}</div></div>
          </div>
          <div style="display:flex;align-items:center;gap:12px;padding:12px;background:var(--surface2);border-radius:10px;border:1px solid var(--border)">
            <span style="font-size:18px">📅</span>
            <div><div class="text-dim" style="font-size:11px">Member Since</div><div class="font-semibold text-sm">${formatDate(teacher.createdAt)}</div></div>
          </div>
          ${teacher.role !== 'ADMIN' ? `
          <div style="padding:12px;background:var(--surface2);border-radius:10px;border:1px solid var(--border);display:flex;align-items:center;gap:12px">
            <span style="font-size:18px">🧠</span>
            <div><div class="text-dim" style="font-size:11px">Face Biometrics</div>
            <div id="face-status-badge">${(teacher.faceRegistered || teacher.faceRegisteredAt) ? '<span class="badge badge-green">✅ Registered</span>' : '<span class="badge badge-red">❌ Not Registered</span>'}</div></div>
          </div>` : `
          <div style="padding:12px;background:var(--surface2);border-radius:10px;border:1px solid var(--border);display:flex;align-items:center;gap:12px">
            <span style="font-size:18px">🛡️</span>
            <div><div class="text-dim" style="font-size:11px">Access Level</div>
            <div><span class="badge badge-blue">Full Administrator</span></div></div>
          </div>`}
        </div>
      </div>

      <!-- Face Registration -->
      ${teacher.role !== 'ADMIN' ? `
      <div class="card">
        <h3 class="font-bold mb-4">🎭 Face Registration</h3>
        <p class="text-muted text-sm mb-4">Register your face to enable automatic camera attendance. Good lighting improves accuracy.</p>
        <div class="camera-container" style="max-width:100%;margin-bottom:16px">
          <video id="prof-video" autoplay muted playsinline></video>
          <div class="camera-overlay" id="prof-cam-overlay">
            <div style="font-size:40px">📸</div>
            <button class="btn btn-primary" id="btn-prof-start-cam">Open Camera</button>
          </div>
          <div class="camera-scanner" id="prof-scan-frame" style="display:none"><div class="scanner-line"></div></div>
        </div>
        <div class="flex gap-2">
          <button class="btn btn-accent w-full" id="btn-capture-face" disabled>📸 Capture &amp; Register</button>
          <button class="btn btn-ghost btn-sm" id="btn-stop-prof-cam">⏹</button>
        </div>
        <div id="face-reg-result" class="mt-3 hidden"></div>
      </div>
      ` : ''}
    </div>

    <!-- Attendance History — Teachers only -->
    ${teacher.role !== 'ADMIN' ? `
    <div class="card mt-4" id="history-section">
      <div class="flex items-center justify-between mb-4">
        <h3 class="font-bold">📊 My Attendance History</h3>
        <div class="flex gap-2 items-center">
          <span id="hist-stats" style="font-size:12px;color:var(--text2)"></span>
          <button class="btn btn-ghost btn-sm" id="btn-reload-history">↻ Refresh</button>
        </div>
      </div>

      <!-- Stat pills -->
      <div id="hist-pill-row" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px"></div>

      <!-- Day cards list -->
      <div id="history-list" style="display:flex;flex-direction:column;gap:12px">
        <div style="text-align:center;padding:40px;color:var(--text3)">
          <div style="font-size:40px;margin-bottom:10px">⏳</div>
          <p>Loading history…</p>
        </div>
      </div>
    </div>
    ` : ''}
  </div>
</div>`;
}

export async function initProfile() {
  const video = document.getElementById('prof-video');

  document.getElementById('btn-prof-start-cam')?.addEventListener('click', async () => {
    try {
      profStream = await startCamera(video);
      document.getElementById('prof-cam-overlay').style.display = 'none';
      document.getElementById('prof-scan-frame').style.display = 'block';
      document.getElementById('btn-capture-face').disabled = false;
    } catch { showToast('Camera Error', 'Cannot access camera', 'error'); }
  });

  document.getElementById('btn-stop-prof-cam')?.addEventListener('click', () => {
    stopCamera(profStream); profStream = null;
    document.getElementById('prof-cam-overlay').style.display = 'flex';
    document.getElementById('prof-scan-frame').style.display = 'none';
    document.getElementById('btn-capture-face').disabled = true;
  });

  document.getElementById('btn-capture-face')?.addEventListener('click', async () => {
    const canvas = document.createElement('canvas');
    const frame = captureFrame(video, canvas);
    const btn = document.getElementById('btn-capture-face');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Registering...';
    try {
      const res = await apiFetch('/teachers/register-face', { method: 'POST', body: JSON.stringify({ faceImage: frame }) });
      document.getElementById('face-reg-result').className = 'mt-3';
      document.getElementById('face-reg-result').innerHTML = '<div class="badge badge-green" style="padding:10px 16px;font-size:13px">✅ Face registered successfully!</div>';
      document.getElementById('face-status-badge').innerHTML = '<span class="badge badge-green">✅ Registered</span>';
      try {
        const cached = JSON.parse(localStorage.getItem('ta_teacher') || '{}');
        cached.faceRegistered = true;
        cached.faceImageUrl = res.data?.faceImageUrl || cached.faceImageUrl;
        cached.faceRegisteredAt = new Date().toISOString();
        localStorage.setItem('ta_teacher', JSON.stringify(cached));
      } catch (_) {}
      showToast('Face Registered!', 'You can now use camera check-in', 'success');
    } catch (e) {
      document.getElementById('face-reg-result').className = 'mt-3';
      document.getElementById('face-reg-result').innerHTML = `<div class="badge badge-red" style="padding:10px 16px;font-size:13px">❌ ${e.message}</div>`;
      showToast('Registration Failed', e.message, 'error');
    }
    btn.disabled = false; btn.innerHTML = '📸 Capture &amp; Register';
  });

  // Load history
  if (document.getElementById('history-list')) {
    document.getElementById('btn-reload-history')?.addEventListener('click', loadHistory);
    await loadHistory();
  }
}

// ─── Attendance History ────────────────────────────────────────────────────────

async function loadHistory() {
  const list = document.getElementById('history-list');
  list.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text3)"><div style="font-size:32px;margin-bottom:8px">⏳</div><p>Loading…</p></div>`;

  try {
    const res  = await apiFetch('/attendance/history?limit=30');
    const logs  = res.data?.logs || [];
    const stats = res.data?.stats || {};

    // ── Stat pills ──────────────────────────────────────────────────────
    const pillRow = document.getElementById('hist-pill-row');
    if (pillRow) {
      pillRow.innerHTML = [
        { label: 'Total Days', value: stats.total || 0, color: 'var(--primary-light)', bg: 'rgba(108,99,255,0.12)' },
        { label: 'Present',    value: stats.present || 0, color: 'var(--success)',      bg: 'rgba(16,185,129,0.12)' },
        { label: 'Absent',     value: stats.absent || 0,  color: 'var(--danger)',       bg: 'rgba(239,68,68,0.12)'  },
      ].map(p => `
        <div style="padding:10px 18px;background:${p.bg};border-radius:10px;
                    border:1px solid ${p.color}30;text-align:center;min-width:90px">
          <div style="font-size:22px;font-weight:800;color:${p.color}">${p.value}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:2px">${p.label}</div>
        </div>`).join('');
    }

    if (!logs.length) {
      list.innerHTML = `<div style="text-align:center;padding:48px;color:var(--text3)">
        <div style="font-size:48px;margin-bottom:12px">📋</div>
        <p style="font-size:15px">No attendance records yet.</p>
      </div>`;
      return;
    }

    list.innerHTML = logs.map((log, idx) => renderDayCard(log, idx)).join('');

    // Attach expand toggles
    list.querySelectorAll('.day-card-header').forEach(header => {
      header.addEventListener('click', () => {
        const body = header.nextElementSibling;
        const chevron = header.querySelector('.day-chevron');
        const isOpen = body.style.display !== 'none';
        body.style.display = isOpen ? 'none' : 'block';
        if (chevron) chevron.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
      });
    });

  } catch (e) {
    list.innerHTML = `<div style="text-align:center;padding:40px;color:var(--danger)">
      <div style="font-size:40px;margin-bottom:10px">⚠️</div>
      <p>Failed to load history: ${e.message}</p>
    </div>`;
  }
}

// ─── Render one day card ───────────────────────────────────────────────────────

function renderDayCard(log, idx) {
  const isPresent  = log.status === 'PRESENT';
  const sessions   = log.sessions || [];
  const totalSess  = sessions.length;
  const openSess   = sessions.filter(s => !s.cabinOutTime).length;
  const accentColor = isPresent ? 'var(--success)' : 'var(--danger)';
  const statusBadge = isPresent
    ? `<span class="badge badge-green">✅ Present</span>`
    : `<span class="badge badge-red">❌ Absent</span>`;

  // Day-level summary line
  const firstIn  = formatTime(log.checkInTime);
  const lastOut  = formatTime(log.checkOutTime);
  const summaryLine = isPresent
    ? `First in: <strong>${firstIn}</strong>${log.checkOutTime ? ` &nbsp;·&nbsp; Last out: <strong>${lastOut}</strong>` : ' &nbsp;·&nbsp; <span style="color:var(--success)">● Still in</span>'}`
    : '&nbsp;';

  return `
  <div class="day-card" style="border:1px solid ${isPresent ? 'rgba(16,185,129,0.2)' : 'var(--border)'};
       border-radius:14px;overflow:hidden;background:var(--surface)">

    <!-- Header (always visible, click to expand) -->
    <div class="day-card-header" style="display:flex;align-items:center;gap:14px;padding:14px 18px;
         cursor:pointer;user-select:none;transition:background 0.2s"
         onmouseenter="this.style.background='var(--surface2)'" onmouseleave="this.style.background=''">

      <!-- Date blob -->
      <div style="min-width:48px;text-align:center;background:${isPresent ? 'rgba(16,185,129,0.12)' : 'var(--surface2)'};
           border-radius:10px;padding:6px 4px;border:1px solid ${isPresent ? 'rgba(16,185,129,0.25)' : 'var(--border)'}">
        <div style="font-size:18px;font-weight:800;color:${accentColor};line-height:1">
          ${new Date(log.date).getDate().toString().padStart(2,'0')}
        </div>
        <div style="font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:.04em">
          ${new Date(log.date + 'T00:00:00').toLocaleDateString('en-IN',{month:'short'})}
        </div>
      </div>

      <!-- Main info -->
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-weight:700;font-size:14px">${formatDate(log.date)}</span>
          ${statusBadge}
          ${openSess > 0 ? `<span class="badge" style="background:rgba(0,255,136,0.12);color:#00ff88;border:1px solid rgba(0,255,136,0.25);font-size:10px;animation:pulse 1.4s infinite">● Active</span>` : ''}
        </div>
        <div style="font-size:12px;color:var(--text2);margin-top:3px">${summaryLine}</div>
        ${totalSess > 0 ? `<div style="font-size:11px;color:var(--text3);margin-top:2px">${totalSess} cabin session${totalSess!==1?'s':''} &nbsp;·&nbsp; ${totalSess > 0 ? sessions.reduce((a,s) => a + (s.movements||[]).length, 0) : 0} gate movement${sessions.reduce((a,s) => a + (s.movements||[]).length, 0)!==1?'s':''}</div>` : ''}
      </div>

      <!-- Chevron -->
      <div class="day-chevron" style="color:var(--text3);font-size:18px;transition:transform 0.25s;flex-shrink:0">▾</div>
    </div>

    <!-- Body (hidden by default, shown on click) -->
    <div style="display:none;padding:0 18px 18px;border-top:1px solid var(--border)">
      ${totalSess === 0
        ? `<p style="color:var(--text3);font-size:13px;text-align:center;padding:20px">No session data recorded for this day.</p>`
        : sessions.map((s, si) => renderSessionBlock(s, si, totalSess)).join('')
      }
    </div>
  </div>`;
}

// ─── Render one session block with timeline ───────────────────────────────────

function renderSessionBlock(session, idx, total) {
  const isOpen     = !session.cabinOutTime;
  const borderColor = isOpen ? '#00ff88' : 'var(--border)';
  const bgColor     = isOpen ? 'rgba(0,255,136,0.03)' : 'var(--surface2)';
  const glowStyle   = isOpen ? 'box-shadow:0 0 0 1px rgba(0,255,136,0.2)' : '';
  const movements   = session.movements || [];

  // Build timeline steps
  const steps = [];

  // Step 1: Cabin IN
  steps.push({
    icon:    '👨‍🏫',
    label:   'Cabin Check-In',
    time:    formatTime(session.cabinInTime),
    color:   'var(--success)',
    last:    false,
  });

  // Middle steps: gate movements
  movements.forEach(m => {
    const isGateOut = m.type === 'GATE_OUT';
    steps.push({
      icon:  isGateOut ? '🏃' : '📥',
      label: isGateOut ? 'Left via Gate' : 'Returned via Gate',
      time:  formatTime(m.timestamp),
      color: isGateOut ? 'var(--warning)' : '#00b4d8',
      last:  false,
    });
  });

  // Last step: Cabin OUT or open
  if (session.cabinOutTime) {
    steps.push({ icon: '🚪', label: 'Cabin Check-Out', time: formatTime(session.cabinOutTime), color: '#f97316', last: true });
  } else {
    const currentlyOut = movements.length > 0 && movements[movements.length - 1].type === 'GATE_OUT';
    steps.push({
      icon:   currentlyOut ? '🏃' : '⏳',
      label:  currentlyOut ? 'Currently outside campus' : 'Session still active',
      time:   'ongoing',
      color:  '#555',
      last:   true,
      dimmed: true,
    });
  }

  const timelineHtml = steps.map((step, si) => `
    <div style="display:flex;gap:12px;align-items:flex-start${step.dimmed ? ';opacity:.5' : ''}">
      <!-- Icon + connector -->
      <div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0;width:34px">
        <div style="width:34px;height:34px;border-radius:50%;background:${step.color}18;border:1.5px solid ${step.color};
                    display:flex;align-items:center;justify-content:center;font-size:15px;z-index:1">${step.icon}</div>
        ${!step.last ? `<div style="width:2px;min-height:16px;flex:1;background:linear-gradient(${step.color},#2a2a3a);margin:2px 0"></div>` : ''}
      </div>
      <!-- Text -->
      <div style="padding:6px 0 ${!step.last ? '14px' : '0'}">
        <div style="font-weight:600;font-size:13px;color:${step.color}">${step.label}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:1px">${step.time}</div>
      </div>
    </div>`).join('');

  // Duration calc
  let durationStr = '';
  if (session.cabinInTime && session.cabinOutTime) {
    const mins = Math.round((new Date(session.cabinOutTime) - new Date(session.cabinInTime)) / 60000);
    durationStr = mins >= 60
      ? `${Math.floor(mins/60)}h ${mins%60}m`
      : `${mins}m`;
  }

  return `
  <div style="margin-top:14px;border:1.5px solid ${borderColor};border-radius:12px;
              padding:14px 16px;background:${bgColor};${glowStyle}">
    <!-- Session header -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <span style="font-size:11px;font-weight:700;color:var(--text3);letter-spacing:.06em">SESSION ${idx + 1} / ${total}</span>
      <div style="display:flex;gap:6px;align-items:center">
        ${durationStr ? `<span style="font-size:11px;color:var(--text2)">⏱ ${durationStr}</span>` : ''}
        ${isOpen ? `<span class="badge badge-green" style="font-size:10px;animation:pulse 1.4s infinite">● ACTIVE</span>` : `<span class="badge" style="font-size:10px;background:var(--surface2);color:var(--text2)">CLOSED</span>`}
      </div>
    </div>
    <!-- Timeline -->
    ${timelineHtml}
  </div>`;
}
