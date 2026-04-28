import { apiFetch, setAuth, showToast } from './utils.js';

export function renderAuthPage() {
  return `
<div class="bg-orbs">
  <div class="orb orb-1"></div>
  <div class="orb orb-2"></div>
  <div class="orb orb-3"></div>
</div>
<div class="auth-page" id="page-auth">
  <div class="auth-card">
    <div class="auth-logo">
      <div class="auth-logo-icon">🎓</div>
      <h1 class="auth-title">EduTrack</h1>
      <p class="auth-subtitle">Teacher Attendance System</p>
    </div>

    <!-- LOGIN FORM -->
    <div id="login-form">
      <form class="auth-form" id="login-form-el">
        <div class="form-group">
          <label class="form-label">Email Address</label>
          <input type="email" id="login-email" class="form-input" placeholder="teacher@college.edu" required />
        </div>
        <div class="form-group">
          <label class="form-label">Password</label>
          <input type="password" id="login-password" class="form-input" placeholder="••••••••" required />
        </div>
        <button type="submit" class="btn btn-primary btn-lg w-full" id="login-btn">
          <span>Sign In</span>
        </button>
      </form>
      <div class="auth-switch">
        Don't have an account? <a href="#" id="go-register">Register here</a>
      </div>
    </div>

    <!-- REGISTER FORM -->
    <div id="register-form" class="hidden">
      <form class="auth-form" id="register-form-el">
        <div class="form-group">
          <label class="form-label">Full Name</label>
          <input type="text" id="reg-name" class="form-input" placeholder="John Doe" required />
        </div>
        <div class="form-group">
          <label class="form-label">Role</label>
          <select id="reg-role" class="form-input form-select">
            <option value="TEACHER">Teacher</option>
            <option value="ADMIN">Admin</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Email</label>
          <input type="email" id="reg-email" class="form-input" placeholder="user@college.edu" required />
        </div>
        <div class="form-group">
          <label class="form-label">Password</label>
          <input type="password" id="reg-password" class="form-input" placeholder="Min 6 characters" required minlength="6" />
        </div>
        <button type="submit" class="btn btn-primary btn-lg w-full" id="register-btn" style="margin-top:10px">
          <span>Create Account</span>
        </button>
      </form>
      <div class="auth-switch">
        Already registered? <a href="#" id="go-login">Sign in</a>
      </div>
    </div>
  </div>
</div>`;
}

export function initAuth(onSuccess) {
  document.getElementById('go-register').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('login-form').classList.add('hidden');
    document.getElementById('register-form').classList.remove('hidden');
  });
  document.getElementById('go-login').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('register-form').classList.add('hidden');
    document.getElementById('login-form').classList.remove('hidden');
  });

  // Login
  document.getElementById('login-form-el').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('login-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Signing in...';
    try {
      const data = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: document.getElementById('login-email').value,
          password: document.getElementById('login-password').value,
        }),
      });
      setAuth(data.data.token, data.data.teacher);
      showToast('Welcome back!', `Hello, ${data.data.teacher.fullName}`, 'success');
      onSuccess(data.data.teacher);
    } catch (err) {
      showToast('Login failed', err.message, 'error');
      btn.disabled = false;
      btn.innerHTML = '<span>Sign In</span>';
    }
  });

  // Register
  document.getElementById('register-form-el').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('register-btn');
    btn.disabled = true; btn.innerHTML = '<div class="spinner"></div>';
    try {
      const payload = {
        fullName: document.getElementById('reg-name').value,
        role: document.getElementById('reg-role').value,
        email: document.getElementById('reg-email').value,
        password: document.getElementById('reg-password').value,
      };
      const res = await apiFetch('/auth/register', { method: 'POST', body: JSON.stringify(payload) });
      setAuth(res.data.token, res.data.teacher);
      showToast('Welcome!', 'Registration successful', 'success');
      onSuccess(res.data.teacher);
    } catch (err) {
      showToast('Error', err.message || 'Registration failed', 'error');
    } finally {
      btn.disabled = false; btn.innerHTML = '<span>Create Account</span>';
    }
  });
}
