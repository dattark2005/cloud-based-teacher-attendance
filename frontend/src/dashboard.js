import { apiFetch, formatTime, formatDate, getInitials, showToast, navigate } from './utils.js';

// ─── helpers ──────────────────────────────────────────────────────────────────
function getGreeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening';
}

function durStr(from, to) {
  if (!from || !to) return '';
  const m = Math.round((new Date(to) - new Date(from)) / 60000);
  return m >= 60 ? `${Math.floor(m/60)}h ${m%60}m` : `${m}m`;
}

function gateState(session) {
  const mv = session.movements || [];
  if (!mv.length) return 'IN';
  return mv[mv.length - 1].type === 'GATE_OUT' ? 'OUT' : 'IN';
}

// Build a mini inline timeline for one session (used in both admin & teacher cards)
function sessionTimeline(session, compact = false) {
  const mv = session.movements || [];
  const steps = [];

  steps.push({ icon: '👨‍🏫', label: 'Cabin In',  time: formatTime(session.cabinInTime),  col: '#10b981' });
  mv.forEach(m => steps.push(
    m.type === 'GATE_OUT'
      ? { icon: '🏃', label: 'Left Gate',    time: formatTime(m.timestamp), col: '#f59e0b' }
      : { icon: '📥', label: 'Gate Return',  time: formatTime(m.timestamp), col: '#00b4d8' }
  ));
  if (session.cabinOutTime)
    steps.push({ icon: '🚪', label: 'Cabin Out', time: formatTime(session.cabinOutTime), col: '#f97316' });
  else
    steps.push({ icon: '⏳', label: 'Active',    time: 'ongoing', col: '#555', dim: true });

  if (compact) {
    // Pill row — for admin card view
    return `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
      ${steps.map(s => `
        <div style="display:flex;align-items:center;gap:4px;padding:3px 8px;
             border-radius:20px;background:${s.col}15;border:1px solid ${s.col}40;
             font-size:11px;color:${s.col}${s.dim ? ';opacity:.55' : ''}">
          <span>${s.icon}</span>
          <span style="font-weight:600">${s.label}</span>
          <span style="color:var(--text3)">${s.time}</span>
        </div>`).join('')}
    </div>`;
  }

  // Full vertical timeline
  return steps.map((s, i) => `
    <div style="display:flex;gap:10px;align-items:flex-start${s.dim ? ';opacity:.5' : ''}">
      <div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0;width:30px">
        <div style="width:30px;height:30px;border-radius:50%;background:${s.col}18;
                    border:1.5px solid ${s.col};display:flex;align-items:center;
                    justify-content:center;font-size:13px">${s.icon}</div>
        ${i < steps.length - 1 ? `<div style="width:2px;min-height:14px;flex:1;
          background:linear-gradient(${s.col},#2a2a3a);margin:2px 0"></div>` : ''}
      </div>
      <div style="padding:4px 0 ${i < steps.length - 1 ? '12px' : '0'}">
        <div style="font-weight:600;font-size:12px;color:${s.col}">${s.label}</div>
        <div style="font-size:11px;color:var(--text3)">${s.time}</div>
      </div>
    </div>`).join('');
}

// ─── RENDER ───────────────────────────────────────────────────────────────────
export function renderDashboard(teacher) {
  const isAdmin = teacher.role === 'ADMIN';

  if (isAdmin) return `
<div class="page" id="page-dashboard">
  <div class="main-content">
    <div class="page-header flex items-center justify-between">
      <div>
        <h1>Admin Dashboard <span class="grad-text">Overview</span> 📊</h1>
        <p class="text-muted" id="dash-date">${new Date().toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</p>
      </div>
      <div class="flex gap-2 items-center">
        <input type="date" id="dash-date-picker" class="form-input" style="padding:8px 12px;font-size:13px;max-width:160px"
               value="${new Date().toISOString().slice(0,10)}">
        <button class="btn btn-ghost btn-sm" id="btn-refresh-dash">↻ Refresh</button>
      </div>
    </div>

    <!-- Stat row -->
    <div class="grid-4 mb-6" id="stats-grid">
      ${[['Total Teachers','👥','rgba(108,99,255,0.15)'],['Present','✅','rgba(16,185,129,0.15)'],['Absent','❌','rgba(239,68,68,0.15)'],['Attendance %','🎯','rgba(0,212,170,0.15)']].map(([l,ic,bg],i)=>`
      <div class="stat-card">
        <div class="stat-icon" style="background:${bg}">${ic}</div>
        <div class="stat-value grad-text" id="admin-stat-${i}">—</div>
        <div class="stat-label">${l}</div>
      </div>`).join('')}
    </div>

    <!-- Teacher logs list -->
    <div class="card">
      <div class="flex items-center justify-between mb-4">
        <h3 class="font-bold">👥 All Teachers — Detailed Logs</h3>
        <div class="flex gap-2">
          <input id="search-teachers" class="form-input" placeholder="Search name…"
                 style="padding:7px 12px;font-size:13px;max-width:180px">
        </div>
      </div>
      <div id="all-teachers-today" style="display:flex;flex-direction:column;gap:12px">
        <p class="text-dim text-sm">Loading...</p>
      </div>
    </div>
  </div>
</div>`;

  // TEACHER dashboard — full-viewport 2-column layout
  // NOTE: the .page element must stay clean (no inline display:) so CSS
  // .page{display:none} / .page.active{display:flex} navigation keeps working.
  return `
<div class="page" id="page-dashboard">
  <!-- Inner grid fills sidebar-offset width -->
  <div style="margin-left:260px;flex:1;display:grid;grid-template-columns:300px 1fr;min-height:100vh;gap:0;overflow:hidden">

    <!-- LEFT PANEL: sticky stats -->
    <div style="background:var(--bg2);border-right:1px solid var(--border);
                padding:28px 20px;display:flex;flex-direction:column;gap:16px;
                position:sticky;top:0;height:100vh;overflow-y:auto">

      <div>
        <h2 style="font-size:20px;font-weight:800;line-height:1.3">
          Good ${getGreeting()},<br>
          <span class="grad-text">${teacher.fullName.split(' ')[0]}</span> 👋
        </h2>
        <p style="font-size:12px;color:var(--text2);margin-top:4px">
          ${new Date().toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}
        </p>
      </div>

      <div id="today-badge"></div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        ${[['Present','📅','rgba(108,99,255,0.15)','#8b85ff'],
           ['Absent','❌','rgba(239,68,68,0.15)','#ef4444'],
           ['Total','📊','rgba(0,212,170,0.15)','#00d4aa'],
           ['Rate','🎯','rgba(255,107,157,0.15)','#ff6b9d']
          ].map(([l,ic,bg,col],i)=>`
        <div style="background:${bg};border:1px solid ${col}30;border-radius:12px;
                    padding:14px 10px;text-align:center">
          <div style="font-size:18px">${ic}</div>
          <div style="font-size:22px;font-weight:800;color:${col};line-height:1.1;margin-top:4px"
               id="stat-${i}">—</div>
          <div style="font-size:11px;color:var(--text2);margin-top:3px">${l}</div>
        </div>`).join('')}
      </div>

      <div id="today-quick" style="display:none;border-radius:12px;padding:14px;
           border:1px solid rgba(0,255,136,0.25);background:rgba(0,255,136,0.04)"></div>

      <div style="flex:1"></div>

      <div style="padding:12px;background:var(--surface);border-radius:12px;border:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:10px">
          <div class="teacher-avatar" style="width:36px;height:36px;font-size:13px;flex-shrink:0">
            ${getInitials(teacher.fullName)}
          </div>
          <div style="min-width:0">
            <div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              ${teacher.fullName}
            </div>
            <div style="color:var(--text2);font-size:11px">${teacher.department}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- RIGHT PANEL: scrollable history -->
    <div style="overflow-y:auto;height:100vh;padding:28px 32px;min-width:0">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
        <h3 style="font-size:18px;font-weight:800">📅 Attendance History</h3>
        <button class="btn btn-ghost btn-sm" id="btn-reload-dash">↻ Refresh</button>
      </div>
      <div id="recent-activity" style="display:flex;flex-direction:column;gap:10px">
        <p class="text-dim text-sm">Loading...</p>
      </div>
    </div>

  </div>
</div>`;
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
export async function initDashboard(teacher) {
  const isAdmin = teacher?.role === 'ADMIN';
  if (isAdmin) {
    await loadAllTeachers();
    document.getElementById('btn-refresh-dash')?.addEventListener('click', loadAllTeachers);
    document.getElementById('dash-date-picker')?.addEventListener('change', loadAllTeachers);
    document.getElementById('search-teachers')?.addEventListener('input', filterTeachers);
  } else {
    await loadTeacherHistory();
    document.getElementById('btn-reload-dash')?.addEventListener('click', loadTeacherHistory);
  }
}

// ─── ADMIN: all teachers ───────────────────────────────────────────────────────
let _allAdminCards = []; // cache for search filter

async function loadAllTeachers() {
  const el  = document.getElementById('all-teachers-today');
  if (!el) return;
  el.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text3)"><div style="font-size:32px">⏳</div><p style="margin-top:8px">Loading…</p></div>`;

  try {
    const dateVal = document.getElementById('dash-date-picker')?.value || new Date().toISOString().slice(0,10);
    const res     = await apiFetch(`/attendance/all?date=${dateVal}`);
    const { logs = [], absent = [], summary = {} } = res.data;

    // Stats
    ['admin-stat-0','admin-stat-1','admin-stat-2'].forEach((id,i) => {
      const e = document.getElementById(id);
      if (e) e.textContent = [summary.total, summary.present, summary.absent][i] ?? 0;
    });
    const pctEl = document.getElementById('admin-stat-3');
    if (pctEl) pctEl.textContent = summary.total > 0 ? Math.round(summary.present / summary.total * 100) + '%' : '0%';

    // Build card data
    const presentCards = logs.map(l => ({ log: l, teacher: l.teacherId, present: true }));
    const absentCards  = absent.map(t => ({ log: null, teacher: t, present: false }));
    _allAdminCards = [...presentCards, ...absentCards];

    renderAdminCards(_allAdminCards);
  } catch(e) {
    if (el) el.innerHTML = `<p style="color:var(--danger);text-align:center;padding:20px">Error: ${e.message}</p>`;
  }
}

function filterTeachers() {
  const q = (document.getElementById('search-teachers')?.value || '').toLowerCase();
  const filtered = q ? _allAdminCards.filter(c => (c.teacher?.fullName || '').toLowerCase().includes(q)) : _allAdminCards;
  renderAdminCards(filtered);
}

function renderAdminCards(cards) {
  const el = document.getElementById('all-teachers-today');
  if (!el) return;
  if (!cards.length) { el.innerHTML = `<p class="text-dim text-sm text-center" style="padding:20px">No results</p>`; return; }

  el.innerHTML = cards.map(({ log, teacher, present }) => {
    const sessions = log?.sessions || [];
    const totalSess = sessions.length;
    const openSess  = sessions.filter(s => !s.cabinOutTime).length;
    const totalMov  = sessions.reduce((a, s) => a + (s.movements||[]).length, 0);
    const accentCol = present ? 'var(--success)' : 'var(--danger)';

    const sessionsHtml = sessions.length
      ? sessions.map((s, si) => {
          const isOpen   = !s.cabinOutTime;
          const dur      = durStr(s.cabinInTime, s.cabinOutTime);
          const gs       = gateState(s);
          return `
          <div style="margin-top:10px;border:1px solid ${isOpen ? 'rgba(0,255,136,0.3)' : 'var(--border)'};
               border-radius:10px;padding:12px;background:${isOpen ? 'rgba(0,255,136,0.04)' : 'var(--surface2)'}">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <span style="font-size:11px;font-weight:700;color:var(--text3);letter-spacing:.06em">SESSION ${si+1}</span>
              ${dur ? `<span style="font-size:11px;color:var(--text2)">⏱ ${dur}</span>` : ''}
              ${isOpen ? `<span class="badge badge-green" style="font-size:10px;padding:2px 8px">● ACTIVE${gs==='OUT' ? ' (outside)' : ''}</span>` : `<span style="font-size:10px;color:var(--text3)">CLOSED</span>`}
            </div>
            ${sessionTimeline(s, true)}
          </div>`;
        }).join('')
      : '';

    return `
    <div class="teacher-log-card" style="border:1px solid ${present ? 'rgba(16,185,129,0.2)' : 'var(--border)'};
         border-radius:14px;overflow:hidden;background:var(--surface);
         transition:all 0.2s" data-name="${(teacher?.fullName||'').toLowerCase()}">

      <!-- Header row -->
      <div class="log-card-head" style="display:flex;align-items:center;gap:14px;padding:14px 18px;
           cursor:pointer" onclick="this.parentElement.querySelector('.log-card-body').style.display=
           this.parentElement.querySelector('.log-card-body').style.display==='none'?'block':'none';
           this.querySelector('.lc-chev').style.transform=
           this.querySelector('.lc-chev').style.transform==='rotate(180deg)'?'rotate(0deg)':'rotate(180deg)'">

        <!-- Avatar -->
        <div class="teacher-avatar" style="width:44px;height:44px;font-size:15px;flex-shrink:0">
          ${getInitials(teacher?.fullName)}
        </div>

        <!-- Info -->
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span style="font-weight:700;font-size:14px">${teacher?.fullName || '—'}</span>
            <span class="badge ${present ? 'badge-green' : 'badge-red'}" style="font-size:11px">
              ${present ? '✅ Present' : '❌ Absent'}
            </span>
            ${openSess > 0 ? `<span class="badge" style="background:rgba(0,255,136,0.12);color:#00ff88;border:1px solid rgba(0,255,136,0.25);font-size:10px;animation:pulse 1.4s infinite">● In Cabin</span>` : ''}
          </div>
          <div style="font-size:12px;color:var(--text2);margin-top:2px">
            ${teacher?.department || ''} &nbsp;·&nbsp; <span style="font-family:monospace">${teacher?.employeeId || ''}</span>
          </div>
          ${present ? `<div style="font-size:11px;color:var(--text3);margin-top:2px">
            ${totalSess} session${totalSess!==1?'s':''} &nbsp;·&nbsp; ${totalMov} gate movement${totalMov!==1?'s':''}
            ${log?.checkInTime ? ` &nbsp;·&nbsp; First in: <strong style="color:${accentCol}">${formatTime(log.checkInTime)}</strong>` : ''}
            ${log?.checkOutTime ? ` &nbsp;·&nbsp; Last out: <strong style="color:#f97316">${formatTime(log.checkOutTime)}</strong>` : ''}
          </div>` : `<div style="font-size:11px;color:var(--text3);margin-top:2px">No attendance recorded today</div>`}
        </div>

        <div class="lc-chev" style="color:var(--text3);font-size:16px;flex-shrink:0;transition:transform 0.25s">▾</div>
      </div>

      <!-- Body (collapsed by default) -->
      <div class="log-card-body" style="display:none;padding:0 18px 16px;border-top:1px solid var(--border)">
        ${present && sessions.length
          ? sessionsHtml
          : `<p style="color:var(--text3);font-size:13px;padding:16px 0;text-align:center">
               ${present ? 'No session data (legacy record)' : 'Teacher did not check in today.'}
             </p>`}
      </div>
    </div>`;
  }).join('');
}

// ─── TEACHER: own history ──────────────────────────────────────────────────────
async function loadTeacherHistory() {
  const el = document.getElementById('recent-activity');
  if (!el) return;
  el.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text3)"><div style="font-size:32px">⏳</div><p style="margin-top:8px">Loading…</p></div>`;

  try {
    const res = await apiFetch('/attendance/history?limit=30');
    const { logs = [], stats = {} } = res.data;

    // Stats
    const pct = stats.total > 0 ? Math.round(stats.present / stats.total * 100) : 0;
    ['stat-0','stat-1','stat-2','stat-3'].forEach((id, i) => {
      const e = document.getElementById(id);
      if (e) e.textContent = [stats.present, stats.absent, stats.total, pct+'%'][i];
    });

    // Today quick-card
    const todayStr = new Date().toISOString().slice(0,10);
    const todayLog = logs.find(l => l.date === todayStr);
    const qc = document.getElementById('today-quick');
    if (qc && todayLog) {
      qc.style.display = 'block';
      const op = (todayLog.sessions||[]).find(s => !s.cabinOutTime);
      qc.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <div style="font-size:32px">${op ? '🏫' : '✅'}</div>
          <div>
            <div style="font-weight:700;font-size:15px">${op ? '● Currently in cabin' : 'All sessions closed today'}</div>
            <div style="font-size:12px;color:var(--text2)">
              First in: <strong style="color:var(--success)">${formatTime(todayLog.checkInTime)}</strong>
              ${todayLog.checkOutTime ? ` &nbsp;·&nbsp; Last out: <strong style="color:#f97316">${formatTime(todayLog.checkOutTime)}</strong>` : ''}
              &nbsp;·&nbsp; ${(todayLog.sessions||[]).length} session${(todayLog.sessions||[]).length!==1?'s':''}
            </div>
          </div>
          <span class="badge badge-green" style="margin-left:auto">Today</span>
        </div>`;
    }

    if (!logs.length) {
      el.innerHTML = `<div style="text-align:center;padding:48px;color:var(--text3)">
        <div style="font-size:48px;margin-bottom:12px">📋</div>
        <p>No records yet.</p></div>`;
      return;
    }

    // One card per day
    el.innerHTML = logs.map((log, idx) => {
      const sessions = log.sessions || [];
      const isPresent = log.status === 'PRESENT';
      const openSess  = sessions.filter(s => !s.cabinOutTime).length;
      const totalMov  = sessions.reduce((a,s) => a + (s.movements||[]).length, 0);
      const isToday   = log.date === todayStr;

      const sessionsHtml = sessions.map((s, si) => {
        const isOpen = !s.cabinOutTime;
        const dur    = durStr(s.cabinInTime, s.cabinOutTime);
        const gs     = gateState(s);
        return `
        <div style="margin-top:10px;border:1.5px solid ${isOpen ? 'rgba(0,255,136,0.35)' : 'var(--border)'};
             border-radius:11px;padding:12px 14px;background:${isOpen ? 'rgba(0,255,136,0.04)' : 'var(--surface2)'}">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
            <span style="font-size:11px;font-weight:700;color:var(--text3);letter-spacing:.06em">SESSION ${si+1} / ${sessions.length}</span>
            ${dur ? `<span style="font-size:11px;color:var(--text2)">⏱ ${dur}</span>` : ''}
            ${isOpen
              ? `<span class="badge badge-green" style="font-size:10px;padding:2px 8px;animation:pulse 1.4s infinite">● ACTIVE${gs==='OUT' ? ' — outside' : ''}</span>`
              : `<span style="font-size:10px;color:var(--text3);background:var(--surface2);padding:2px 8px;border-radius:8px;border:1px solid var(--border)">CLOSED</span>`}
          </div>
          ${sessionTimeline(s, false)}
        </div>`;
      }).join('');

      return `
      <div style="border:1px solid ${isPresent ? 'rgba(16,185,129,0.2)' : 'var(--border)'};
           border-radius:14px;overflow:hidden;background:var(--surface)">

        <!-- Day header — click to expand -->
        <div onclick="var b=this.nextElementSibling,c=this.querySelector('.dc');b.style.display=b.style.display==='block'?'none':'block';c.style.transform=c.style.transform==='rotate(180deg)'?'rotate(0deg)':'rotate(180deg)'"
             style="display:flex;align-items:center;gap:14px;padding:13px 18px;cursor:pointer;user-select:none"
             onmouseenter="this.style.background='var(--surface2)'" onmouseleave="this.style.background=''">

          <!-- Date blob -->
          <div style="min-width:48px;text-align:center;background:${isPresent ? 'rgba(16,185,129,0.12)' : 'var(--surface2)'};
               border-radius:10px;padding:6px 4px;border:1px solid ${isPresent ? 'rgba(16,185,129,0.25)' : 'var(--border)'}">
            <div style="font-size:20px;font-weight:800;color:${isPresent ? 'var(--success)' : 'var(--danger)'};line-height:1">
              ${new Date(log.date).getDate().toString().padStart(2,'0')}
            </div>
            <div style="font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:.04em">
              ${new Date(log.date + 'T00:00:00').toLocaleDateString('en-IN',{month:'short'})}
            </div>
          </div>

          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">
              <span style="font-weight:700;font-size:14px">${formatDate(log.date)}</span>
              <span class="badge ${isPresent ? 'badge-green' : 'badge-red'}" style="font-size:11px">
                ${isPresent ? '✅ Present' : '❌ Absent'}
              </span>
              ${isToday ? `<span class="badge badge-blue" style="font-size:10px">Today</span>` : ''}
              ${openSess > 0 ? `<span class="badge" style="background:rgba(0,255,136,0.12);color:#00ff88;border:1px solid rgba(0,255,136,0.25);font-size:10px;animation:pulse 1.4s infinite">● Active</span>` : ''}
            </div>
            ${isPresent ? `<div style="font-size:11px;color:var(--text2);margin-top:3px">
              ${sessions.length} session${sessions.length!==1?'s':''} &nbsp;·&nbsp; ${totalMov} gate movement${totalMov!==1?'s':''}
              &nbsp;·&nbsp; First in: <strong style="color:var(--success)">${formatTime(log.checkInTime)}</strong>
              ${log.checkOutTime ? ` &nbsp;·&nbsp; Last out: <strong style="color:#f97316">${formatTime(log.checkOutTime)}</strong>` : ''}
            </div>` : `<div style="font-size:11px;color:var(--text3);margin-top:3px">No attendance recorded</div>`}
          </div>

          <div class="dc" style="color:var(--text3);font-size:16px;flex-shrink:0;transition:transform 0.25s${isToday ? ';transform:rotate(180deg)' : ''}">▾</div>
        </div>

        <!-- Body -->
        <div style="display:${isToday ? 'block' : 'none'};padding:0 18px 16px;border-top:1px solid var(--border)">
          ${sessions.length
            ? sessionsHtml
            : `<p style="color:var(--text3);font-size:13px;padding:16px 0;text-align:center">No session data recorded.</p>`}
        </div>
      </div>`;
    }).join('');

  } catch(e) {
    if (el) el.innerHTML = `<p style="color:var(--danger);padding:20px;text-align:center">Error: ${e.message}</p>`;
  }
}
