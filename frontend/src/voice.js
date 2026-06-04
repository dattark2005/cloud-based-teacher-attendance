import { apiFetch, getTeacher, showToast } from './utils.js';
import { refreshDashboard } from './dashboard.js';

// ── State ──────────────────────────────────────────────────────────────────
let audioContext   = null;   // Web Audio context for PCM capture
let audioStream    = null;   // MediaStream from getUserMedia
let scriptProc     = null;   // ScriptProcessorNode
let pcmChunks      = [];     // captured Float32Array chunks
let isRecording    = false;
let recordTimer    = null;
let recordSecs     = 0;
let mode           = 'verify';   // 'register' | 'verify'
let challengeToken = null;       // anti-deepfake: server-issued challenge

const VOICE_API = 'http://localhost:8001';

// ── Random sentences for guided recording ──────────────────────────────────
const RANDOM_SENTENCES = [
  "My name is on the attendance list.",
  "Good morning everyone.",
  "I am present today.",
  "Today is a good day.",
  "I am a teacher.",
  "Hello, I am here.",
  "My attendance is marked.",
  "I am ready for class.",
  "This is my voice.",
  "I am logging in now.",
  "Good day to all.",
  "I am checking in.",
  "My voice is my password.",
  "I am in the classroom.",
  "Let us begin the class.",
];

function getRandomSentence() {
  return RANDOM_SENTENCES[Math.floor(Math.random() * RANDOM_SENTENCES.length)];
}

// ── WAV Encoder ─────────────────────────────────────────────────────────────
// Converts any browser-recorded Blob (WebM/Opus/OGG) → WAV PCM16 Blob
// so that Python soundfile/scipy can decode it without ffmpeg.

