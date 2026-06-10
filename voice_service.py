"""
Voice Attendance Service  (lightweight — no PyTorch required)
=============================================================
Port  : 8001
Engine: librosa MFCC + delta features → 128-dim voice fingerprint
        Cosine similarity for speaker verification

Endpoints:
  POST /register-voice   multipart: user_id + file (WAV/WebM/OGG/MP3)
  POST /verify-voice     multipart: user_id + file
  GET  /health
  DELETE /voice/{user_id}
"""

import io
import logging
import pickle
import traceback
import os
from pathlib import Path
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId

import numpy as np
import uvicorn
from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from resemblyzer import VoiceEncoder, preprocess_wav
import torch
torch.set_num_threads(1)

try:
    env_path = Path(__file__).parent / 'backend' / '.env'
    if env_path.exists():
        load_dotenv(env_path)
    else:
        root_env = Path(__file__).parent / '.env'
        if root_env.exists():
            load_dotenv(root_env)
except Exception:
    pass

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger("voice_service")

app = FastAPI(title="Voice Attendance Service", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup_event():
    import asyncio
    async def run_warmup():
        global _encoder
        if _encoder is not None:
            try:
                log.info("Warming up VoiceEncoder in background...")
                dummy_wav = np.zeros(16000 * 3, dtype=np.float32)
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(None, lambda: _encoder.embed_utterance(preprocess_wav(dummy_wav, source_sr=16000)))
                log.info("✅ VoiceEncoder warmup complete")
            except Exception as warmup_err:
                log.warning(f"⚠️ VoiceEncoder warmup failed: {warmup_err}")
    asyncio.create_task(run_warmup())

# ── MongoDB client setup ──
mongo_uri = os.getenv('MONGODB_URI', '')
try:
    mongo_client = AsyncIOMotorClient(
        mongo_uri,
        serverSelectionTimeoutMS=10000,
        connectTimeoutMS=10000,
        socketTimeoutMS=10000
    )
except Exception as e:
    print(f'⚠️ Motor connect warning: {e}')
    mongo_client = AsyncIOMotorClient(
        mongo_uri,
        connectTimeoutMS=10000,
        socketTimeoutMS=10000
    )
db = mongo_client.teacher_attendance

# ── Storage dir for embeddings ─────────────────────────────────────────────────
STORE_DIR = Path("voice_embeddings")
STORE_DIR.mkdir(exist_ok=True)

THRESHOLD_DEFAULT = 0.75   # cosine similarity threshold


# ── Audio loading ──────────────────────────────────────────────────────────────

def _resample(wav: np.ndarray, orig_sr: int, target_sr: int) -> np.ndarray:
    """Linear-interpolation resample — pure numpy, no librosa."""
    if orig_sr == target_sr:
        return wav
    duration = len(wav) / orig_sr
    n_out = int(round(duration * target_sr))
    x_old = np.linspace(0, len(wav) - 1, len(wav))
    x_new = np.linspace(0, len(wav) - 1, n_out)
    return np.interp(x_new, x_old, wav).astype(np.float32)

def load_audio(audio_bytes: bytes, target_sr: int = 16000) -> np.ndarray:
    """
    Decode any audio format → 16kHz mono float32.
    Strategy:
      1. soundfile  (WAV/OGG/FLAC — fast, pure Python)
      2. PyAV       (WebM/Opus/MP4/MP3 — no ffmpeg binary needed)
      3. pydub+ffmpeg (fallback if ffmpeg installed)
      4. scipy.io.wavfile (WAV only last resort)
    """
    import soundfile as sf

    # --- attempt 1: soundfile (WAV/RIFF) ---
    try:
        with io.BytesIO(audio_bytes) as buf:
            wav, sr = sf.read(buf, dtype="float32", always_2d=False)
        if wav.ndim == 2:
            wav = wav.mean(axis=1)
        if sr != target_sr:
            wav = _resample(wav, sr, target_sr)
        log.info(f"Audio loaded via soundfile: {len(wav)/target_sr:.2f}s @ {sr}Hz")
        return wav.astype(np.float32)
    except Exception:
        pass

    # --- attempt 2: PyAV (WebM/Opus/OGG/MP4 — no ffmpeg binary needed) ---
    try:
        import av
        with io.BytesIO(audio_bytes) as buf:
            container = av.open(buf)
            samples_list = []
            for frame in container.decode(audio=0):
                arr = frame.to_ndarray()           # shape: (channels, samples)
                if arr.ndim == 2:
                    arr = arr.mean(axis=0)          # mix to mono
                samples_list.append(arr.astype(np.float32))
            if not samples_list:
                raise ValueError("No audio frames decoded")
            wav = np.concatenate(samples_list)
            # Normalise if integer samples
            if wav.max() > 1.0:
                wav = wav / (2**15)
            # Resample if needed
            src_sr = container.streams.audio[0].rate
            if src_sr != target_sr:
                wav = _resample(wav, src_sr, target_sr)
        log.info(f"Audio loaded via PyAV: {len(wav)/target_sr:.2f}s @ {src_sr}Hz")
        return wav.astype(np.float32)
    except Exception as e:
        log.debug(f"PyAV failed: {e}")

    # --- attempt 3: pydub (requires ffmpeg binary) ---
    try:
        from pydub import AudioSegment
        seg = AudioSegment.from_file(io.BytesIO(audio_bytes))
        seg = seg.set_frame_rate(target_sr).set_channels(1).set_sample_width(2)
        raw = np.frombuffer(seg.raw_data, dtype=np.int16).astype(np.float32)
        log.info(f"Audio loaded via pydub: {len(raw)/target_sr:.2f}s")
        return raw / 32768.0
    except Exception:
        pass

    # --- attempt 4: scipy WAV fallback ---
    try:
        from scipy.io import wavfile
        sr, wav = wavfile.read(io.BytesIO(audio_bytes))
        if wav.dtype != np.float32:
            wav = wav.astype(np.float32) / np.iinfo(wav.dtype).max
        if wav.ndim == 2:
            wav = wav.mean(axis=1)
        if sr != target_sr:
            wav = _resample(wav, sr, target_sr)
        return wav.astype(np.float32)
    except Exception as e:
        raise ValueError(f"Cannot decode audio (tried soundfile, PyAV, pydub, scipy): {e}")



# ── Feature extraction (pure numpy — no librosa, no native DLL crashes) ───────

def _hz_to_mel(hz):
    return 2595.0 * np.log10(1.0 + hz / 700.0)

def _mel_to_hz(mel):
    return 700.0 * (10.0 ** (mel / 2595.0) - 1.0)

def _mel_filterbank(sr, n_fft, n_mels=40, fmin=0.0, fmax=None):
    if fmax is None:
        fmax = sr / 2.0
    mel_min = _hz_to_mel(fmin)
    mel_max = _hz_to_mel(fmax)
    mels = np.linspace(mel_min, mel_max, n_mels + 2)
    hz   = _mel_to_hz(mels)
    bins = np.floor((n_fft + 1) * hz / sr).astype(int)
    fb   = np.zeros((n_mels, n_fft // 2 + 1))
    for m in range(1, n_mels + 1):
        lo, cen, hi = bins[m-1], bins[m], bins[m+1]
        for k in range(lo, cen):
            if cen != lo:
                fb[m-1, k] = (k - lo) / (cen - lo)
        for k in range(cen, hi):
            if hi != cen:
                fb[m-1, k] = (hi - k) / (hi - cen)
    return fb

def _dct(x):
    """Type-II DCT via numpy FFT (fast, no scipy needed)."""
    N = x.shape[-1]
    v = np.concatenate([x[..., ::2], x[..., 1::2][..., ::-1]], axis=-1)
    V = np.fft.rfft(v, n=N, axis=-1)
    k = np.arange(N)
    phase = np.exp(-1j * np.pi * k / (2 * N))
    V = (V * phase[..., :V.shape[-1]]).real
    V[..., 0] /= np.sqrt(4 * N)
    V[..., 1:] /= np.sqrt(2 * N)
    return V

def _delta(feat, width=3):
    """Compute delta (first-order derivative) of feature matrix (n_feat, T)."""
    pad = width // 2
    padded = np.pad(feat, ((0, 0), (pad, pad)), mode='edge')
    denom = 2.0 * sum(i*i for i in range(1, pad+1))
    delta = np.zeros_like(feat)
    for t in range(feat.shape[1]):
        for i in range(1, pad+1):
            delta[:, t] += i * (padded[:, t + pad + i] - padded[:, t + pad - i])
    return delta / (denom if denom > 0 else 1.0)

def _trim_silence(wav, top_db=25, frame_len=512, hop=160):
    """Simple energy-based silence trim."""
    frames = np.array([
        wav[i:i+frame_len] for i in range(0, len(wav)-frame_len, hop)
    ])
    if frames.size == 0:
        return wav
    energy_db = 20 * np.log10(np.maximum(np.sqrt((frames**2).mean(axis=1)), 1e-10))
    threshold  = energy_db.max() - top_db
    keep       = energy_db >= threshold
    if not keep.any():
        return wav
    first = np.argmax(keep) * hop
    last  = (len(keep) - np.argmax(keep[::-1]) - 1) * hop + frame_len
    return wav[first:min(last, len(wav))]

def extract_embedding(wav: np.ndarray, sr: int = 16000) -> np.ndarray:
    """
    Pure-numpy voice fingerprint (120-dim):
      Mel-MFCC (40) + delta + delta-delta → mean+std → L2 normalise.
    No librosa, no native DLLs → zero crash risk.
    """
    # Pre-emphasis
    wav = np.append(wav[0], wav[1:] - 0.97 * wav[:-1])

    # Silence trim
    wav = _trim_silence(wav.astype(np.float32))

    if len(wav) < int(sr * 0.5):
        raise ValueError("Too little speech after silence trim — speak louder/longer")

    # Framing
    frame_len, hop = 512, 160
    n_frames = 1 + (len(wav) - frame_len) // hop
    indices  = (np.arange(frame_len)[None, :] +
                np.arange(n_frames)[:, None] * hop)
    frames   = wav[indices] * np.hamming(frame_len)   # (T, frame_len)

    # Power spectrum
    mag  = np.abs(np.fft.rfft(frames, n=frame_len))   # (T, n_fft//2+1)
    pwr  = mag ** 2

    # Mel filterbank
    n_mels = 40
    fb     = _mel_filterbank(sr, frame_len, n_mels=n_mels)   # (40, n_fft//2+1)
    mel    = pwr @ fb.T                                        # (T, 40)
    mel    = np.log(np.maximum(mel, 1e-10))

    # DCT → MFCC (keep first 20 coefficients)
    n_mfcc = 20
    mfcc   = _dct(mel)[..., :n_mfcc]                          # (T, 20)
    mfcc   = mfcc.T                                            # (20, T)

    # Delta + delta-delta
    d1 = _delta(mfcc)
    d2 = _delta(d1)

    # Stack (57, T) by excluding the 0th coefficient (cepstral energy) to prevent L2 normalization dominance
    feat  = np.vstack([mfcc[1:], d1[1:], d2[1:]])
    embed = np.concatenate([feat.mean(axis=1), feat.std(axis=1)])

    # L2 normalise
    norm = np.linalg.norm(embed)
    if norm > 1e-9:
        embed /= norm

    log.info(f"Embedding: {embed.shape[0]}-dim | duration={len(wav)/sr:.2f}s | frames={n_frames}")
    return embed.astype(np.float32)



def extract_frame_features(wav: np.ndarray, sr: int = 16000) -> np.ndarray:
    """
    Extract frame-level features (T, 57) for OneClassSVM.
    Excludes the 0th coefficient (cepstral energy).
    L2 normalises each frame vector to scale independent of loudness.
    """
    # Pre-emphasis
    wav = np.append(wav[0], wav[1:] - 0.97 * wav[:-1])

    # Silence trim
    wav = _trim_silence(wav.astype(np.float32))

    if len(wav) < int(sr * 0.5):
        raise ValueError("Too little speech after silence trim — speak louder/longer")

    # Framing
    frame_len, hop = 512, 160
    n_frames = 1 + (len(wav) - frame_len) // hop
    indices  = (np.arange(frame_len)[None, :] +
                np.arange(n_frames)[:, None] * hop)
    frames   = wav[indices] * np.hamming(frame_len)   # (T, frame_len)

    # Power spectrum
    mag  = np.abs(np.fft.rfft(frames, n=frame_len))   # (T, n_fft//2+1)
    pwr  = mag ** 2

    # Mel filterbank
    n_mels = 40
    fb     = _mel_filterbank(sr, frame_len, n_mels=n_mels)   # (40, n_fft//2+1)
    mel    = pwr @ fb.T                                        # (T, 40)
    mel    = np.log(np.maximum(mel, 1e-10))

    # DCT → MFCC (keep first 20 coefficients)
    n_mfcc = 20
    mfcc   = _dct(mel)[..., :n_mfcc]                          # (T, 20)
    mfcc   = mfcc.T                                            # (20, T)

    # Delta + delta-delta
    d1 = _delta(mfcc)
    d2 = _delta(d1)

    # Stack (57, T) by excluding the 0th coefficient
    feat = np.vstack([mfcc[1:], d1[1:], d2[1:]]) # (57, T)
    
    # L2 normalise each frame individually
    norms = np.linalg.norm(feat, axis=0, keepdims=True)
    norms[norms < 1e-9] = 1.0
    feat_norm = feat / norms
    
    return feat_norm.T.astype(np.float32) # (T, 57)


# Initialize Resemblyzer VoiceEncoder on startup to prevent request-time cold start timeouts
try:
    log.info("Loading Resemblyzer VoiceEncoder on CPU at startup...")
    _encoder = VoiceEncoder(device="cpu")
    log.info("✅ Resemblyzer VoiceEncoder loaded successfully")
except Exception as e:
    log.error(f"❌ Failed to load Resemblyzer VoiceEncoder: {e}")
    _encoder = None

def get_voice_encoder():
    global _encoder
    if _encoder is None:
        log.info("Loading Resemblyzer VoiceEncoder on CPU (lazy fallback)...")
        _encoder = VoiceEncoder(device="cpu")
    return _encoder

def extract_resemblyzer_embedding(wav: np.ndarray, sr: int = 16000) -> np.ndarray:
    """
    Extract a 256-dimensional d-vector speaker embedding using Resemblyzer.
    This provides high-fidelity, text-independent speaker classification.
    """
    encoder = get_voice_encoder()
    wav_pre = preprocess_wav(wav, source_sr=sr)
    embed = encoder.embed_utterance(wav_pre)
    return embed.astype(np.float32)



def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    na, nb = np.linalg.norm(a), np.linalg.norm(b)
    if na < 1e-9 or nb < 1e-9:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


def clean_embedding(emb: np.ndarray) -> np.ndarray:
    """Slice and normalise 120-dim legacy or 114-dim clean embeddings to exclude cepstral energy (coefficient 0)."""
    if emb.shape[0] == 114:
        return emb
    if emb.shape[0] == 120:
        mean_mfcc = emb[1:20]
        mean_d1   = emb[21:40]
        mean_d2   = emb[41:60]
        std_mfcc  = emb[61:80]
        std_d1    = emb[81:100]
        std_d2    = emb[101:120]
        clean_emb = np.concatenate([mean_mfcc, mean_d1, mean_d2, std_mfcc, std_d1, std_d2])
        norm = np.linalg.norm(clean_emb)
        if norm > 1e-9:
            clean_emb /= norm
        return clean_emb
    return emb


def embedding_path(user_id: str) -> Path:
    # Sanitise user_id for safe filenames
    safe = "".join(c for c in user_id if c.isalnum() or c in "-_")
    return STORE_DIR / f"{safe}.npy"


def gmm_path(user_id: str) -> Path:
    # Sanitise user_id for safe filenames
    safe = "".join(c for c in user_id if c.isalnum() or c in "-_")
    return STORE_DIR / f"{safe}.gmm.pkl"


# ── Endpoints ──────────────────────────────────────────────────────────────────

# ── Anti-deepfake challenge store (in-memory, per process) ────────────────────
import secrets, time as _time
_CHALLENGES: dict = {}   # token -> {phrase, expires, used}

CHALLENGE_PHRASES = [
    "My name is on the attendance list",
    "Good morning everyone",
    "I am present today",
    "Today is a good day",
    "I am a teacher",
    "Hello I am here",
    "My attendance is marked",
    "I am ready for class",
    "This is my voice",
    "I am logging in now",
    "Good day to all",
    "I am checking in",
    "My voice is my password",
    "I am in the classroom",
    "Let us begin the class",
]

@app.get("/")
def read_root():
    return {"status": "ok", "message": "Voice Attendance Service is running"}

@app.get("/get-challenge")
def get_challenge():
    """
    Anti-deepfake: Issue a one-time challenge token + random phrase.
    Client MUST speak this exact phrase within 90 seconds.
    Pre-recorded audio fails because the phrase is unknown beforehand.
    """
    import random
    phrase = random.choice(CHALLENGE_PHRASES)
    token  = secrets.token_urlsafe(24)
    _CHALLENGES[token] = {
        "phrase":  phrase,
        "expires": _time.time() + 90,   # 90-second window
        "used":    False,
    }
    # Cleanup old tokens (keep memory tidy)
    expired = [k for k, v in _CHALLENGES.items() if v["expires"] < _time.time()]
    for k in expired:
        del _CHALLENGES[k]
    return {"token": token, "phrase": phrase}


@app.get("/health")
def health():
    try:
        import resemblyzer # noqa
        import torch       # noqa
        deps_ok = True
    except ImportError:
        deps_ok = False

    return {
        "status": "ok",
        "service": "voice",
        "engine": "Resemblyzer-256dim",
        "deps_ok": deps_ok,
        "store": str(STORE_DIR),
        "registered": len(list(STORE_DIR.glob("*.npy"))),
    }


@app.post("/register-voice")
async def register_voice(
    user_id: str = Form(...),
    file: UploadFile = File(...),
):
    """
    Register a teacher's voice fingerprint.
    Accepts WAV / WebM / OGG / MP3.
    Stores a 256-dim Resemblyzer embedding on disk and in MongoDB.
    """
    audio_bytes = await file.read()
    if len(audio_bytes) < 500:
        raise HTTPException(400, "Audio file too short or empty")

    try:
        wav = load_audio(audio_bytes)
    except Exception as e:
        raise HTTPException(400, f"Cannot decode audio: {e}")

    if len(wav) < 16000:   # < 1 second at 16kHz
        raise HTTPException(400, "Recording too short — please speak for at least 3 seconds")

    try:
        embed = extract_resemblyzer_embedding(wav)
    except Exception as e:
        log.error(f"Resemblyzer embedding failed: {e}\n{traceback.format_exc()}")
        raise HTTPException(500, f"Embedding failed: {e}")

    # Save 256-dim Resemblyzer embedding to disk
    path = embedding_path(user_id)
    np.save(str(path), embed)

    # Save to MongoDB teachers collection
    try:
        encoding_bytes = embed.tobytes()
        await db.teachers.update_one(
            {"_id": ObjectId(user_id)},
            {"$set": {
                "voiceEncoding": encoding_bytes
            }}
        )
    except Exception as mongo_err:
        log.error(f"⚠️ Failed to persist voice embedding in MongoDB: {mongo_err}")

    # Clean up any leftover legacy SVM or GMM pkl files for this user
    for ext in [".svm.pkl", ".gmm.pkl"]:
        stray = STORE_DIR / f"{Path(path).stem}{ext}"
        if stray.exists():
            stray.unlink()

    log.info(f"✅ Voice registered user={user_id}  embed_dim={embed.shape[0]}  "
             f"duration={len(wav)/16000:.1f}s  path={path}")
    return {
        "success": True,
        "message": "Voice registered successfully",
        "embedding_dim": int(embed.shape[0]),
        "duration_sec": round(len(wav) / 16000, 2),
    }


@app.post("/verify-voice")
async def verify_voice(
    user_id: str = Form(...),
    file: UploadFile = File(...),
    threshold: float = Form(THRESHOLD_DEFAULT),
    challenge_token: str = Form(None),
):
    """
    Verify a voice sample against the stored fingerprint and verify challenge phrase (anti-deepfake).
    Returns { verified, similarity, confidence }.
    """
    path = embedding_path(user_id)
    embed_stored = None
    if path.exists():
        try:
            embed_stored = np.load(str(path))
        except Exception as err:
            log.warning(f"Failed to load embedding from disk for user {user_id}: {err}")

    if embed_stored is None:
        try:
            teacher = await db.teachers.find_one({"_id": ObjectId(user_id)})
            if teacher and teacher.get('voiceEncoding'):
                raw = teacher['voiceEncoding']
                if hasattr(raw, 'read'):
                    raw = raw.read()
                elif not isinstance(raw, (bytes, bytearray)):
                    raw = bytes(raw)
                embed_stored = np.frombuffer(raw, dtype=np.float32)
                # Cache on disk
                np.save(str(path), embed_stored)
                log.info(f"Loaded and re-cached voice embedding from MongoDB for user {user_id}")
        except Exception as db_err:
            log.error(f"Error reading voice encoding from MongoDB: {db_err}")

    if embed_stored is None:
        raise HTTPException(404, f"No voice registered for user '{user_id}'. Please register first.")

    audio_bytes = await file.read()

    # 1. Challenge/Sentence Verification (Anti-Deepfake)
    if challenge_token:
        if challenge_token not in _CHALLENGES:
            raise HTTPException(400, "Invalid or expired challenge token. Please try again.")
        
        challenge = _CHALLENGES[challenge_token]
        if challenge["expires"] < _time.time():
            raise HTTPException(400, "Challenge token expired. Please try again.")
        
        expected_phrase = challenge["phrase"]
        
        import speech_recognition as sr
        r = sr.Recognizer()
        try:
            with io.BytesIO(audio_bytes) as buf:
                import soundfile as sf
                wav_data, sr_val = sf.read(buf)
                
                temp_buf = io.BytesIO()
                sf.write(temp_buf, wav_data, sr_val, format='WAV', subtype='PCM_16')
                temp_buf.seek(0)
                
                with sr.AudioFile(temp_buf) as source:
                    audio_data = r.record(source)
                    
            text_spoken = r.recognize_google(audio_data).lower()
            log.info(f"Challenge matching: expected='{expected_phrase}' | spoken='{text_spoken}'")
            
            import string
            def clean(t):
                return "".join(c for c in t.lower() if c not in string.punctuation).strip()
                
            expected_words = set(clean(expected_phrase).split())
            spoken_words = set(clean(text_spoken).split())
            
            if expected_words:
                match_ratio = len(expected_words.intersection(spoken_words)) / len(expected_words)
            else:
                match_ratio = 1.0
                
            if match_ratio < 0.5:
                raise HTTPException(400, f"Challenge sentence mismatch. Please read: '{expected_phrase}' (we heard: '{text_spoken}')")
                
        except sr.UnknownValueError:
            raise HTTPException(400, f"Speech not recognized. Please speak clearly: '{expected_phrase}'")
        except sr.RequestError as re:
            log.warning(f"Google STT service unavailable: {re} — skipping text verification")
        except HTTPException as he:
            raise he
        except Exception as e:
            log.warning(f"Speech recognition processing error: {e} — skipping text verification")

    try:
        wav = load_audio(audio_bytes)
    except Exception as e:
        raise HTTPException(400, f"Cannot decode audio: {e}")

    if len(wav) < 8000:   # < 0.5 s
        raise HTTPException(400, "Recording too short for verification")

    # embed_stored has already been loaded and verified from cache or DB fallback

    if embed_stored.shape[0] == 256:
        # Secure Resemblyzer deep learning verification
        try:
            embed_live = extract_resemblyzer_embedding(wav)
        except Exception as e:
            log.error(f"Resemblyzer embedding extraction failed for {user_id}: {e}")
            raise HTTPException(500, f"Feature extraction failed: {e}")

        similarity = cosine_similarity(embed_live, embed_stored)
        # Use 0.65 (65%) as standard Resemblyzer similarity threshold for user-friendly verification
        verified = bool(similarity >= 0.65)
        verify_threshold = 0.65
        log.info(f"Secure Resemblyzer verify  user={user_id}  sim={similarity:.4f}  "
                 f"threshold={verify_threshold}  verified={verified}")
    else:
        # Reject legacy voice profiles to ensure high security using Resemblyzer
        log.warning(f"⚠️ Legacy voice profile detected for user {user_id}. Please re-register voice for enhanced security.")
        raise HTTPException(
            status_code=400,
            detail="Legacy voice profile detected. Please re-register your voice for secure Resemblyzer verification."
        )

    return {
        "success":    True,
        "verified":   verified,
        "similarity": round(float(similarity), 4),
        "confidence": round(float(similarity), 4),
        "threshold":  verify_threshold,
    }


@app.get("/voice-status/{user_id}")
async def check_voice_status(user_id: str):
    path = embedding_path(user_id)
    if path.exists():
        return {"registered": True}
    try:
        teacher = await db.teachers.find_one({"_id": ObjectId(user_id)})
        if teacher and teacher.get('voiceEncoding'):
            return {"registered": True}
    except Exception:
        pass
    return {"registered": False}


@app.delete("/voice/{user_id}")
async def delete_voice(user_id: str):
    path = embedding_path(user_id)
    deleted = False
    if path.exists():
        try:
            path.unlink()
            deleted = True
        except Exception:
            pass
    
    try:
        res = await db.teachers.update_one(
            {"_id": ObjectId(user_id)},
            {"$unset": {
                "voiceEncoding": ""
            }}
        )
        if res.modified_count > 0:
            deleted = True
    except Exception as mongo_err:
        log.error(f"Failed to delete voice from MongoDB: {mongo_err}")
    
    # Clean up any legacy SVM or GMM pkl files for this user
    for ext in [".svm.pkl", ".gmm.pkl"]:
        stray = STORE_DIR / f"{Path(path).stem}{ext}"
        if stray.exists():
            try:
                stray.unlink()
                deleted = True
            except Exception:
                pass
            
    if deleted:
        return {"success": True, "message": "Voice registration deleted successfully"}
    raise HTTPException(404, f"No voice registration found for user '{user_id}'")


# ── Main ───────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    log.info("🎤 Voice Attendance Service starting on http://0.0.0.0:8001")
    log.info("   Engine : Resemblyzer 256-dim (Deep Learning Speaker Encoder)")
    log.info("   Storage: ./voice_embeddings/")
    uvicorn.run(app, host="0.0.0.0", port=8001, log_level="warning")
