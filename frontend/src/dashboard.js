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
  const methods = matches.map(m => m.method === 'VOICE' ? 'Voice' : 'Face');
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
    <div class="grid-4 mb-6" id="stats-grid">
      ${(isAdmin ? ['Total Faculty','Present Today','Late Today','Absent Today'] : ['Present Days','Late Days','This Month','Attendance %']).map((l,i) => `
      <div class="stat-card">
        <div class="stat-icon" style="background:${['rgba(108,99,255,0.15)','rgba(245,158,11,0.15)','rgba(0,212,170,0.15)','rgba(255,107,157,0.15)'][i]}">
          ${['👥','✅','⏰','❌'][i]}
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
        <div id="recent-activity" style="display:flex;flex-direction:column;gap:10px;max-height:240px;overflow-y:auto">
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
      <p class="text-muted text-sm mb-4" id="modal-teacher-details"></p>
      
      <div class="grid-3 mb-4" id="modal-stats" style="gap:10px"></div>
      
      <h3 class="font-bold mb-2">Full Attendance History</h3>
      <div id="modal-history" style="display:flex;flex-direction:column;gap:10px"></div>
    </div>
  </div>
</div>`;
}

export async function initDashboard() {
  const teacher = JSON.parse(localStorage.getItem('ta_teacher')) || {};
  const isAdmin = teacher.role === 'admin';

  if (isAdmin) {
    await loadAllTeachers();
  } else {
    await Promise.all([loadTodayStatus(), loadHistory()]);
  }

  document.getElementById('btn-refresh-dash')?.addEventListener('click', () => {
    if (isAdmin) loadAllTeachers();
    else { loadTodayStatus(); loadHistory(); }
  });
  
  document.getElementById('close-admin-modal')?.addEventListener('click', () => {
    document.getElementById('admin-modal').classList.add('hidden');
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
      const isLate = log.status === 'LATE';
      const inTime  = formatTime(log.checkInTime);
      const outTime = log.checkOutTime ? formatTime(log.checkOutTime) : null;
      panel.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:16px">
          <!-- Check-in row -->
          <div class="flex items-center gap-4">
            <div style="width:48px;height:48px;border-radius:50%;
                 background:${isLate?'rgba(245,158,11,0.2)':'rgba(16,185,129,0.2)'};
                 border:2px solid ${isLate?'var(--warning)':'var(--success)'};
                 display:flex;align-items:center;justify-content:center;font-size:22px">
              📥
            </div>
            <div>
              <div class="font-bold">Check-In ${isLate ? '<span style="color:var(--warning);font-size:13px">(Late)</span>' : ''}</div>
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
          <div class="flex gap-2 flex-wrap">
            <span class="badge ${isLate?'badge-yellow':'badge-green'}">${log.status}</span>
            ${methodBadges(log)}
            ${log.confidenceScore ? `<span class="badge badge-blue">${Math.round(log.confidenceScore*100)}% face</span>` : ''}
            ${log.voiceSimilarity ? `<span class="badge" style="background:rgba(139,92,246,0.2);color:#a78bfa">${Math.round(log.voiceSimilarity*100)}% voice</span>` : ''}
          </div>
        </div>`;
      document.getElementById('today-badge').innerHTML = `<span class="badge ${isLate?'badge-yellow':'badge-green'} badge-dot">${isLate?'Late':'Present'}</span>`;
    }
  } catch(e) { console.error(e); }
}

async function loadHistory() {
  try {
    const res = await apiFetch('/attendance/history?limit=30');
    const { logs, stats } = res.data;

    document.getElementById('stat-0').textContent = stats.present;
    document.getElementById('stat-1').textContent = stats.late;
    document.getElementById('stat-2').textContent = stats.total;
    const pct = stats.total > 0 ? Math.round((stats.present + stats.late) / stats.total * 100) : 0;
    document.getElementById('stat-3').textContent = pct + '%';

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
      document.getElementById('stat-2').textContent = summary.late;
      document.getElementById('stat-3').textContent = summary.absent;
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
            <div class="teacher-dept">${c.dept}</div>
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

async function openAdminModal(teacherId) {
  const modal = document.getElementById('admin-modal');
  modal.classList.remove('hidden');
  document.getElementById('modal-history').innerHTML = '<div class="spinner" style="margin: 20px auto"></div>';
  
  try {
    const res = await apiFetch(`/attendance/admin/teacher/${teacherId}/history`);
    const { teacher, stats, logs } = res.data;
    
    document.getElementById('modal-teacher-name').textContent = teacher.fullName;
    document.getElementById('modal-teacher-details').textContent = `${teacher.designation} • ${teacher.department} • ${teacher.employeeId}`;
    
    document.getElementById('modal-stats').innerHTML = `
      <div style="background:var(--surface-2);padding:10px;border-radius:8px;text-align:center">
        <div style="font-size:24px;font-weight:bold">${stats.total}</div>
        <div style="font-size:12px;color:var(--text-dim)">Total Days</div>
      </div>
      <div style="background:rgba(16,185,129,0.1);padding:10px;border-radius:8px;text-align:center;color:var(--success)">
        <div style="font-size:24px;font-weight:bold">${stats.present}</div>
        <div style="font-size:12px;opacity:0.8">Present</div>
      </div>
      <div style="background:rgba(245,158,11,0.1);padding:10px;border-radius:8px;text-align:center;color:var(--warning)">
        <div style="font-size:24px;font-weight:bold">${stats.late}</div>
        <div style="font-size:12px;opacity:0.8">Late</div>
      </div>
    `;
    
    if (logs.length === 0) {
      document.getElementById('modal-history').innerHTML = '<p class="text-dim">No attendance history available.</p>';
      return;
    }
    
    document.getElementById('modal-history').innerHTML = logs.map(l => {
      const inTime  = l.checkInTime  ? formatTime(l.checkInTime)  : null;
      const outTime = l.checkOutTime ? formatTime(l.checkOutTime) : null;
      return `
      <div style="display:flex;align-items:flex-start;gap:12px;padding:10px 12px;
                  background:var(--surface);border-radius:10px;border:1px solid var(--border)">
        <div style="font-size:20px;margin-top:2px">📅</div>
        <div style="flex:1">
          <div class="font-semibold text-sm">${formatDate(l.date)} <span class="badge ${l.status==='LATE'?'badge-yellow':'badge-green'}" style="margin-left:8px;font-size:10px">${l.status}</span></div>
          <div class="flex gap-2 mt-1 flex-wrap">
            ${inTime  ? `<span class="time-chip in">📥 In: ${inTime}${getEventMethodBadge(l, 'CHECK_IN')}</span>`   : ''}
            ${outTime ? `<span class="time-chip out">📤 Out: ${outTime}${getEventMethodBadge(l, 'CHECK_OUT')}</span>` : ''}
          </div>
          <div class="flex gap-1 mt-1 flex-wrap">${methodBadges(l)}</div>
        </div>
      </div>`;
    }).join('');
    
  } catch(e) {
    document.getElementById('modal-history').innerHTML = '<p style="color:var(--error)">Error loading history.</p>';
  }
}