function encodeWAV(samples, sampleRate) {
  const buf    = new ArrayBuffer(44 + samples.length * 2);
  const view   = new DataView(buf);
  const write  = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  write(0,  'RIFF');
  view.setUint32(4,  36 + samples.length * 2, true);
  write(8,  'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16,         true);   // chunk size
  view.setUint16(20, 1,          true);   // PCM
  view.setUint16(22, 1,          true);   // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2,          true);   // block align
  view.setUint16(34, 16,         true);   // bits per sample
  write(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

// ── HTML ───────────────────────────────────────────────────────────────────
export function renderVoice() {
  return `
<div class="page" id="page-voice">
  <div class="main-content">

    <div class="page-header flex items-center justify-between">
      <div>
        <h1>🎤 Voice Attendance</h1>
        <p class="text-muted">Register your voice — mark attendance by speaking any sentence</p>
      </div>
      <div id="voice-clock" class="badge badge-blue" style="font-size:14px;padding:8px 16px"></div>
    </div>

    <!-- Mode toggle -->
    <div class="gate-toggle-bar mb-4">
      <div class="gate-toggle-label">Mode:</div>
      <div class="gate-toggle-group">
        <button class="gate-btn" id="btn-mode-verify" data-mode="verify">
          ✅ Mark Attendance
        </button>
        <button class="gate-btn" id="btn-mode-register" data-mode="register">
          🎙️ Register Voice
        </button>
      </div>
    </div>

    <div class="grid-2" style="gap:24px">

      <!-- Left: Recorder -->
      <div class="card card-glow" style="display:flex;flex-direction:column;align-items:center;gap:24px;padding:40px 32px">

        <!-- Voice visualizer ring -->
        <div id="voice-ring" class="voice-ring idle">
          <div class="voice-ring-inner">
            <span id="ring-icon" style="font-size:40px">🎤</span>
          </div>
          <!-- Animated ripple rings shown during recording -->
          <div class="voice-ripple r1"></div>
          <div class="voice-ripple r2"></div>
          <div class="voice-ripple r3"></div>
        </div>

        <!-- Mode label -->
        <div id="voice-mode-label" style="text-align:center">
          <div class="font-bold" style="font-size:18px" id="voice-title">Verify Voice</div>
          <div class="text-muted text-sm mt-1" id="voice-subtitle">Speak any sentence to mark your attendance</div>
        </div>

        <!-- Random sentence prompt -->
        <div id="voice-sentence-card" style="
          background: rgba(99,102,241,0.12);
          border: 1px solid rgba(99,102,241,0.35);
          border-radius: 12px;
          padding: 14px 18px;
          width: 100%;
          text-align: center;
          position: relative;
        ">
          <div style="font-size:11px;font-weight:700;letter-spacing:1px;color:#a5b4fc;margin-bottom:6px;">📢 READ THIS ALOUD</div>
          <div id="voice-sentence" style="font-size:14px;font-weight:500;color:#e2e8f0;line-height:1.5"></div>
          <button id="btn-new-sentence" title="New sentence" style="
            position:absolute;top:8px;right:10px;
            background:none;border:none;cursor:pointer;
            font-size:16px;opacity:0.6;
          " onclick="document.getElementById('voice-sentence').textContent = window._getRandomVoiceSentence()">🔄</button>
        </div>

        <!-- Timer -->
        <div id="rec-timer" style="font-size:32px;font-weight:800;font-variant-numeric:tabular-nums;
             color:var(--text-dim);display:none">0:00</div>

        <!-- Main record button (CLICK TOGGLE) -->
        <button id="btn-record" class="btn btn-primary" style="font-size:16px;padding:16px 48px;border-radius:50px;
                width:100%;max-width:280px">
          🎙️ Click to Record
        </button>

        <!-- Status pill -->
        <div id="voice-status" class="gate-status-pill gate-in" style="width:100%;text-align:center">
          Ready — click the button to start recording
        </div>
      </div>

      <!-- Right: Instructions + Result -->
      <div style="display:flex;flex-direction:column;gap:16px">

        <!-- Instructions card -->
        <div class="card">
          <h3 class="font-bold mb-3">📋 How it works</h3>
          <div id="voice-instructions" style="display:flex;flex-direction:column;gap:10px">
            <!-- filled by JS -->
          </div>
        </div>

        <!-- Result card -->
        <div class="card" id="voice-result-card" style="display:none">
          <h3 class="font-bold mb-3">🔍 Result</h3>
          <div id="voice-result-body"></div>
        </div>

        <!-- Today's voice check-ins -->
        <div class="card">
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-bold">Today's Activity</h3>
            <button class="btn btn-ghost btn-sm" id="btn-refresh-voice-log">↻</button>
          </div>
          <div id="voice-today-log" style="display:flex;flex-direction:column;gap:8px;max-height:200px;overflow-y:auto">
            <p class="text-dim text-sm">Loading...</p>
          </div>
        </div>

      </div>
    </div>
  </div>
</div>`;
}

// ── Init ───────────────────────────────────────────────────────────────────
export function initVoice() {
  // Clock
  setInterval(() => {
    const el = document.getElementById('voice-clock');
    if (el) el.textContent = new Date().toLocaleTimeString('en-IN');
  }, 1000);

  // Mode toggle — default to 'register' so first-timers register first
  setMode('register');
  document.querySelectorAll('[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });

  // Record button — click to toggle (start / stop)
  const btn = document.getElementById('btn-record');
  btn.addEventListener('click', () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  });

  // Expose sentence helper — in verify mode re-fetch from server
  window._getRandomVoiceSentence = () => {
    if (mode === 'verify') {
      fetchChallenge();
      return null; // fetchChallenge updates the DOM directly
    }
    return getRandomSentence();
  };

  // Show initial sentence / fetch challenge
  if (mode === 'register') {
    const sentenceEl = document.getElementById('voice-sentence');
    if (sentenceEl) sentenceEl.textContent = getRandomSentence();
  } else {
    fetchChallenge();
  }

  document.getElementById('btn-refresh-voice-log').addEventListener('click', loadVoiceLog);
  loadVoiceLog();
}

// ── Anti-deepfake: fetch server challenge (verify mode) ───────────────────────
async function fetchChallenge() {
  const sentenceEl = document.getElementById('voice-sentence');
  if (sentenceEl) sentenceEl.textContent = '🔄 Getting challenge…';
  try {
    const res  = await fetch(`${VOICE_API}/get-challenge`);
    const data = await res.json();
    challengeToken = data.token;
    if (sentenceEl) sentenceEl.textContent = data.phrase;
  } catch {
    if (sentenceEl) sentenceEl.textContent = getRandomSentence();
    challengeToken = null;
  }
}

function setMode(m) {
  mode = m;
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));

  const title    = document.getElementById('voice-title');
  const subtitle = document.getElementById('voice-subtitle');
  const instr    = document.getElementById('voice-instructions');

  // Refresh the random sentence on mode switch
  if (mode === 'register') {
    challengeToken = null;
    const sentenceEl = document.getElementById('voice-sentence');
    if (sentenceEl) sentenceEl.textContent = getRandomSentence();
  } else {
    fetchChallenge();  // get a fresh server challenge for verify mode
  }

  if (mode === 'register') {
    if (title)    title.textContent    = 'Register Your Voice';
    if (subtitle) subtitle.textContent = 'Read the sentence aloud for 5–10 seconds';
    if (instr) instr.innerHTML = steps([
      '1️⃣  Click <strong>Register Voice</strong> mode',
      '2️⃣  Read the displayed sentence aloud',
      '3️⃣  Click <strong>🎙️ Click to Record</strong> to start',
      '4️⃣  Click again to stop — voice is saved',
      '5️⃣  Next time use <strong>Mark Attendance</strong> mode',
    ]);
  } else {
    if (title)    title.textContent    = 'Verify Voice';
    if (subtitle) subtitle.textContent = 'Read the sentence aloud to mark attendance';
    if (instr) instr.innerHTML = steps([
      '1️⃣  Make sure you have <strong>registered</strong> your voice first',
      '2️⃣  Read the displayed sentence aloud',
      '3️⃣  Click <strong>🎙️ Click to Record</strong> to start',
      '4️⃣  Click again to stop — attendance is marked',
      '✅  Use 🔄 to get a new sentence anytime!',
    ]);
  }
  setStatus('Ready — click the button to start recording', 'in');
}

function steps(arr) {
  return arr.map(s => `<div style="padding:8px 12px;background:var(--surface);border-radius:8px;font-size:13px">${s}</div>`).join('');
}

// ── Recording (PCM via ScriptProcessorNode → WAV directly) ─────────────────
// No MediaRecorder, no WebM, no format conversion — always produces WAV.
const PCM_SAMPLE_RATE = 16000;
const PCM_BUFFER_SIZE = 4096;

async function startRecording() {
  if (isRecording) return;
  try {
    audioStream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: PCM_SAMPLE_RATE, channelCount: 1,
               echoCancellation: true, noiseSuppression: true }
    });
    audioContext = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: PCM_SAMPLE_RATE
    });
    // Chrome autoplay policy suspends AudioContext by default — must resume()
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }
    const source = audioContext.createMediaStreamSource(audioStream);
    scriptProc   = audioContext.createScriptProcessor(PCM_BUFFER_SIZE, 1, 1);
    pcmChunks    = [];

    scriptProc.onaudioprocess = (e) => {
      if (!isRecording) return;
      // Must copy — the buffer is reused by the engine each call
      pcmChunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };

    source.connect(scriptProc);
    scriptProc.connect(audioContext.destination);  // must connect to destination to fire
    isRecording = true;
    console.log('[Voice] AudioContext state:', audioContext.state, '| sampleRate:', audioContext.sampleRate);

    // Timer
    recordSecs = 0;
    document.getElementById('rec-timer').style.display = 'block';
    recordTimer = setInterval(() => {
      recordSecs++;
      const m = Math.floor(recordSecs / 60);
      const s = recordSecs % 60;
      const el = document.getElementById('rec-timer');
      if (el) el.textContent = `${m}:${String(s).padStart(2, '0')}`;
    }, 1000);

    setRingState('recording');
    const btnEl = document.getElementById('btn-record');
    if (btnEl) {
      btnEl.textContent = '⏹️ Click to Stop';
      btnEl.style.background = 'linear-gradient(135deg,#ef4444,#dc2626)';
    }
    setStatus('🔴 Recording… click button to stop', 'out');
  } catch (err) {
    showToast('Microphone Error', 'Please allow microphone permission in your browser', 'error');
    console.error('[Voice] getUserMedia error:', err);
  }
}

