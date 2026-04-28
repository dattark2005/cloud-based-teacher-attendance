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
        <div class="grid-2" style="gap:14px">
          <div class="form-group">
            <label class="form-label">Full Name</label>
            <input type="text" id="reg-name" class="form-input" placeholder="Dr. John Doe" required />
          </div>
          <div class="form-group">
            <label class="form-label">Employee ID</label>
            <input type="text" id="reg-empid" class="form-input" placeholder="EMP001" required />
          </div>
          <div class="form-group">
            <label class="form-label">Email</label>
            <input type="email" id="reg-email" class="form-input" placeholder="teacher@college.edu" required />
          </div>
          <div class="form-group">
            <label class="form-label">Department</label>
            <input type="text" id="reg-dept" class="form-input" placeholder="Computer Science" required />
          </div>
          <div class="form-group" style="grid-column:1/-1">
            <label class="form-label">Designation</label>
            <select id="reg-desig" class="form-input form-select">
              <option>Assistant Professor</option>
              <option>Associate Professor</option>
              <option>Professor</option>
              <option>HOD</option>
              <option>Lab Instructor</option>
            </select>
          </div>
          <div class="form-group" style="grid-column:1/-1">
            <label class="form-label">Password</label>
            <input type="password" id="reg-password" class="form-input" placeholder="Min 6 characters" required minlength="6" />
          </div>
        </div>
        <button type="submit" class="btn btn-primary btn-lg w-full" id="register-btn">
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
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Creating account...';
    try {
      const data = await apiFetch('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          fullName: document.getElementById('reg-name').value,
          employeeId: document.getElementById('reg-empid').value.toUpperCase(),
          email: document.getElementById('reg-email').value,
          department: document.getElementById('reg-dept').value,
          designation: document.getElementById('reg-desig').value,
          password: document.getElementById('reg-password').value,
        }),
      });
      setAuth(data.data.token, data.data.teacher);
      showToast('Account created!', 'Please register your face to enable attendance.', 'success');
      onSuccess(data.data.teacher);
    } catch (err) {
      showToast('Registration failed', err.message, 'error');
      btn.disabled = false;
      btn.innerHTML = '<span>Create Account</span>';
    }
  });
}
