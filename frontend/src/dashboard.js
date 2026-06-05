import { apiFetch, formatTime, formatDate, getInitials, showToast, navigate } from './utils.js';

// ── Method badge helper ───────────────────────────────────────────────────────
function methodBadges(log) {
  // Support both old single-method and new verificationMethods array
  const methods = (log.verificationMethods && log.verificationMethods.length)
    ? log.verificationMethods
    : [log.verificationMethod || 'FACE'];

  return methods.map(m => {
    if (m === 'VOICE')      return `<span class="badge" style="background:rgba(139,92,246,0.2);color:#a78bfa;border:1px solid rgba(139,92,246,0.4)">🎤 Voice</span>`;
    if (m === 'FACE')       return `<span class="badge" style="background:rgba(16,185,129,0.2);color:#34d399;border:1px solid rgba(16,185,129,0.4)">📷 Face</span>`;
    if (m === 'FACE_LOCAL') return `<span class="badge" style="background:rgba(99,102,241,0.2);color:#818cf8;border:1px solid rgba(99,102,241,0.4)">📷 Face</span>`;
    return `<span class="badge badge-blue">${m}</span>`;
  }).join('');
}

function getEventMethodBadge(log, eventType) {
  if (!log.logs || !log.logs.length) {
    if (eventType === 'CHECK_IN') {
      const m = log.verificationMethod || 'FACE';
      return ` <span style="opacity:0.85;font-size:10px;margin-left:4px">(${m === 'VOICE' ? 'Voice' : 'Face'})</span>`;
    }
    return '';
  }
  const matches = log.logs.filter(e => e.event === eventType);
  if (!matches.length) {
    if (eventType === 'CHECK_IN' && log.checkInTime) {
      return ` <span style="opacity:0.85;font-size:10px;margin-left:4px">(${log.verificationMethod === 'VOICE' ? 'Voice' : 'Face'})</span>`;
    }
    if (eventType === 'CHECK_OUT' && log.checkOutTime) {
      return ` <span style="opacity:0.85;font-size:10px;margin-left:4px">(Face)</span>`;
    }
    return '';
  }
  const methods = [...new Set(matches.map(m => m.method === 'VOICE' ? 'Voice' : 'Face'))];
  return ` <span style="opacity:0.85;font-size:10px;margin-left:4px">(${methods.join('+')})</span>`;
}