async function stopRecording() {
  if (!isRecording || !scriptProc) return;
  isRecording = false;
  clearInterval(recordTimer);
  document.getElementById('rec-timer').style.display = 'none';

  // Reset button
  const btnEl = document.getElementById('btn-record');
  if (btnEl) {
    btnEl.textContent = '🎙️ Click to Record';
    btnEl.style.background = '';
  }

  // Stop capture — use timeout on close() since Chrome can hang on it
  scriptProc.disconnect();
  audioStream.getTracks().forEach(t => t.stop());
  await Promise.race([
    audioContext.close(),
    new Promise(r => setTimeout(r, 600))
  ]);
  const capturedChunks = pcmChunks.slice(); // save before nulling
  scriptProc = null; audioContext = null; audioStream = null;
  pcmChunks  = [];

  setRingState('processing');
  setStatus('⏳ Processing…', 'in');

  // Merge all captured PCM chunks
  console.log('[Voice] Captured chunks:', capturedChunks.length);
  if (capturedChunks.length === 0) {
    setRingState('idle');
    setStatus('❌ No audio captured — check microphone permission', 'out');
    showToast('No Audio', 'Microphone may be blocked or not working', 'error');
    return;
  }

  const totalLen = capturedChunks.reduce((acc, c) => acc + c.length, 0);
  const merged   = new Float32Array(totalLen);
  let offset = 0;
  for (const chunk of capturedChunks) { merged.set(chunk, offset); offset += chunk.length; }

  console.log('[Voice] PCM samples:', totalLen, '| duration:', (totalLen/PCM_SAMPLE_RATE).toFixed(1)+'s');

  // Encode directly to WAV — guaranteed RIFF format, no conversion needed
  const wavBlob = encodeWAV(merged, PCM_SAMPLE_RATE);
  console.log('[Voice] WAV blob size:', wavBlob.size, 'bytes');

  // Refresh sentence
  const sentenceEl = document.getElementById('voice-sentence');
  if (mode === 'register' && sentenceEl) sentenceEl.textContent = getRandomSentence();

  if (totalLen < PCM_SAMPLE_RATE * 1.5) {  // < 1.5 seconds
    setRingState('idle');
    setStatus('Recording too short — speak for at least 2 seconds', 'out');
    return;
  }

  if (mode === 'register') {
    await doRegister(wavBlob);
  } else {
    await doVerify(wavBlob);
  }
}

