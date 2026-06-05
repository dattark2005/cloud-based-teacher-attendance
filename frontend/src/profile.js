import { apiFetch, showToast, startCamera, stopCamera, captureFrame, formatTime, formatDate, getInitials } from './utils.js';

let profStream = null;

export function renderProfile(teacher) {
  return `
<div class="page" id="page-profile">
  <div class="main-content">
    <div class="page-header"><h1>My Profile</h1><p class="text-muted">Manage your account and face biometrics</p></div>
    <div class="grid-2" style="gap:24px;align-items:start">
      <!-- Profile Info Column -->
      <div style="display:flex;flex-direction:column;gap:24px;width:100%">
        <!-- Profile Info -->
        <div class="card card-glow">
          <div style="text-align:center;padding:16px 0 24px">
            <div class="teacher-avatar" style="width:80px;height:80px;font-size:28px;margin:0 auto 16px">
              ${teacher.faceImageUrl ? `<img src="${teacher.faceImageUrl}" id="prof-avatar-img" style="width:100%;height:100%;object-fit:cover;border-radius:50%" />` : `<span id="prof-initials">${getInitials(teacher.fullName)}</span>`}
            </div>
            <h2 class="font-bold" style="font-size:20px" id="prof-name">${teacher.fullName}</h2>
            <p class="text-muted text-sm" id="prof-desig">${(teacher.designation || '').toUpperCase()}</p>
            <p class="text-dim text-xs mt-1" id="prof-email">${teacher.email}</p>
          </div>
          <div style="display:grid;gap:12px">
            ${[['🏢','Department',(teacher.department || '').toUpperCase(),'prof-dept'],['🪪','Employee ID',teacher.employeeId,'prof-empid'],['📞','Phone',teacher.phone || '—','prof-phone'],['📅','Member Since',formatDate(teacher.createdAt),'']].map(([icon,label,val,id])=>`
            <div style="display:flex;align-items:center;gap:12px;padding:12px;background:var(--surface2);border-radius:10px;border:1px solid var(--border)">
              <span style="font-size:18px">${icon}</span>
              <div><div class="text-dim" style="font-size:11px">${label}</div><div class="font-semibold text-sm" ${id?`id="${id}"`:''}>${val}</div></div>
            </div>`).join('')}
            <div style="padding:12px;background:var(--surface2);border-radius:10px;border:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:12px">
              <div style="display:flex;align-items:center;gap:12px">
                <span style="font-size:18px">🧠</span>
                <div>
                  <div class="text-dim" style="font-size:11px">Face Biometrics</div>
                  <div id="face-status-badge">${(teacher.faceRegistered || teacher.faceRegisteredAt) ? '<span class="badge badge-green">✅ Registered</span>' : '<span class="badge badge-red">❌ Not Registered</span>'}</div>
                </div>
              </div>
              <button class="btn btn-red btn-xs ${ (teacher.faceRegistered || teacher.faceRegisteredAt) ? '' : 'hidden' }" id="btn-delete-face" style="padding:4px 8px;font-size:11px;background:#ef4444;color:#fff;border-radius:6px;border:none;cursor:pointer">🗑️ Delete</button>
            </div>
            <div style="padding:12px;background:var(--surface2);border-radius:10px;border:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:12px">
              <div style="display:flex;align-items:center;gap:12px">
                <span style="font-size:18px">🎤</span>
                <div>
                  <div class="text-dim" style="font-size:11px">Voice Biometrics</div>
                  <div id="voice-status-badge">${teacher.voiceRegistered ? '<span class="badge badge-green">✅ Registered</span>' : '<span class="badge badge-red">❌ Not Registered</span>'}</div>
                </div>
              </div>
              <button class="btn btn-red btn-xs ${ teacher.voiceRegistered ? '' : 'hidden' }" id="btn-delete-voice" style="padding:4px 8px;font-size:11px;background:#ef4444;color:#fff;border-radius:6px;border:none;cursor:pointer">🗑️ Delete</button>
            </div>
            <button class="btn btn-ghost w-full mt-2" id="btn-edit-profile">✏️ Edit Profile</button>
            <button class="btn btn-ghost w-full mt-1" id="btn-open-pwd-modal">🔐 Change Password</button>
          </div>
        </div>
      </div>

      <!-- Right: Face Registration & Voice Log Column -->
      <div style="display:flex;flex-direction:column;gap:24px;width:100%">
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

        <!-- Biometrics Activity Log -->
        <div class="card">
          <h3 class="font-bold mb-4">🧬 Biometrics Activity Log</h3>
          <div style="max-height: 250px; overflow-y: auto; display: grid; gap: 8px;" id="voice-logs-container">
            <p class="text-dim text-sm text-center py-4">Loading voice logs...</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Attendance History -->
    <div class="card mt-4">
      <div class="flex items-center justify-between mb-4 flex-wrap" style="gap:16px">
        <h3 class="font-bold">📊 My Attendance History</h3>
        
        <!-- Checked-in & Checked-out count badges -->
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
          <div style="background:rgba(16,185,129,0.15);color:#34d399;border:1px solid rgba(16,185,129,0.3);padding:6px 12px;border-radius:8px;font-size:13px;font-weight:600">
            📥 Check-Ins: <span id="hist-checkin-count">—</span>
          </div>
          <div style="background:rgba(0,180,216,0.15);color:#00b4d8;border:1px solid rgba(0,180,216,0.3);padding:6px 12px;border-radius:8px;font-size:13px;font-weight:600">
            📤 Check-Outs: <span id="hist-checkout-count">—</span>
          </div>
        </div>

        <!-- Date Filters -->
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:6px">
            <span class="text-dim" style="font-size:12px">From:</span>
            <input type="date" id="filter-start-date" class="form-input" style="padding:6px 10px;font-size:13px;width:140px;background:var(--surface2);border-color:var(--border)" />
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            <span class="text-dim" style="font-size:12px">To:</span>
            <input type="date" id="filter-end-date" class="form-input" style="padding:6px 10px;font-size:13px;width:140px;background:var(--surface2);border-color:var(--border)" />
          </div>
          <button class="btn btn-ghost btn-sm" id="btn-clear-date-filter" style="padding:6px 12px;font-size:12px">Clear</button>
        </div>
      </div>

      <div style="overflow-x:auto">
        <table class="data-table">
          <thead><tr><th>Date</th><th>Event</th><th>Time</th><th>Method</th><th>Confidence</th></tr></thead>
          <tbody id="history-tbody"><tr><td colspan="5" class="text-center text-dim" style="padding:20px">Loading...</td></tr></tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- Edit Profile Modal -->
  <div id="edit-profile-modal" class="hidden" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;">
    <div class="card" style="width:100%;max-width:480px;position:relative">
      <button class="btn btn-ghost btn-sm" id="close-edit-modal" style="position:absolute;top:10px;right:10px;font-size:20px">×</button>
      <h3 class="font-bold mb-4">✏️ Edit Profile Details</h3>
      <form id="form-edit-profile" style="display:grid;gap:12px">
        <div>
          <label class="text-dim text-xs block mb-1">Full Name</label>
          <input type="text" id="edit-prof-name" class="form-input" required style="width:100%;padding:10px;background:var(--surface2);border-color:var(--border)" />
        </div>
        <div>
          <label class="text-dim text-xs block mb-1">Designation</label>
          <input type="text" id="edit-prof-desig" class="form-input" required placeholder="e.g. ASSISTANT PROFESSOR" style="width:100%;padding:10px;background:var(--surface2);border-color:var(--border);text-transform:uppercase" />
        </div>
        <div>
          <label class="text-dim text-xs block mb-1">Department</label>
          <input type="text" id="edit-prof-dept" class="form-input" required placeholder="e.g. CSE" style="width:100%;padding:10px;background:var(--surface2);border-color:var(--border);text-transform:uppercase" />
        </div>
        <div>
          <label class="text-dim text-xs block mb-1">Phone Number</label>
          <input type="text" id="edit-prof-phone" class="form-input" placeholder="e.g. +91 9876543210" style="width:100%;padding:10px;background:var(--surface2);border-color:var(--border)" />
        </div>
        <button type="submit" class="btn btn-accent w-full mt-2" id="btn-save-profile">Save Changes</button>
      </form>
    </div>
  </div>

  <!-- Change Password Modal -->
  <div id="change-password-modal" class="hidden" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;">
    <div class="card" style="width:100%;max-width:480px;position:relative">
      <button class="btn btn-ghost btn-sm" id="close-pwd-modal" style="position:absolute;top:10px;right:10px;font-size:20px">×</button>
      <h3 class="font-bold mb-4">🔐 Change Password</h3>
      <form id="form-change-password" style="display:grid;gap:12px">
        <div>
          <label class="text-dim text-xs block mb-1">Current Password</label>
          <input type="password" id="change-pwd-current" class="form-input" required placeholder="••••••" style="width:100%;padding:10px;background:var(--surface2);border-color:var(--border)" />
        </div>
        <div>
          <label class="text-dim text-xs block mb-1">New Password</label>
          <input type="password" id="change-pwd-new" class="form-input" required placeholder="••••••" style="width:100%;padding:10px;background:var(--surface2);border-color:var(--border)" />
        </div>
        <div>
          <label class="text-dim text-xs block mb-1">Confirm New Password</label>
          <input type="password" id="change-pwd-confirm" class="form-input" required placeholder="••••••" style="width:100%;padding:10px;background:var(--surface2);border-color:var(--border)" />
        </div>
        <button type="submit" class="btn btn-primary w-full mt-2" id="btn-submit-change-pwd">Update Password</button>
      </form>
    </div>
  </div>

  <!-- Biometric Delete Confirmation Modal -->
  <div id="biometric-delete-confirm-modal" class="hidden" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;">
    <div class="card" style="width:100%;max-width:400px;position:relative;text-align:center;padding:24px">
      <h3 class="font-bold mb-2" style="font-size:18px" id="delete-modal-title">⚠️ Delete Biometrics?</h3>
      <p class="text-muted text-sm mb-6" id="delete-modal-body">Are you sure you want to delete this biometric registration?</p>
      <div style="display:flex;gap:12px;justify-content:center">
        <button class="btn btn-red" id="btn-delete-confirm-yes" style="padding:10px 24px;background:#ef4444;color:white;border:none;border-radius:8px;cursor:pointer">Yes, Delete</button>
        <button class="btn btn-ghost" id="btn-delete-confirm-no" style="padding:10px 24px">Cancel</button>
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
  loadProfileHistory();
  loadVoiceLogs();

  document.getElementById('filter-start-date')?.addEventListener('change', () => loadProfileHistory());
  document.getElementById('filter-end-date')?.addEventListener('change', () => loadProfileHistory());
  document.getElementById('btn-clear-date-filter')?.addEventListener('click', () => {
    const startInput = document.getElementById('filter-start-date');
    const endInput = document.getElementById('filter-end-date');
    if (startInput) startInput.value = '';
    if (endInput) endInput.value = '';
    loadProfileHistory();
  });

  // Edit Profile Handlers
  document.getElementById('btn-edit-profile')?.addEventListener('click', () => {
    const cached = JSON.parse(localStorage.getItem('ta_teacher') || '{}');
    document.getElementById('edit-prof-name').value = cached.fullName || '';
    document.getElementById('edit-prof-desig').value = (cached.designation || '').toUpperCase();
    document.getElementById('edit-prof-dept').value = (cached.department || '').toUpperCase();
    document.getElementById('edit-prof-phone').value = cached.phone || '';
    document.getElementById('edit-profile-modal').classList.remove('hidden');
  });

  document.getElementById('close-edit-modal')?.addEventListener('click', () => {
    document.getElementById('edit-profile-modal').classList.add('hidden');
  });

  document.getElementById('form-edit-profile')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fullName = document.getElementById('edit-prof-name').value;
    const designation = document.getElementById('edit-prof-desig').value.toUpperCase();
    const department = document.getElementById('edit-prof-dept').value;
    const phone = document.getElementById('edit-prof-phone').value;

    const btn = document.getElementById('btn-save-profile');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
      const res = await apiFetch('/teachers/profile', {
        method: 'PUT',
        body: JSON.stringify({ fullName, designation, department, phone }),
      });

      const cached = JSON.parse(localStorage.getItem('ta_teacher') || '{}');
      cached.fullName = res.data?.teacher?.fullName || fullName;
      cached.designation = res.data?.teacher?.designation || designation;
      cached.department = res.data?.teacher?.department || department;
      cached.phone = res.data?.teacher?.phone || phone;
      localStorage.setItem('ta_teacher', JSON.stringify(cached));

      showToast('Success', 'Profile updated successfully!', 'success');
      document.getElementById('edit-profile-modal').classList.add('hidden');
      setTimeout(() => location.reload(), 800);
    } catch (err) {
      showToast('Error', err.message || 'Failed to update profile', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save Changes';
    }
  });

  // Change Password Handlers
  document.getElementById('btn-open-pwd-modal')?.addEventListener('click', () => {
    document.getElementById('change-password-modal').classList.remove('hidden');
  });

  document.getElementById('close-pwd-modal')?.addEventListener('click', () => {
    document.getElementById('change-password-modal').classList.add('hidden');
  });

  document.getElementById('form-change-password')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const currentPassword = document.getElementById('change-pwd-current').value;
    const newPassword = document.getElementById('change-pwd-new').value;
    const confirmPassword = document.getElementById('change-pwd-confirm').value;

    if (newPassword !== confirmPassword) {
      showToast('Error', 'New passwords do not match', 'error');
      return;
    }

    const btn = document.getElementById('btn-submit-change-pwd');
    btn.disabled = true;
    btn.textContent = 'Updating...';

    try {
      await apiFetch('/teachers/change-password', {
        method: 'PUT',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      showToast('Success', 'Password updated successfully!', 'success');
      document.getElementById('form-change-password').reset();
      document.getElementById('change-password-modal').classList.add('hidden');
    } catch (err) {
      showToast('Error', err.message || 'Failed to update password', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Update Password';
    }
  });

  // Delete Face Handler
  document.getElementById('btn-delete-face')?.addEventListener('click', async () => {
    const confirmed = await askBiometricDeleteConfirmation('FACE');
    if (!confirmed) return;

    try {
      await apiFetch('/teachers/face', { method: 'DELETE' });
      showToast('Deleted', 'Face registration deleted successfully', 'success');
      
      document.getElementById('face-status-badge').innerHTML = '<span class="badge badge-red">❌ Not Registered</span>';
      document.getElementById('btn-delete-face').classList.add('hidden');
      
      const cached = JSON.parse(localStorage.getItem('ta_teacher') || '{}');
      cached.faceRegistered = false;
      cached.faceRegisteredAt = null;
      cached.faceImageUrl = null;
      localStorage.setItem('ta_teacher', JSON.stringify(cached));

      loadVoiceLogs();
    } catch (err) {
      showToast('Error', err.message || 'Failed to delete face registration', 'error');
    }
  });

  // Delete Voice Handler
  document.getElementById('btn-delete-voice')?.addEventListener('click', async () => {
    const confirmed = await askBiometricDeleteConfirmation('VOICE');
    if (!confirmed) return;

    try {
      await apiFetch('/teachers/voice', { method: 'DELETE' });
      showToast('Deleted', 'Voice registration deleted successfully', 'success');
      
      document.getElementById('voice-status-badge').innerHTML = '<span class="badge badge-red">❌ Not Registered</span>';
      document.getElementById('btn-delete-voice').classList.add('hidden');
      
      const cached = JSON.parse(localStorage.getItem('ta_teacher') || '{}');
      cached.voiceRegistered = false;
      localStorage.setItem('ta_teacher', JSON.stringify(cached));

      loadVoiceLogs();
    } catch (err) {
      showToast('Error', err.message || 'Failed to delete voice registration', 'error');
    }
  });
}

export async function loadVoiceLogs() {
  const container = document.getElementById('voice-logs-container');
  if (!container) return;

  // Also update Voice Biometrics Status Badge in real time!
  const voiceBadge = document.getElementById('voice-status-badge');
  if (voiceBadge) {
    apiFetch('/teachers/profile')
      .then(res => {
        const teacher = res.data?.teacher;
        if (teacher) {
          const btnDelVoice = document.getElementById('btn-delete-voice');
          if (teacher.voiceRegistered) {
            voiceBadge.innerHTML = '<span class="badge badge-green">✅ Registered</span>';
            if (btnDelVoice) btnDelVoice.classList.remove('hidden');
          } else {
            voiceBadge.innerHTML = '<span class="badge badge-red">❌ Not Registered</span>';
            if (btnDelVoice) btnDelVoice.classList.add('hidden');
          }
          const btnDelFace = document.getElementById('btn-delete-face');
          const faceBadge = document.getElementById('face-status-badge');
          if (teacher.faceRegistered) {
            if (faceBadge) faceBadge.innerHTML = '<span class="badge badge-green">✅ Registered</span>';
            if (btnDelFace) btnDelFace.classList.remove('hidden');
          } else {
            if (faceBadge) faceBadge.innerHTML = '<span class="badge badge-red">❌ Not Registered</span>';
            if (btnDelFace) btnDelFace.classList.add('hidden');
          }
          const current = JSON.parse(localStorage.getItem('ta_teacher') || '{}');
          current.voiceRegistered = teacher.voiceRegistered;
          current.faceRegistered = teacher.faceRegistered;
          localStorage.setItem('ta_teacher', JSON.stringify(current));
        }
      })
      .catch(err => {
        console.error('Error fetching teacher profile for status:', err);
      });
  }

  try {
    const res = await apiFetch('/teachers/biometric-logs');
    const logs = res.data || [];

    if (!logs.length) {
      container.innerHTML = '<p class="text-dim text-sm text-center py-4">No biometric activity recorded yet</p>';
      return;
    }

    container.innerHTML = logs.map(l => {
      const isRegister = l.action === 'REGISTER';
      const isDelete = l.action === 'DELETE';
      const badgeClass = isRegister ? 'badge-green' : (isDelete ? 'badge-red' : 'badge-blue');
      const actionText = l.action;
      const typeText = l.biometricType === 'FACE' ? '📷 FACE' : '🎤 VOICE';

      return `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
          <div>
            <div style="display:flex;align-items:center;gap:6px">
              <span class="badge ${badgeClass}" style="font-size:10px;padding:2px 6px">${actionText}</span>
              <span class="text-semibold text-xs" style="color:var(--text-dim)">${typeText}</span>
            </div>
            <div class="text-dim mt-1" style="font-size:11px">${l.details || ''}</div>
          </div>
          <div class="text-right">
            <span class="text-dim" style="font-size:11px">${formatDate(l.timestamp)} ${formatTime(l.timestamp)}</span>
          </div>
        </div>`;
    }).join('');
  } catch (err) {
    container.innerHTML = '<p class="text-center py-4 text-sm" style="color:var(--error)">Failed to load logs</p>';
  }
}

export async function loadProfileHistory() {
  const tbody = document.getElementById('history-tbody');
  if (!tbody) return;

  const startInput = document.getElementById('filter-start-date');
  const endInput = document.getElementById('filter-end-date');
  const startDate = startInput ? startInput.value : '';
  const endDate = endInput ? endInput.value : '';

  let url = '/attendance/history?limit=100';
  if (startDate) url += `&startDate=${startDate}`;
  if (endDate) url += `&endDate=${endDate}`;

  try {
    const res = await apiFetch(url);
    const rows = res.data.logs;
    const stats = res.data.stats || {};

    // Update count badges
    const inCountEl = document.getElementById('hist-checkin-count');
    const outCountEl = document.getElementById('hist-checkout-count');
    if (inCountEl) inCountEl.textContent = stats.checkInCount !== undefined ? stats.checkInCount : '0';
    if (outCountEl) outCountEl.textContent = stats.checkOutCount !== undefined ? stats.checkOutCount : '0';

    if (!rows || !rows.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-dim" style="padding:20px">No records yet</td></tr>';
      return;
    }

    const allMovements = [];
    rows.forEach(l => {
      if (l.logs && l.logs.length > 0) {
        l.logs.forEach(e => {
          allMovements.push({
            date: l.date,
            event: e.event,
            timestamp: e.timestamp,
            method: e.method,
            confidence: e.confidence,
          });
        });
      } else {
        if (l.checkOutTime) {
          allMovements.push({
            date: l.date,
            event: 'CHECK_OUT',
            timestamp: l.checkOutTime,
            method: l.verificationMethod,
            confidence: l.confidenceScore,
          });
        }
        if (l.checkInTime) {
          allMovements.push({
            date: l.date,
            event: 'CHECK_IN',
            timestamp: l.checkInTime,
            method: l.verificationMethod,
            confidence: l.confidenceScore,
          });
        }
      }
    });

    allMovements.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    if (!allMovements.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-dim" style="padding:20px">No records yet</td></tr>';
      return;
    }

    tbody.innerHTML = allMovements.map(m => {
      const isCheckIn = m.event === 'CHECK_IN';
      const badgeClass = isCheckIn ? 'badge-green' : 'badge-blue';
      const eventText = isCheckIn ? '📥 Check-In' : '📤 Check-Out';
      const methodLabel = m.method === 'VOICE' ? '🎤 Voice' : (m.method === 'MANUAL' ? '✍️ Manual' : '📷 Face');
      const confidenceLabel = m.confidence ? Math.round(m.confidence * 100) + '%' : '—';

      return `
        <tr>
          <td class="font-semibold">${formatDate(m.date)}</td>
          <td><span class="badge ${badgeClass}">${eventText}</span></td>
          <td class="font-medium">${formatTime(m.timestamp)}</td>
          <td class="text-dim text-sm">${methodLabel}</td>
          <td>${confidenceLabel}</td>
        </tr>`;
    }).join('');
  } catch(e) {
    console.error(e);
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-dim" style="padding:20px;color:var(--error)">Error loading history</td></tr>';
  }
}

function askBiometricDeleteConfirmation(type) {
  return new Promise((resolve) => {
    const modal = document.getElementById('biometric-delete-confirm-modal');
    if (!modal) {
      resolve(false);
      return;
    }
    const titleEl = document.getElementById('delete-modal-title');
    const bodyEl = document.getElementById('delete-modal-body');
    if (titleEl && bodyEl) {
      if (type === 'FACE') {
        titleEl.textContent = '🗑️ Delete Face Registration?';
        bodyEl.textContent = 'Are you sure you want to delete your face biometrics? You won\'t be able to use automatic camera check-in until you register again.';
      } else {
        titleEl.textContent = '🗑️ Delete Voice Profile?';
        bodyEl.textContent = 'Are you sure you want to delete your voice biometrics? You won\'t be able to use voice check-in until you register again.';
      }
    }

    modal.classList.remove('hidden');

    const btnYes = document.getElementById('btn-delete-confirm-yes');
    const btnNo = document.getElementById('btn-delete-confirm-no');

    const handleYes = () => {
      cleanup();
      resolve(true);
    };

    const handleNo = () => {
      cleanup();
      resolve(false);
    };

    const cleanup = () => {
      modal.classList.add('hidden');
      if (btnYes) btnYes.removeEventListener('click', handleYes);
      if (btnNo) btnNo.removeEventListener('click', handleNo);
    };

    if (btnYes) btnYes.addEventListener('click', handleYes);
    if (btnNo) btnNo.addEventListener('click', handleNo);
  });
}
