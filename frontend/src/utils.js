// ── API Client ── Use relative path so Vite proxy works correctly
const API = '/api';

export async function apiFetch(endpoint, options = {}) {
  const token = localStorage.getItem('ta_token');
  const res = await fetch(`${API}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Request failed');
  return data;
}

// ── Auth helpers ──
export const getToken = () => localStorage.getItem('ta_token');
export const getTeacher = () => { try { return JSON.parse(localStorage.getItem('ta_teacher')); } catch { return null; } };
export const setAuth = (token, teacher) => {
  localStorage.setItem('ta_token', token);
  localStorage.setItem('ta_teacher', JSON.stringify(teacher));
};
export const clearAuth = () => { localStorage.removeItem('ta_token'); localStorage.removeItem('ta_teacher'); };
export const isLoggedIn = () => !!getToken();

// ── Toast system ──
export function showToast(title, message = '', type = 'success') {
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <div><div class="toast-title">${title}</div>${message ? `<div class="toast-body">${message}</div>` : ''}</div>
    <span class="toast-close" onclick="this.parentElement.remove()">×</span>`;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ── Format helpers ──
export function formatTime(date) {
  if (!date) return '—';
  return new Date(date).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}
export function formatDate(date) {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
export function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}

// ── Camera utils ──
export async function startCamera(videoEl) {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' } });
  videoEl.srcObject = stream;
  await videoEl.play();
  return stream;
}
export function stopCamera(stream) {
  if (stream) stream.getTracks().forEach(t => t.stop());
}
export function captureFrame(videoEl, canvasEl) {
  if (!videoEl.videoWidth || !videoEl.videoHeight) return null;
  const ctx = canvasEl.getContext('2d');
  canvasEl.width  = videoEl.videoWidth;
  canvasEl.height = videoEl.videoHeight;
  ctx.drawImage(videoEl, 0, 0);
  return canvasEl.toDataURL('image/jpeg', 0.85);
}


// ── Navigate ──
export function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const el = document.getElementById(`page-${page}`);
  if (el) el.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.toggle('active', n.dataset.page === page);
  });
  window.__currentPage = page;
}
