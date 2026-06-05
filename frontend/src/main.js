import '/src/style.css';
import { io } from 'socket.io-client';
import { isLoggedIn, getTeacher, clearAuth, navigate, showToast } from './utils.js';
import { renderAuthPage, initAuth } from './auth.js';
import { renderDashboard, initDashboard, refreshDashboard } from './dashboard.js';
import { renderScanner, initScanner } from './scanner.js';
import { renderProfile, initProfile } from './profile.js';
import { renderVoice, initVoice } from './voice.js';

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
      <div class="nav-item" data-page="voice">
        <span class="nav-icon">🎤</span> Voice Attendance
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
  ${renderVoice()}
  ${renderProfile(teacher)}
  `;

  // Sidebar navigation
  document.querySelectorAll('.nav-item[data-page]').forEach(item => {
    item.addEventListener('click', () => {
      const page = item.dataset.page;
      navigate(page);
      if (page === 'profile') {
        import('./profile.js').then(m => {
          m.loadProfileHistory();
          m.loadVoiceLogs();
        });
      } else if (page === 'dashboard') {
        refreshDashboard();
      } else if (page === 'scanner') {
        import('./scanner.js').then(m => m.loadTodayLog());
      } else if (page === 'voice') {
        import('./voice.js').then(m => m.loadVoiceLog());
      }
    });
  });

  // Logout
  document.getElementById('btn-logout').addEventListener('click', () => {
    if (socket) {
      try { socket.disconnect(); } catch (_) {}
      socket = null;
    }
    clearAuth();
    showToast('Logged out', 'See you soon!', 'info');
    setTimeout(() => renderAuth(), 500);
  });

  // Init pages
  navigate('dashboard');
  initDashboard();
  initScanner();
  initVoice();
  initProfile();
}

let socket = null;

function connectSocket() {
  if (socket) {
    try { socket.disconnect(); } catch (_) {}
  }
  const socketUrl = import.meta.env.VITE_BACKEND_URL 
    ? import.meta.env.VITE_BACKEND_URL.replace(/\/api$/, '') 
    : window.location.origin;
  socket = io(socketUrl);

  socket.on('connect', () => console.log('🔌 Connected to Socket.io'));
  socket.on('attendance:checkin', (data) => handleSocketEvent(data));
  socket.on('attendance:checkout', (data) => handleSocketEvent(data));
  socket.on('disconnect', () => console.log('❌ Disconnected from Socket.io'));
}

function handleSocketEvent(data) {
  const teacher = getTeacher();
  if (!teacher) return;

  const isCurrentTeacher = teacher._id === data.teacherId || teacher.id === data.teacherId;

  if (teacher.role === 'admin' || isCurrentTeacher) {
    refreshDashboard();
  }

  const page = window.__currentPage;
  if (page === 'scanner') {
    import('./scanner.js').then(m => {
      if (m.loadTodayLog) m.loadTodayLog();
      if (teacher.role !== 'admin' && isCurrentTeacher) {
        if (m.refreshFacultyGateStatus) m.refreshFacultyGateStatus();
      }
    });
  } else if (page === 'voice') {
    import('./voice.js').then(m => {
      if (m.loadVoiceLog) m.loadVoiceLog();
    });
  } else if (page === 'profile') {
    import('./profile.js').then(m => {
      if (m.loadProfileHistory) m.loadProfileHistory();
    });
  }

  // Real-time refresh for admin details modal
  if (teacher.role === 'admin' && window.__activeModalTeacherId === data.teacherId) {
    import('./dashboard.js').then(m => {
      if (m.refreshAdminModal) m.refreshAdminModal();
    });
  }
}

function renderAuth() {
  app.innerHTML = `<div id="toast-container"></div>` + renderAuthPage();
  initAuth((teacher) => {
    renderApp(teacher);
    connectSocket();
  });
}

// Boot
if (isLoggedIn()) {
  const teacher = getTeacher();
  if (teacher) {
    renderApp(teacher);
    connectSocket();
  } else {
    renderAuth();
  }
} else {
  renderAuth();
}