export function renderDashboard(teacher) {
  const isAdmin = teacher.role === 'admin';
  return `
<div class="page" id="page-dashboard">
  <div class="main-content">
    <div class="page-header flex items-center justify-between">
      <div>
        <h1>Good ${getGreeting()}, <span class="grad-text">${teacher.fullName.split(' ')[0]}</span> 👋</h1>
        <p class="text-muted">${new Date().toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</p>
      </div>
      ${!isAdmin ? `<div id="today-badge"></div>` : ''}
    </div>

    <!-- Stats -->
    <div class="grid-3 mb-6" id="stats-grid">
      ${(isAdmin ? ['Total Faculty','Present Today','Absent Today'] : ['Present Days','Absent Days','Attendance %']).map((l,i) => `
      <div class="stat-card">
        <div class="stat-icon" style="background:${['rgba(108,99,255,0.15)','rgba(0,212,170,0.15)','rgba(255,107,157,0.15)'][i]}">
          ${['👥','✅','❌'][i]}
        </div>
        <div class="stat-value grad-text" id="stat-${i}">—</div>
        <div class="stat-label">${l}</div>
      </div>`).join('')}
    </div>

    ${!isAdmin ? `
    <div class="grid-2" style="gap:24px">
      <!-- Today's Check-in card -->
      <div class="card card-glow">
        <h3 class="font-bold mb-4">📋 Today's Attendance</h3>
        <div id="today-status-panel">
          <div class="text-center" style="padding:20px"><div class="spinner" style="margin:0 auto"></div></div>
        </div>
      </div>

      <!-- Recent Activity — clean timestamp feed -->
      <div class="card">
        <h3 class="font-bold mb-4">🕐 Recent Activity</h3>
        <div id="recent-activity" style="display:flex;flex-direction:column;gap:10px;max-height:450px;overflow-y:auto">
          <p class="text-dim text-sm">Loading...</p>
        </div>
      </div>
    </div>` : `
    <!-- All Teachers today -->
    <div class="card mt-4">
      <div class="flex items-center justify-between mb-4">
        <h3 class="font-bold">👥 All Teachers — Today</h3>
        <button class="btn btn-ghost btn-sm" id="btn-refresh-dash">↻ Refresh</button>
      </div>
      <div id="all-teachers-today" class="grid-auto">
        <p class="text-dim text-sm">Loading...</p>
      </div>
    </div>`}
  </div>

  <!-- Admin Modal (hidden by default) -->
  <div id="admin-modal" class="hidden" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;">
    <div class="card" style="width:100%;max-width:600px;max-height:90vh;overflow-y:auto;position:relative">
      <button class="btn btn-ghost btn-sm" id="close-admin-modal" style="position:absolute;top:10px;right:10px;font-size:20px">×</button>
      <h2 class="font-bold mb-2" id="modal-teacher-name">Loading...</h2>
      <p class="text-muted text-sm mb-2" id="modal-teacher-details"></p>
      <div id="modal-biometric-status" style="display:flex;gap:10px;margin-bottom:16px;align-items:center"></div>
      
      <div class="grid-3 mb-4" id="modal-stats" style="gap:10px"></div>
      
      <div class="flex items-center justify-between mb-2 flex-wrap" style="gap:12px;margin-top:16px">
        <h3 class="font-bold" style="margin:0">Full Attendance History</h3>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:4px">
            <span class="text-dim" style="font-size:11px">From:</span>
            <input type="date" id="modal-filter-start" class="form-input" style="padding:4px 8px;font-size:12px;width:120px;background:var(--surface2);border-color:var(--border)" />
          </div>
          <div style="display:flex;align-items:center;gap:4px">
            <span class="text-dim" style="font-size:11px">To:</span>
            <input type="date" id="modal-filter-end" class="form-input" style="padding:4px 8px;font-size:12px;width:120px;background:var(--surface2);border-color:var(--border)" />
          </div>
          <button class="btn btn-ghost btn-sm" id="btn-modal-clear-date" style="padding:4px 8px;font-size:11px">Clear</button>
        </div>
      </div>
      <div id="modal-history" style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px"></div>

      <h3 class="font-bold mb-2">Biometrics Activity History</h3>
      <div id="modal-voice-history" style="display:flex;flex-direction:column;gap:10px"></div>
    </div>
  </div>
</div>`;
}

export async function initDashboard() {
  const teacher = JSON.parse(localStorage.getItem('ta_teacher')) || {};
  const isAdmin = teacher.role === 'admin';

  if (isAdmin) {
    await loadAllTeachers();

    document.getElementById('modal-filter-start')?.addEventListener('change', () => {
      if (window.__activeModalTeacherId) fetchAndRenderAdminModal(window.__activeModalTeacherId);
    });
    document.getElementById('modal-filter-end')?.addEventListener('change', () => {
      if (window.__activeModalTeacherId) fetchAndRenderAdminModal(window.__activeModalTeacherId);
    });
    document.getElementById('btn-modal-clear-date')?.addEventListener('click', () => {
      const start = document.getElementById('modal-filter-start');
      const end = document.getElementById('modal-filter-end');
      if (start) start.value = '';
      if (end) end.value = '';
      if (window.__activeModalTeacherId) fetchAndRenderAdminModal(window.__activeModalTeacherId);
    });
  } else {
    await Promise.all([loadTodayStatus(), loadHistory()]);
  }

  document.getElementById('btn-refresh-dash')?.addEventListener('click', () => {
    if (isAdmin) loadAllTeachers();
    else { loadTodayStatus(); loadHistory(); }
  });
  
  document.getElementById('close-admin-modal')?.addEventListener('click', () => {
    document.getElementById('admin-modal').classList.add('hidden');
    window.__activeModalTeacherId = null;
  });
}

// Called externally (e.g. from voice.js after marking attendance)
export function refreshDashboard() {
  const teacher = JSON.parse(localStorage.getItem('ta_teacher')) || {};
  if (teacher.role === 'admin') {
    loadAllTeachers();
  } else {
    loadTodayStatus();
    loadHistory();
  }
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Morning'; if (h < 17) return 'Afternoon'; return 'Evening';
}

