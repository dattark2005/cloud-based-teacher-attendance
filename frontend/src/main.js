import '/src/style.css';
import { isLoggedIn, getTeacher, clearAuth, navigate, showToast } from './utils.js';
import { renderAuthPage, initAuth } from './auth.js';
import { renderDashboard, initDashboard } from './dashboard.js';
import { renderScanner, initScanner } from './scanner.js';
import { renderProfile, initProfile } from './profile.js';

const app = document.getElementById('app');

function renderApp(teacher) {
  app.innerHTML = `
  <!-- Toast container -->
  <div id="toast-container"></div>

  <!-- Background orbs -->
  <div class="bg-orbs">
    <div class="orb orb-1"></div>
    <div class="orb orb-2"></div>
    <div class="orb orb-3"></div>
  </div>

  <!-- Sidebar -->
  <nav class="sidebar">
    <div class="sidebar-logo">
      <div class="sidebar-logo-icon">🎓</div>
      <div>
        <div class="sidebar-logo-text grad-text">EduTrack</div>
        <div class="text-dim" style="font-size:11px">Teacher Attendance</div>
      </div>
    </div>
    <div class="sidebar-nav">
      <div class="nav-section-label">Navigation</div>
      <div class="nav-item active" data-page="dashboard">
        <span class="nav-icon">🏠</span> Dashboard
      </div>
      <div class="nav-item" data-page="scanner">
        <span class="nav-icon">📸</span> Camera Scanner
      </div>
      <div class="nav-item" data-page="profile">
        <span class="nav-icon">👤</span> My Profile
      </div>
    </div>
    <div class="sidebar-footer">
      <div class="card" style="padding:16px;margin-bottom:12px">
        <div class="flex items-center gap-3">
          <div class="teacher-avatar" style="width:36px;height:36px;font-size:13px">
            ${teacher.fullName.split(' ').map(n=>n[0]).join('').slice(0,2)}
          </div>
          <div style="flex:1;min-width:0">
            <div class="font-semibold text-sm" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${teacher.fullName}</div>
            <div class="text-dim" style="font-size:11px">${teacher.department}</div>
          </div>
        </div>
      </div>
      <div class="nav-item" id="btn-logout">
        <span class="nav-icon">🚪</span> Logout
      </div>
    </div>
  </nav>

  <!-- Pages -->
  ${renderDashboard(teacher)}
  ${renderScanner()}
  ${renderProfile(teacher)}
  `;

  // Sidebar navigation
  document.querySelectorAll('.nav-item[data-page]').forEach(item => {
    item.addEventListener('click', () => navigate(item.dataset.page));
  });

  // Logout
  document.getElementById('btn-logout').addEventListener('click', () => {
    clearAuth();
    showToast('Logged out', 'See you soon!', 'info');
    setTimeout(() => renderAuth(), 500);
  });

  // Init pages
  navigate('dashboard');
  initDashboard();
  initScanner();
  initProfile();
}

function renderAuth() {
  app.innerHTML = `<div id="toast-container"></div>` + renderAuthPage();
  initAuth((teacher) => renderApp(teacher));
}

// Boot
if (isLoggedIn()) {
  const teacher = getTeacher();
  if (teacher) renderApp(teacher);
  else renderAuth();
} else {
  renderAuth();
}
