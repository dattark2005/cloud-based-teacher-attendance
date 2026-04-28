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
          ${[['🏢','Department',teacher.department,'prof-dept'],['🪪','Employee ID',teacher.employeeId,'prof-empid'],['📅','Member Since',formatDate(teacher.createdAt),'']].map(([icon,label,val,id])=>`
          <div style="display:flex;align-items:center;gap:12px;padding:12px;background:var(--surface2);border-radius:10px;border:1px solid var(--border)">
            <span style="font-size:18px">${icon}</span>
            <div><div class="text-dim" style="font-size:11px">${label}</div><div class="font-semibold text-sm" ${id?`id="${id}"`:''}>${val}</div></div>
          </div>`).join('')}
          <div style="padding:12px;background:var(--surface2);border-radius:10px;border:1px solid var(--border);display:flex;align-items:center;gap:12px">
            <span style="font-size:18px">🧠</span>
            <div><div class="text-dim" style="font-size:11px">Face Biometrics</div>
            <div id="face-status-badge">${(teacher.faceRegistered || teacher.faceRegisteredAt) ? '<span class="badge badge-green">✅ Registered</span>' : '<span class="badge badge-red">❌ Not Registered</span>'}</div></div>
          </div>
        </div>
      </div>

      <!-- Face Registration -->
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
          <button class="btn btn-accent w-full" id="btn-capture-face" disabled>📸 Capture & Register</button>
          <button class="btn btn-ghost btn-sm" id="btn-stop-prof-cam">⏹</button>
        </div>
        <div id="face-reg-result" class="mt-3 hidden"></div>
      </div>
    </div>

    <!-- Attendance History -->
    <div class="card mt-4">
      <h3 class="font-bold mb-4">📊 My Attendance History</h3>
      <div style="overflow-x:auto">
        <table class="data-table">
          <thead><tr><th>Date</th><th>Status</th><th>Check In</th><th>Check Out</th><th>Method</th><th>Confidence</th></tr></thead>
          <tbody id="history-tbody"><tr><td colspan="6" class="text-center text-dim" style="padding:20px">Loading...</td></tr></tbody>
        </table>
      </div>
    </div>
  </div>
</div>`;
}

export async function initProfile() {
  const video = document.getElementById('prof-video');

  document.getElementById('btn-prof-start-cam').addEventListener('click', async () => {
    try {
      profStream = await startCamera(video);
      document.getElementById('prof-cam-overlay').style.display = 'none';
      document.getElementById('prof-scan-frame').style.display = 'block';
      document.getElementById('btn-capture-face').disabled = false;
    } catch { showToast('Camera Error', 'Cannot access camera', 'error'); }
  });

  document.getElementById('btn-stop-prof-cam').addEventListener('click', () => {
    stopCamera(profStream); profStream = null;
    document.getElementById('prof-cam-overlay').style.display = 'flex';
    document.getElementById('prof-scan-frame').style.display = 'none';
    document.getElementById('btn-capture-face').disabled = true;
  });

  document.getElementById('btn-capture-face').addEventListener('click', async () => {
    const canvas = document.createElement('canvas');
    const frame = captureFrame(video, canvas);
    const btn = document.getElementById('btn-capture-face');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Registering...';
    try {
      const res = await apiFetch('/teachers/register-face', { method: 'POST', body: JSON.stringify({ faceImage: frame }) });
      document.getElementById('face-reg-result').className = 'mt-3';
      document.getElementById('face-reg-result').innerHTML = '<div class="badge badge-green" style="padding:10px 16px;font-size:13px">✅ Face registered successfully!</div>';
      document.getElementById('face-status-badge').innerHTML = '<span class="badge badge-green">✅ Registered</span>';
      // Update localStorage so profile persists faceRegistered state
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
    btn.disabled = false; btn.innerHTML = '📸 Capture & Register';
  });

  // Load history
  try {
    const res = await apiFetch('/attendance/history?limit=30');
    const tbody = document.getElementById('history-tbody');
    const rows = res.data.logs;
    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="6" class="text-center text-dim" style="padding:20px">No records yet</td></tr>'; return; }
    tbody.innerHTML = rows.map(l => `
      <tr>
        <td class="font-semibold">${formatDate(l.date)}</td>
        <td><span class="badge ${l.status==='PRESENT'?'badge-green':l.status==='LATE'?'badge-yellow':'badge-red'}">${l.status}</span></td>
        <td>${formatTime(l.checkInTime)}</td>
        <td>${formatTime(l.checkOutTime)}</td>
        <td class="text-dim text-sm">${l.verificationMethod}</td>
        <td>${l.confidenceScore ? Math.round(l.confidenceScore*100)+'%' : '—'}</td>
      </tr>`).join('');
  } catch(e) { console.error(e); }
}