async function loadTodayStatus() {
  try {
    const res = await apiFetch('/attendance/today');
    const log = res.data?.log;
    const panel = document.getElementById('today-status-panel');
    if (!log || !log.checkInTime) {
      panel.innerHTML = `
        <div class="text-center" style="padding:24px">
          <div style="font-size:48px;margin-bottom:12px">⏳</div>
          <p class="font-semibold">Not checked in yet</p>
          <p class="text-muted text-sm mt-1">Go to Scanner or use manual check-in below</p>
          <button class="btn btn-primary mt-4" id="btn-goto-scanner">Open Scanner</button>
        </div>`;
      document.getElementById('btn-goto-scanner')?.addEventListener('click', () => navigate('scanner'));
      document.getElementById('today-badge').innerHTML = '<span class="badge badge-red badge-dot">Not Checked In</span>';
    } else {
      const inTime  = formatTime(log.checkInTime);
      const outTime = log.checkOutTime ? formatTime(log.checkOutTime) : null;
      const lastEvent = log.logs && log.logs.length
        ? log.logs[log.logs.length - 1].event
        : (log.checkOutTime ? 'CHECK_OUT' : 'CHECK_IN');

      const currentStatusLabel = lastEvent === 'CHECK_IN' ? 'Inside Campus' : 'Outside Campus';
      const statusBadgeClass = lastEvent === 'CHECK_IN' ? 'badge-green' : 'badge-blue';

      let timelineHtml = '';
      if (log.logs && log.logs.length) {
        timelineHtml = `
          <div style="margin-top:14px">
            <div class="text-dim font-bold text-xs uppercase mb-3">Today's Log Timeline</div>
            <div style="display:flex;flex-direction:column;gap:14px;margin-left:8px;padding-left:14px;border-left:2px dashed var(--border)">
              ${log.logs.map(e => {
                const isCheckIn = e.event === 'CHECK_IN';
                const icon = isCheckIn ? '📥' : '📤';
                const dotColor = isCheckIn ? 'var(--success)' : '#00b4d8';
                const label = isCheckIn ? 'Check-In' : 'Check-Out';
                const method = e.method === 'VOICE' ? 'Voice' : (e.method === 'MANUAL' ? 'Manual' : 'Face');
                const confidence = e.confidence ? ` (conf: ${Math.round(e.confidence * 100)}%)` : '';
                return `
                  <div style="display:flex;align-items:center;gap:12px;position:relative">
                    <div style="position:absolute;left:-20px;width:10px;height:10px;border-radius:50%;background:${dotColor};border:2px solid var(--surface)"></div>
                    <div style="font-size:16px">${icon}</div>
                    <div>
                      <div class="font-semibold text-sm" style="color:var(--text)">${label} — <span style="font-weight:normal;opacity:0.8">${formatTime(e.timestamp)}</span></div>
                      <div class="text-dim text-xs">${method}${confidence}</div>
                    </div>
                  </div>`;
              }).join('')}
            </div>
          </div>`;
      } else {
        timelineHtml = `
          <div style="display:flex;flex-direction:column;gap:16px">
            <!-- Check-in row -->
            <div class="flex items-center gap-4">
              <div style="width:48px;height:48px;border-radius:50%;
                   background:rgba(16,185,129,0.2);
                   border:2px solid var(--success);
                   display:flex;align-items:center;justify-content:center;font-size:22px">
                📥
              </div>
              <div>
                <div class="font-bold">Check-In</div>
                <div class="text-muted text-sm" style="display:flex;align-items:center">${inTime}${getEventMethodBadge(log, 'CHECK_IN')}</div>
              </div>
            </div>
            <!-- Check-out row -->
            ${outTime ? `
            <div class="flex items-center gap-4">
              <div style="width:48px;height:48px;border-radius:50%;
                   background:rgba(0,180,216,0.15);border:2px solid #00b4d8;
                   display:flex;align-items:center;justify-content:center;font-size:22px">
                 📤
              </div>
              <div>
                <div class="font-bold">Check-Out</div>
                <div class="text-muted text-sm" style="display:flex;align-items:center">${outTime}${getEventMethodBadge(log, 'CHECK_OUT')}</div>
              </div>
            </div>` : `
            <div style="padding:10px;background:var(--surface-2);border-radius:10px;text-align:center;font-size:13px;color:var(--text-dim)">
              Check-out not recorded yet
            </div>`}
          </div>`;
      }

      panel.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:12px">
          <div style="display:flex;align-items:center;justify-content:space-between;background:var(--surface-2);padding:12px;border-radius:10px;border:1px solid var(--border)">
            <div>
              <div class="text-dim text-xs uppercase font-bold">Status</div>
              <div class="font-semibold text-sm" style="margin-top:2px">${currentStatusLabel}</div>
            </div>
            <span class="badge ${statusBadgeClass}">${lastEvent === 'CHECK_IN' ? 'PRESENT' : 'OUT'}</span>
          </div>
          ${timelineHtml}
        </div>`;
      document.getElementById('today-badge').innerHTML = `<span class="badge ${statusBadgeClass} badge-dot">${lastEvent === 'CHECK_IN' ? 'Present' : 'Out'}</span>`;
    }
  } catch(e) { console.error(e); }
}

async function loadHistory() {
  try {
    const res = await apiFetch('/attendance/history?limit=30');
    const { logs, stats } = res.data;

    document.getElementById('stat-0').textContent = stats.present;
    document.getElementById('stat-1').textContent = stats.absent;
    const pct = stats.total > 0 ? Math.round(stats.present / stats.total * 100) : 0;
    document.getElementById('stat-2').textContent = pct + '%';

    // Recent activity — show check-in / check-out timestamps only (no status labels)
    const el = document.getElementById('recent-activity');
    if (!logs.length) {
      el.innerHTML = '<p class="text-dim text-sm">No records yet</p>';
      return;
    }

    el.innerHTML = logs.slice(0, 7).map(l => {
      const inTime  = l.checkInTime  ? formatTime(l.checkInTime)  : null;
      const outTime = l.checkOutTime ? formatTime(l.checkOutTime) : null;
      const dateStr = formatDate(l.date);
      return `
      <div style="display:flex;align-items:flex-start;gap:12px;padding:10px 12px;
                  background:var(--surface);border-radius:10px;border:1px solid var(--border)">
        <div style="font-size:20px;margin-top:2px">📅</div>
        <div style="flex:1">
          <div class="font-semibold text-sm">${dateStr}</div>
          <div class="flex gap-2 mt-1 flex-wrap">
            ${inTime  ? `<span class="time-chip in">📥 In: ${inTime}${getEventMethodBadge(l, 'CHECK_IN')}</span>`   : ''}
            ${outTime ? `<span class="time-chip out">📤 Out: ${outTime}${getEventMethodBadge(l, 'CHECK_OUT')}</span>` : ''}
            ${!inTime && !outTime ? '<span class="text-dim text-xs">No data</span>' : ''}
          </div>
          <div class="flex gap-1 mt-1 flex-wrap">${methodBadges(l)}</div>
        </div>
      </div>`;
    }).join('');
  } catch(e) { console.error(e); }
}

async function loadAllTeachers() {
  try {
    const res = await apiFetch('/attendance/all');
    const { logs = [], absent = [], summary } = res.data;
    
    // Update Global Stats
    if (summary) {
      document.getElementById('stat-0').textContent = summary.total;
      document.getElementById('stat-1').textContent = summary.present;
      document.getElementById('stat-2').textContent = summary.absent;
    }

    const el = document.getElementById('all-teachers-today');
    if (!el) return;

    const present = logs.map(l => ({
      name: l.teacherId?.fullName,
      dept: l.teacherId?.department,
      id: l.teacherId?._id,
      empId: l.teacherId?.employeeId,
      status: l.status,
      inTime:       l.checkInTime  ? formatTime(l.checkInTime) + getEventMethodBadge(l, 'CHECK_IN')  : null,
      outTime:      l.checkOutTime ? formatTime(l.checkOutTime) + getEventMethodBadge(l, 'CHECK_OUT') : null,
      methodBadges: methodBadges(l),
    }));
    const absentList = absent.map(t => ({
      name: t.fullName, dept: t.department, id: t._id, empId: t.employeeId,
      status: 'ABSENT', inTime: null, outTime: null,
    }));

    const cards = [...present, ...absentList];
    el.innerHTML = cards.map(c => `
      <div class="teacher-card" data-tid="${c.id}" style="cursor:pointer; transition: transform 0.2s" onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='scale(1)'">
        <div class="flex items-center gap-3">
          <div class="teacher-avatar">${getInitials(c.name)}</div>
          <div class="teacher-info">
            <div class="teacher-name">${c.name}</div>
            <div class="teacher-dept">${(c.dept || '').toUpperCase()}</div>
            <div class="teacher-id">${c.empId}</div>
          </div>
        </div>
        <div style="margin-top:8px;display:flex;flex-direction:column;gap:6px">
          <div class="flex gap-2 flex-wrap">
            ${c.inTime  ? `<span class="time-chip in">📥 ${c.inTime}</span>`   : ''}
            ${c.outTime ? `<span class="time-chip out">📤 ${c.outTime}</span>` : ''}
            ${c.status === 'ABSENT' ? '<span class="badge badge-red">ABSENT</span>' : ''}
          </div>
          ${c.status !== 'ABSENT' ? `<div class="flex gap-1 flex-wrap">${c.methodBadges}</div>` : ''}
        </div>
      </div>`).join('') || '<p class="text-dim text-sm">No data</p>';

    // Add click listeners to open modal
    document.querySelectorAll('.teacher-card').forEach(card => {
      card.addEventListener('click', () => openAdminModal(card.dataset.tid));
    });
  } catch(e) { console.error(e); }
}

export async function openAdminModal(teacherId) {
  window.__activeModalTeacherId = teacherId;
  const modal = document.getElementById('admin-modal');
  modal.classList.remove('hidden');
  
  const startInput = document.getElementById('modal-filter-start');
  const endInput = document.getElementById('modal-filter-end');
  if (startInput) startInput.value = '';
  if (endInput) endInput.value = '';
  
  await fetchAndRenderAdminModal(teacherId);
}

export async function fetchAndRenderAdminModal(teacherId) {
  const startInput = document.getElementById('modal-filter-start');
  const endInput = document.getElementById('modal-filter-end');
  const startDate = startInput ? startInput.value : '';
  const endDate = endInput ? endInput.value : '';

  document.getElementById('modal-history').innerHTML = '<div class="spinner" style="margin: 20px auto"></div>';
  document.getElementById('modal-voice-history').innerHTML = '<div class="spinner" style="margin: 20px auto"></div>';
  
  try {
    let url = `/attendance/admin/teacher/${teacherId}/history`;
    const params = [];
    if (startDate) params.push(`startDate=${startDate}`);
    if (endDate) params.push(`endDate=${endDate}`);
    if (params.length) url += `?${params.join('&')}`;

    const res = await apiFetch(url);
    const { teacher, stats, logs, biometricLogs, voiceRegistered, faceRegistered } = res.data;
    
    document.getElementById('modal-teacher-name').textContent = teacher.fullName;
    document.getElementById('modal-teacher-details').textContent = `${(teacher.designation || '').toUpperCase()} • ${(teacher.department || '').toUpperCase()} • ${teacher.employeeId}`;
    
    const faceBadge = faceRegistered
      ? `<span class="badge badge-green" style="font-size:11px;padding:3px 8px">📷 Face Registered</span>`
      : `<span class="badge badge-red" style="font-size:11px;padding:3px 8px">📷 Face Unregistered</span>`;
    const voiceBadge = voiceRegistered
      ? `<span class="badge" style="background:rgba(139,92,246,0.2);color:#a78bfa;border:1px solid rgba(139,92,246,0.4);font-size:11px;padding:3px 8px">🎤 Voice Registered</span>`
      : `<span class="badge badge-red" style="font-size:11px;padding:3px 8px">🎤 Voice Unregistered</span>`;
    const statusContainer = document.getElementById('modal-biometric-status');
    if (statusContainer) {
      statusContainer.innerHTML = `${faceBadge} ${voiceBadge}`;
    }
    
    const absent = Math.max(0, stats.total - stats.present);
    document.getElementById('modal-stats').innerHTML = `
      <div style="background:var(--surface-2);padding:10px;border-radius:8px;text-align:center">
        <div style="font-size:24px;font-weight:bold">${stats.total}</div>
        <div style="font-size:12px;color:var(--text-dim)">Total Days</div>
      </div>
      <div style="background:rgba(16,185,129,0.1);padding:10px;border-radius:8px;text-align:center;color:var(--success)">
        <div style="font-size:24px;font-weight:bold">${stats.present}</div>
        <div style="font-size:12px;opacity:0.8">Present</div>
      </div>
      <div style="background:rgba(255,107,157,0.1);padding:10px;border-radius:8px;text-align:center;color:var(--danger)">
        <div style="font-size:24px;font-weight:bold">${absent}</div>
        <div style="font-size:12px;opacity:0.8">Absent</div>
      </div>
    `;
    
    if (logs.length === 0) {
      document.getElementById('modal-history').innerHTML = '<p class="text-dim">No attendance history available.</p>';
    } else {
      document.getElementById('modal-history').innerHTML = logs.map(l => {
        let eventsHtml = '';
        if (l.logs && l.logs.length > 0) {
          eventsHtml = l.logs.map(e => {
            const isCheckIn = e.event === 'CHECK_IN';
            const icon = isCheckIn ? '📥 Check-In' : '📤 Check-Out';
            const chipClass = isCheckIn ? 'in' : 'out';
            const methodText = e.method === 'VOICE' ? 'Voice' : (e.method === 'MANUAL' ? 'Manual' : 'Face');
            const conf = e.confidence ? ` (${Math.round(e.confidence * 100)}%)` : '';
            return `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px dashed rgba(255,255,255,0.05)">
                <span class="time-chip ${chipClass}" style="font-size:11px">${icon}: ${formatTime(e.timestamp)}</span>
                <span class="text-dim text-xs">${methodText}${conf}</span>
              </div>
            `;
          }).join('');
        } else {
          const inTime  = l.checkInTime  ? formatTime(l.checkInTime)  : null;
          const outTime = l.checkOutTime ? formatTime(l.checkOutTime) : null;
          eventsHtml = `
            ${inTime ? `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0">
                <span class="time-chip in" style="font-size:11px">📥 Check-In: ${inTime}</span>
                <span class="text-dim text-xs">${l.verificationMethod || 'Face'}</span>
              </div>
            ` : ''}
            ${outTime ? `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0">
                <span class="time-chip out" style="font-size:11px">📤 Check-Out: ${outTime}</span>
                <span class="text-dim text-xs">Face</span>
              </div>
            ` : ''}
            ${!inTime && !outTime ? `<div class="text-dim text-xs">No check-in or check-out recorded</div>` : ''}
          `;
        }

        return `
        <div style="display:flex;flex-direction:column;gap:8px;padding:12px;
                    background:var(--surface);border-radius:10px;border:1px solid var(--border)">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span class="font-bold text-sm">📅 ${formatDate(l.date)}</span>
            <span class="badge ${l.status==='PRESENT'?'badge-green':'badge-red'}" style="font-size:10px;padding:2px 8px">${l.status}</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;padding-top:4px">
            ${eventsHtml}
          </div>
        </div>`;
      }).join('');
    }
    
    const voiceHistoryEl = document.getElementById('modal-voice-history');
    if (voiceHistoryEl) {
      const bioLogs = biometricLogs || [];
      if (bioLogs.length === 0) {
        voiceHistoryEl.innerHTML = '<p class="text-dim text-sm">No biometric activity recorded yet.</p>';
      } else {
        voiceHistoryEl.innerHTML = bioLogs.map(l => {
          const isRegister = l.action === 'REGISTER';
          const isDelete = l.action === 'DELETE';
          const badgeClass = isRegister ? 'badge-green' : (isDelete ? 'badge-red' : 'badge-blue');
          const typeText = l.biometricType === 'FACE' ? '📷 FACE' : '🎤 VOICE';
          return `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;
                        background:var(--surface);border-radius:10px;border:1px solid var(--border)">
              <div>
                <div style="display:flex;align-items:center;gap:6px">
                  <span class="badge ${badgeClass}" style="font-size:10px;padding:2px 6px">${l.action}</span>
                  <span class="text-semibold text-xs" style="color:var(--text-dim)">${typeText}</span>
                </div>
                <div class="text-dim mt-1" style="font-size:11px">${l.details || ''}</div>
              </div>
              <div class="text-right">
                <span class="text-dim" style="font-size:11px">${formatDate(l.timestamp)} ${formatTime(l.timestamp)}</span>
              </div>
            </div>`;
        }).join('');
      }
    }
    
  } catch(e) {
    document.getElementById('modal-history').innerHTML = '<p style="color:var(--error)">Error loading history.</p>';
    document.getElementById('modal-voice-history').innerHTML = '<p style="color:var(--error)">Error loading voice history.</p>';
  }
}

export async function refreshAdminModal() {
  if (window.__activeModalTeacherId) {
    await fetchAndRenderAdminModal(window.__activeModalTeacherId);
  }
}
