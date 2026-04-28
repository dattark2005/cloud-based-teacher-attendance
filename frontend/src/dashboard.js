import { apiFetch, formatTime, formatDate, getInitials, showToast, navigate } from './utils.js';

let camStream = null;

export function renderDashboard(teacher) {
  return `
<div class="page" id="page-dashboard">
  <div class="main-content">
    <div class="page-header flex items-center justify-between">
      <div>
        <h1>Good ${getGreeting()}, <span class="grad-text">${teacher.fullName.split(' ')[0]}</span> 👋</h1>
        <p class="text-muted">${new Date().toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</p>
      </div>
      <div id="today-badge"></div>
    </div>

    <!-- Stats -->
    <div class="grid-4 mb-6" id="stats-grid">
      ${['Present Days','Late Days','This Month','Attendance %'].map((l,i) => `
      <div class="stat-card">
        <div class="stat-icon" style="background:${['rgba(108,99,255,0.15)','rgba(245,158,11,0.15)','rgba(0,212,170,0.15)','rgba(255,107,157,0.15)'][i]}">
          ${['📅','⏰','📊','🎯'][i]}
        </div>
        <div class="stat-value grad-text" id="stat-${i}">—</div>
        <div class="stat-label">${l}</div>
      </div>`).join('')}
    </div>

    <div class="grid-2" style="gap:24px">
      <!-- Today's Check-in card -->
      <div class="card card-glow">
        <h3 class="font-bold mb-4">📋 Today's Attendance</h3>
        <div id="today-status-panel">
          <div class="text-center" style="padding:20px"><div class="spinner" style="margin:0 auto"></div></div>
        </div>
      </div>

      <!-- Recent Activity -->
      <div class="card">
        <h3 class="font-bold mb-4">🕐 Recent Activity</h3>
        <div id="recent-activity" class="timeline">
          <p class="text-dim text-sm">Loading...</p>
        </div>
      </div>
    </div>

    <!-- All Teachers today -->
    <div class="card mt-4">
      <div class="flex items-center justify-between mb-4">
        <h3 class="font-bold">👥 All Teachers — Today</h3>
        <button class="btn btn-ghost btn-sm" id="btn-refresh-dash">↻ Refresh</button>
      </div>
      <div id="all-teachers-today" class="grid-auto">
        <p class="text-dim text-sm">Loading...</p>
      </div>
    </div>
  </div>
</div>`;
}

export async function initDashboard() {
  await Promise.all([loadTodayStatus(), loadHistory(), loadAllTeachers()]);
  document.getElementById('btn-refresh-dash').addEventListener('click', () => {
    loadTodayStatus(); loadHistory(); loadAllTeachers();
  });
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
      panel.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:16px">
          <div class="flex items-center gap-4">
            <div style="width:56px;height:56px;border-radius:50%;background:${isLate?'rgba(245,158,11,0.2)':'rgba(16,185,129,0.2)'};border:2px solid ${isLate?'var(--warning)':'var(--success)'};display:flex;align-items:center;justify-content:center;font-size:24px">
              ${isLate?'⏰':'✅'}
            </div>
            <div>
              <div class="font-bold" style="font-size:18px">Checked In ${isLate?'(Late)':''}</div>
              <div class="text-muted text-sm">at ${formatTime(log.checkInTime)}</div>
            </div>
          </div>
          ${log.checkOutTime ? `<div class="flex items-center gap-3"><div style="font-size:24px">🚪</div><div><div class="font-semibold">Checked Out</div><div class="text-muted text-sm">at ${formatTime(log.checkOutTime)}</div></div></div>` : ''}
          <div class="flex gap-2">
            <span class="badge ${isLate?'badge-yellow':'badge-green'}">${log.status}</span>
            <span class="badge badge-blue">${log.verificationMethod}</span>
            ${log.confidenceScore ? `<span class="badge badge-blue">${Math.round(log.confidenceScore*100)}% confidence</span>` : ''}
          </div>
        </div>`;
      document.getElementById('today-badge').innerHTML = `<span class="badge ${isLate?'badge-yellow':'badge-green'} badge-dot">${isLate?'Late':'Present'}</span>`;
    }
  } catch(e) { console.error(e); }
}

async function loadHistory() {
  try {
    const res = await apiFetch('/attendance/history?limit=7');
    const { logs, stats } = res.data;

    // Update stats
    document.getElementById('stat-0').textContent = stats.present;
    document.getElementById('stat-1').textContent = stats.late;
    document.getElementById('stat-2').textContent = stats.total;
    const pct = stats.total > 0 ? Math.round((stats.present + stats.late) / stats.total * 100) : 0;
    document.getElementById('stat-3').textContent = pct + '%';

    // Recent activity timeline
    const el = document.getElementById('recent-activity');
    if (!logs.length) { el.innerHTML = '<p class="text-dim text-sm">No records yet</p>'; return; }
    el.innerHTML = logs.slice(0,5).map(l => `
      <div class="timeline-item">
        <div class="timeline-dot ${l.checkInTime?'in':''}">📅</div>
        <div class="timeline-line"></div>
        <div class="timeline-content">
          <div class="timeline-title">${formatDate(l.date)} — <span class="badge ${l.status==='LATE'?'badge-yellow':'badge-green'}" style="font-size:11px">${l.status}</span></div>
          <div class="timeline-time">In: ${formatTime(l.checkInTime)} ${l.checkOutTime?'· Out: '+formatTime(l.checkOutTime):''}</div>
        </div>
      </div>`).join('');
  } catch(e) { console.error(e); }
}

async function loadAllTeachers() {
  try {
    const res = await apiFetch('/attendance/all');
    const { logs = [], absent = [], summary = {} } = res.data;
    const el = document.getElementById('all-teachers-today');
    if (!el) return;
    const cards = [
      ...logs.map(l => ({ name: l.teacherId?.fullName, dept: l.teacherId?.department, id: l.teacherId?.employeeId, status: l.status, time: formatTime(l.checkInTime) })),
      ...absent.map(t => ({ name: t.fullName, dept: t.department, id: t.employeeId, status: 'ABSENT', time: null })),
    ];
    el.innerHTML = cards.map(c => `
      <div class="teacher-card">
        <div class="flex items-center gap-3">
          <div class="teacher-avatar">${getInitials(c.name)}</div>
          <div class="teacher-info">
            <div class="teacher-name">${c.name}</div>
            <div class="teacher-dept">${c.dept}</div>
            <div class="teacher-id">${c.id}</div>
          </div>
        </div>
        <div class="flex items-center justify-between">
          <span class="badge ${c.status==='PRESENT'?'badge-green':c.status==='LATE'?'badge-yellow':'badge-red'}">${c.status}</span>
          ${c.time ? `<span class="text-dim text-xs">${c.time}</span>` : ''}
        </div>
      </div>`).join('') || '<p class="text-dim text-sm">No data</p>';
  } catch(e) { console.error(e); }
}