// ── Voice fetch with 30s timeout (prevents stuck-on-Processing) ────────────
async function voiceFetch(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Request timed out (30s) — voice service may be busy');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ── Register ────────────────────────────────────────────────────────────────
async function doRegister(wavBlob) {
  const teacher = getTeacher();
  if (!teacher) { showToast('Not logged in', '', 'error'); return; }

  try {
    const userId = teacher._id || teacher.id || teacher.employeeId;
    console.log('[Register] user_id:', userId, '| wav size:', wavBlob.size);

    const fd = new FormData();
    fd.append('user_id', userId);
    fd.append('file', wavBlob, 'voice.wav');

    const res  = await voiceFetch(`${VOICE_API}/register-voice`, { method: 'POST', body: fd });
    const data = await res.json();
    console.log('[Register] Response:', res.status, data);

    if (!res.ok || !data.success) throw new Error(data.detail || data.message || 'Registration failed');

    setRingState('success');
    setStatus('✅ Voice registered successfully!', 'in');
    showToast('🎤 Voice Registered', `${Math.round(data.duration_sec)}s sample saved`, 'success');
    showResult({
      success: true,
      title: '✅ Voice Registered',
      message: `Voice profile saved (${Math.round(data.duration_sec)}s, ${data.embedding_dim}-dim). Now switch to Mark Attendance.`,
    });
  } catch (err) {
    console.error('[Register] Error:', err);
    setRingState('idle');
    setStatus('❌ Registration failed — ' + err.message, 'out');
    showToast('Registration Failed', err.message, 'error');
  }
}

// ── Verify ──────────────────────────────────────────────────────────────────
async function doVerify(wavBlob) {
  const teacher = getTeacher();
  if (!teacher) { showToast('Not logged in', '', 'error'); return; }

  const userId = teacher._id || teacher.id || teacher.employeeId;

  try {
    console.log('[Verify] user_id:', userId, '| wav size:', wavBlob.size);

    // Step 1: Verify voice with voice service
    const fd = new FormData();
    fd.append('user_id', userId);
    fd.append('file', wavBlob, 'voice.wav');
    if (challengeToken) {
      fd.append('challenge_token', challengeToken);
    }

    const vRes  = await voiceFetch(`${VOICE_API}/verify-voice`, { method: 'POST', body: fd });
    const vData = await vRes.json();
    console.log('[Verify] Response:', vRes.status, vData);
    // Immediately fetch a new challenge for next verification
    fetchChallenge();

    if (!vRes.ok) {
      if (vRes.status === 404) {
        setRingState('idle');
        setStatus('⚠️ Voice not registered — switch to Register Voice mode first!', 'out');
        showToast('Register First', 'Click "Register Voice" tab and record your voice before marking attendance.', 'error');
        // Auto-switch to register mode
        setMode('register');
        document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === 'register'));
        return;
      }
      throw new Error(vData.detail || 'Voice verification failed');
    }

    if (!vData.verified) {
      setRingState('idle');
      const sim = Math.round((vData.similarity || 0) * 100);
      setStatus(`❌ Voice not recognised (${sim}% match) — try again`, 'out');
      showResult({ success: false, title: '❌ Not Recognised', message: `Similarity: ${sim}%  (need ≥ 75%). Speak clearly in a quiet place.` });
      showToast('Voice not recognised', `${sim}% match`, 'error');
      return;
    }

    const sim = Math.round((vData.similarity || 0) * 100);
    setStatus(`✅ Verified (${sim}% match) — marking attendance…`, 'in');

    // Step 2: Mark attendance via backend
    const aRes = await apiFetch('/attendance/voice-checkin', {
      method: 'POST',
      body: JSON.stringify({ similarity: vData.similarity }),
    });

    setRingState('success');
    const isCheckIn = aRes.data?.autoCheckedIn;
    const isCheckOut = aRes.data?.autoCheckedOut;
    const alreadyIn = aRes.data?.alreadyCheckedIn;
    const alreadyOut = aRes.data?.alreadyCheckedOut;

    if (isCheckOut) {
      setStatus('📤 Check-out recorded!', 'out');
      showToast('Check-out recorded', `at ${new Date(aRes.data.checkOutTime).toLocaleTimeString('en-IN')}`, 'info');
      showResult({
        success: true,
        title: '📤 Check-Out Recorded',
        message: `Voice similarity: ${sim}% | Check-out: ${new Date(aRes.data.checkOutTime).toLocaleTimeString('en-IN')}`,
      });
    } else if (isCheckIn) {
      setStatus('✅ Attendance marked!', 'in');
      showToast('✅ Attendance Marked', `Voice verified ${sim}% — check-in recorded`, 'success');
      showResult({
        success: true,
        title: '✅ Attendance Marked',
        message: `Voice similarity: ${sim}% | Check-in: ${new Date(aRes.data.checkInTime).toLocaleTimeString('en-IN')}`,
      });
    } else if (alreadyIn) {
      setStatus('ℹ️ Already checked in today', 'in');
      showToast('Already checked in', aRes.data?.checkInTime ? `at ${new Date(aRes.data.checkInTime).toLocaleTimeString('en-IN')}` : '', 'info');
      showResult({
        success: true,
        title: 'ℹ️ Already Checked In',
        message: `Voice similarity: ${sim}% | Check-in: ${aRes.data?.checkInTime ? new Date(aRes.data.checkInTime).toLocaleTimeString('en-IN') : 'now'}`,
      });
    } else if (alreadyOut) {
      setStatus('ℹ️ Already checked out today', 'out');
      showToast('Already checked out', '', 'info');
      showResult({
        success: true,
        title: 'ℹ️ Already Checked Out',
        message: `Voice similarity: ${sim}% | You have already completed check-in and check-out today.`,
      });
    }

    await loadVoiceLog();
    // Refresh dashboard so it shows the voice attendance immediately
    refreshDashboard();
  } catch (err) {
    setRingState('idle');
    setStatus(`❌ ${err.message}`, 'out');
    showToast('Error', err.message, 'error');
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function setRingState(state) {
  const ring = document.getElementById('voice-ring');
  const icon = document.getElementById('ring-icon');
  if (!ring) return;
  ring.className = `voice-ring ${state}`;
  icon.textContent = { idle: '🎤', recording: '🔴', processing: '⏳', success: '✅' }[state] || '🎤';
}

function setStatus(msg, type) {
  const el = document.getElementById('voice-status');
  if (!el) return;
  el.textContent  = msg;
  el.className    = `gate-status-pill ${type === 'out' ? 'gate-out' : 'gate-in'}`;
}

function showResult({ success, title, message }) {
  const card = document.getElementById('voice-result-card');
  const body = document.getElementById('voice-result-body');
  if (!card || !body) return;
  card.style.display = 'block';
  body.innerHTML = `
    <div style="padding:16px;border-radius:10px;background:${success?'rgba(0,212,136,0.08)':'rgba(255,107,107,0.08)'};
         border:1px solid ${success?'rgba(0,212,136,0.3)':'rgba(255,107,107,0.3)'}">
      <div class="font-bold mb-2">${title}</div>
      <div class="text-muted text-sm">${message}</div>
    </div>`;
}

export async function loadVoiceLog() {
  try {
    const teacher = getTeacher();
    if (!teacher) return;
    const isAdmin = teacher.role === 'admin';
    
    let logs = [];
    if (isAdmin) {
      const res = await apiFetch('/attendance/all');
      logs = res.data?.logs || [];
    } else {
      const res = await apiFetch('/attendance/today');
      const log = res.data?.log;
      logs = log ? [log] : [];
    }

    const el = document.getElementById('voice-today-log');
    if (!el) return;

    // Filter logs that have voice entries
    const voiceLogs = logs.filter(l => l.logs && l.logs.some(e => e.method === 'VOICE'));
    if (!voiceLogs.length) {
      el.innerHTML = '<p class="text-dim text-sm">No voice attendance today</p>';
      return;
    }

    el.innerHTML = voiceLogs.map(l => {
      const voiceEvents = l.logs.filter(e => e.method === 'VOICE');
      return voiceEvents.map(e => {
        const timeStr = new Date(e.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
        const eventLabel = e.event === 'CHECK_IN' ? '📥 Check-In' : '📤 Check-Out';
        const teacherName = l.teacherId?.fullName || teacher.fullName || 'Unknown';
        const initials = teacherName.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
        return `
          <div class="flex items-center gap-3" style="padding:8px 10px;background:var(--surface);
               border-radius:8px;border:1px solid var(--border);margin-bottom:8px">
            <div class="teacher-avatar" style="width:32px;height:32px;font-size:11px">${initials}</div>
            <div style="flex:1">
              <div class="font-semibold text-sm">${teacherName}</div>
              <div class="text-dim" style="font-size:11px">${eventLabel} at ${timeStr}</div>
            </div>
            <span class="badge badge-blue">VOICE</span>
          </div>`;
      }).join('');
    }).join('');
  } catch { /* silent */ }
}
