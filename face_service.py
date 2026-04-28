"""
Face Recognition Service — Teacher Attendance
==============================================
Uses OpenCV built-in YuNet + SFace (zero external ML deps).
Adapted from cloud-based-attendance project.
"""

import sys
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

from fastapi import FastAPI, File, UploadFile, HTTPException, Form, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import numpy as np
from PIL import Image
import io
import cloudinary
import cloudinary.uploader
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
import os
import time
import logging
import cv2
from pathlib import Path
import urllib.request
from typing import Optional, Dict, List
from datetime import datetime, timezone
from collections import deque

# ── Load .env ──
try:
    from dotenv import load_dotenv
    env_path = Path(__file__).parent / 'backend' / '.env'
    if env_path.exists():
        load_dotenv(env_path)
    else:
        root_env = Path(__file__).parent / '.env'
        if root_env.exists():
            load_dotenv(root_env)
except ImportError:
    print('⚠️  python-dotenv not installed')

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("teacher_face_service")

# ==================== MODEL SETUP ====================

MODELS_DIR = Path(__file__).parent / "models"
MODELS_DIR.mkdir(exist_ok=True)

YUNET_URL = "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
YUNET_PATH = str(MODELS_DIR / "face_detection_yunet_2023mar.onnx")

SFACE_URL = "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx"
SFACE_PATH = str(MODELS_DIR / "face_recognition_sface_2021dec.onnx")


def download_if_missing(url: str, path: str, name: str):
    if os.path.exists(path):
        size_mb = os.path.getsize(path) / 1024 / 1024
        print(f"✅ {name} ready ({size_mb:.1f} MB)")
        return
    print(f"🔄 Downloading {name}...")
    urllib.request.urlretrieve(url, path)
    size_mb = os.path.getsize(path) / 1024 / 1024
    print(f"✅ Downloaded {name} ({size_mb:.1f} MB)")


print("🔄 Setting up face models...")
download_if_missing(YUNET_URL, YUNET_PATH, "YuNet face detector")
download_if_missing(SFACE_URL, SFACE_PATH, "SFace recognizer")

face_detector = cv2.FaceDetectorYN.create(YUNET_PATH, "", (320, 320), 0.7, 0.3, 5000)
face_recognizer = cv2.FaceRecognizerSF.create(SFACE_PATH, "")
print("✅ OpenCV FaceDetectorYN + FaceRecognizerSF loaded")

# ==================== CONFIGURATION ====================

EMBEDDING_DIM = 128          # SFace outputs 128-dim vector
ENCODING_BYTES = EMBEDDING_DIM * 8  # 1024 bytes (float64)

# ── Matching thresholds ──────────────────────────────────────────────────────
# Raised from OpenCV default (0.363) to reduce false positives in live-detect.
# Both cosine AND L2 must pass; ambiguous matches (margin < MIN_MARGIN) are rejected.
COSINE_THRESHOLD = 0.363      # min cosine similarity to accept a match
L2_THRESHOLD     = 1.128      # max L2 distance to accept a match (lower = stricter)
MIN_MARGIN       = 0.04       # margin check (only applies if 2nd best is also high)

# ==================== FASTAPI APP ====================

app = FastAPI(title="Teacher Face Recognition Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Cloudinary ──
cloud_name = os.getenv('CLOUDINARY_CLOUD_NAME')
api_key = os.getenv('CLOUDINARY_API_KEY')
api_secret_raw = os.getenv('CLOUDINARY_API_SECRET', '')
api_secret = api_secret_raw.split(':')[2].split('@')[0] if api_secret_raw.startswith('cloudinary://') else api_secret_raw
cloudinary.config(cloud_name=cloud_name, api_key=api_key, api_secret=api_secret)

# ── MongoDB — force use of dnspython for SRV resolution ──
mongo_uri = os.getenv('MONGODB_URI', '')
try:
    mongo_client = AsyncIOMotorClient(mongo_uri, serverSelectionTimeoutMS=10000)
except Exception as e:
    print(f'⚠️  Motor connect warning: {e}')
    mongo_client = AsyncIOMotorClient(mongo_uri)
# Use teacher_attendance DB — collection is 'teachers'
db = mongo_client.teacher_attendance


# ==================== HELPERS ====================

def image_bytes_to_bgr(data: bytes, max_dim: int = 800) -> np.ndarray:
    img = Image.open(io.BytesIO(data))
    rgb = np.array(img.convert('RGB'))
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    h, w = bgr.shape[:2]
    if max(h, w) > max_dim:
        scale = max_dim / max(h, w)
        bgr = cv2.resize(bgr, (int(w * scale), int(h * scale)))
    return bgr


def detect_face(image_bgr: np.ndarray):
    h, w = image_bgr.shape[:2]
    face_detector.setInputSize((w, h))
    _, faces = face_detector.detect(image_bgr)
    if faces is None or len(faces) == 0:
        return None
    best_idx = np.argmax(faces[:, -1])
    return faces[best_idx]


def detect_all_faces(image_bgr: np.ndarray):
    h, w = image_bgr.shape[:2]
    face_detector.setInputSize((w, h))
    _, faces = face_detector.detect(image_bgr)
    if faces is None or len(faces) == 0:
        return []
    return faces


def get_embedding(image_bgr: np.ndarray) -> np.ndarray:
    face = detect_face(image_bgr)
    if face is None:
        raise ValueError("No face detected in image")
    aligned = face_recognizer.alignCrop(image_bgr, face)
    embedding = face_recognizer.feature(aligned)
    return embedding.flatten().astype(np.float64)


def match_score(emb1: np.ndarray, emb2: np.ndarray) -> dict:
    v1 = emb1.astype(np.float32).flatten()
    v2 = emb2.astype(np.float32).flatten()
    n1 = float(np.linalg.norm(v1))
    n2 = float(np.linalg.norm(v2))
    if n1 == 0 or n2 == 0:
        return {"cosine_score": 0.0, "l2_distance": 99.0, "is_match": False, "confidence": 0.0}
    cosine_score = float(np.dot(v1 / n1, v2 / n2))
    l2_distance  = float(np.linalg.norm((v1 / n1) - (v2 / n2)))
    # Dual-gate: both cosine similarity AND L2 distance must pass
    is_match = (cosine_score >= COSINE_THRESHOLD) and (l2_distance <= L2_THRESHOLD)
    return {"cosine_score": cosine_score, "l2_distance": l2_distance, "is_match": is_match, "confidence": cosine_score}


def detect_liveness(image_bgr: np.ndarray):
    """Basic liveness: blur check + face presence check."""
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    lap_var = cv2.Laplacian(gray, cv2.CV_64F).var()

    if lap_var < 5:
        return False, 0.3, "Image too blurry"
    if lap_var > 8000:
        return False, 0.4, "Image too sharp (printed photo?)"

    face = detect_face(image_bgr)
    if face is None:
        return False, 0.2, "No face detected"

    confidence = float(face[-1])  # YuNet confidence
    if confidence < 0.7:
        return False, confidence, "Low face detection confidence"

    return True, max(0.85, confidence), "Live face detected"


# ==================== API ENDPOINTS ====================

@app.post("/register-face")
async def register_face_endpoint(
    user_id: str = Form(...),
    file: UploadFile = File(...)
):
    """Register teacher face — stores SFace 128-dim embedding in 'teachers' collection."""
    try:
        image_data = await file.read()
        image_bgr = image_bytes_to_bgr(image_data)

        is_live, conf, reason = detect_liveness(image_bgr)
        if not is_live:
            raise HTTPException(400, detail=f"Liveness check failed: {reason}")

        try:
            embedding = get_embedding(image_bgr)
        except ValueError as ve:
            raise HTTPException(400, detail=str(ve))

        logger.info(f"Registration: embedding shape={embedding.shape}, norm={np.linalg.norm(embedding):.4f}")

        upload_result = await asyncio.to_thread(
            cloudinary.uploader.upload,
            image_data,
            folder="teacher_attendance/faces",
            public_id=f"teacher_{user_id}_{int(time.time())}",
            transformation=[{'width': 400, 'height': 400, 'crop': 'fill', 'gravity': 'face'}]
        )

        encoding_bytes = embedding.tobytes()

        await db.teachers.update_one(
            {"_id": ObjectId(user_id)},
            {"$set": {
                "faceEncoding": encoding_bytes,
                "faceImageUrl": upload_result['secure_url'],
                "faceImageData": image_data,
                "faceRegisteredAt": datetime.now(timezone.utc)   # ← use datetime not time.time()
            }}
        )

        return {
            "success": True,
            "message": "Face registered successfully",
            "imageUrl": upload_result['secure_url'],
            "livenessConfidence": conf,
            "embeddingDim": len(embedding),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Registration error: {e}", exc_info=True)
        raise HTTPException(500, detail=f"Error: {str(e)}")


@app.post("/verify-face")
async def verify_face_endpoint(
    user_id: str = Form(...),
    file: UploadFile = File(...)
):
    """Verify teacher face against stored embedding."""
    try:
        image_data = await file.read()
        try:
            image_bgr = image_bytes_to_bgr(image_data)
        except Exception as e:
            return {"verified": False, "confidence": 0, "reason": f"Invalid image: {e}"}

        is_live, liveness_conf, reason = detect_liveness(image_bgr)
        if not is_live:
            return {"verified": False, "confidence": 0, "reason": f"Liveness failed: {reason}"}

        teacher = await db.teachers.find_one({"_id": ObjectId(user_id)})
        if not teacher or not teacher.get('faceEncoding'):
            raise HTTPException(404, detail="Teacher face not registered")

        raw = teacher['faceEncoding']
        if hasattr(raw, 'read'):
            raw = raw.read()
        elif not isinstance(raw, (bytes, bytearray)):
            raw = bytes(raw)

        if len(raw) != ENCODING_BYTES:
            raise HTTPException(400, detail=f"Encoding size mismatch ({len(raw)} bytes). Please re-register.")

        stored = np.frombuffer(raw, dtype=np.float64)

        try:
            current = get_embedding(image_bgr)
        except ValueError:
            return {"verified": False, "confidence": 0, "reason": "No face detected"}

        result = match_score(stored, current)
        logger.info(f"Verify: cosine={result['cosine_score']:.4f}, match={result['is_match']}")

        verify_url = None
        if result['is_match']:
            try:
                r = cloudinary.uploader.upload(
                    image_data, folder="teacher_attendance/verifications",
                    public_id=f"verify_{user_id}_{int(time.time())}"
                )
                verify_url = r['secure_url']
            except Exception:
                pass

        return {
            "verified": result['is_match'],
            "confidence": result['confidence'],
            "faceDistance": result['l2_distance'],
            "livenessConfidence": liveness_conf,
            "verificationImageUrl": verify_url,
            "reason": "Face matched" if result['is_match'] else "Face did not match"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Verify error: {e}", exc_info=True)
        raise HTTPException(500, detail=f"Error: {str(e)}")


@app.post("/identify-face")
async def identify_face_endpoint(file: UploadFile = File(...)):
    """Identify teacher from all registered faces (camera scan)."""
    try:
        data = await file.read()
        bgr = image_bytes_to_bgr(data)

        try:
            current = get_embedding(bgr)
        except ValueError:
            return {"identified": False, "userId": None, "confidence": 0, "reason": "No face detected"}

        teachers = await db.teachers.find({"faceEncoding": {"$exists": True}}).to_list(500)

        best = None
        best_score = 0

        for t in teachers:
            raw = t['faceEncoding']
            if hasattr(raw, 'read'):
                raw = raw.read()
            elif not isinstance(raw, (bytes, bytearray)):
                raw = bytes(raw)
            if len(raw) != ENCODING_BYTES:
                continue

            stored = np.frombuffer(raw, dtype=np.float64)
            result = match_score(stored, current)

            if result['is_match'] and result['cosine_score'] > best_score:
                best_score = result['cosine_score']
                best = t

        if best:
            return {
                "identified": True,
                "userId": str(best['_id']),
                "teacherName": best.get('fullName'),
                "confidence": float(best_score)
            }
        return {"identified": False, "userId": None, "confidence": 0, "reason": "No match"}

    except Exception as e:
        logger.error(f"Identify error: {e}", exc_info=True)
        raise HTTPException(500, detail=str(e))


@app.get("/health")
def health_check():
    return {
        "status": "OK",
        "service": "Teacher Face Recognition (OpenCV SFace)",
        "opencvVersion": cv2.__version__,
        "embeddingDim": EMBEDDING_DIM,
        "cosineThreshold": COSINE_THRESHOLD,
        "timestamp": time.time()
    }



# ==================== WEBSOCKET LIVE DETECTION ====================
# Returns JSON with face bounding-box coords + identity.
# The browser draws boxes on a canvas overlay — video is always smooth 30fps.

@app.websocket("/ws/live-detect")
async def ws_live_detect(websocket: WebSocket):
    """
    Real-time face detection + recognition over WebSocket.
    Client sends: raw JPEG bytes  (~10-15 fps)
    Server returns JSON:
    {
      "faceBoxes": [{"x":int,"y":int,"w":int,"h":int,"conf":float}, ...],
      "frameW": int, "frameH": int,
      "identified": bool,
      "userId": str|null,
      "teacherName": str|null,
      "confidence": float,
      "ts": float
    }
    The browser renders live <video> at 30fps and draws boxes on a
    transparent <canvas> overlay using the returned coordinates.
    """
    await websocket.accept()
    logger.info("WS /ws/live-detect connected")

    teacher_cache: list = []
    cache_ts: float = 0.0

    try:
        while True:
            try:
                raw_bytes = await websocket.receive_bytes()
            except WebSocketDisconnect:
                break

            # Decode JPEG → BGR
            try:
                arr = np.frombuffer(raw_bytes, np.uint8)
                bgr  = cv2.imdecode(arr, cv2.IMREAD_COLOR)
                if bgr is None or bgr.shape[0] < 32 or bgr.shape[1] < 32:
                    await websocket.send_json({"error": "bad frame"})
                    continue
                
                # Prevent bad allocation by limiting max dimensions
                max_dim = 800
                h, w = bgr.shape[:2]
                if max(h, w) > max_dim:
                    scale = max_dim / max(h, w)
                    bgr = cv2.resize(bgr, (int(w * scale), int(h * scale)))
                    
            except Exception:
                await websocket.send_json({"error": "decode error"})
                continue

            h_frame, w_frame = bgr.shape[:2]
            faces = detect_all_faces(bgr)

            # Build face-box list
            face_boxes = []
            if faces is not None:
                for f in faces:
                    face_boxes.append({
                        "x": int(f[0]), "y": int(f[1]),
                        "w": int(f[2]), "h": int(f[3]),
                        "conf": round(float(f[-1]), 3)
                    })

            # Identity lookup — identify EVERY detected face independently
            face_identities: list = []  # parallel to face_boxes

            if face_boxes:
                now = time.time()
                if now - cache_ts > 10:
                    teacher_cache = await db.teachers.find(
                        {"faceEncoding": {"$exists": True}}
                    ).to_list(500)
                    cache_ts = now
                    logger.info(f"Updated teacher_cache: {len(teacher_cache)} teachers loaded.")

                for face in faces:
                    try:
                        aligned  = face_recognizer.alignCrop(bgr, face)
                        cur_emb  = face_recognizer.feature(aligned).flatten().astype(np.float64)

                        per_best_score   = 0.0
                        per_second_score = 0.0
                        per_best_t       = None
                        per_best_l2      = 99.0

                        for t in teacher_cache:
                            raw = t.get("faceEncoding")
                            if raw is None:
                                continue
                            if hasattr(raw, "read"):
                                raw = raw.read()
                            elif not isinstance(raw, (bytes, bytearray)):
                                raw = bytes(raw)
                            if len(raw) != ENCODING_BYTES:
                                continue
                            stored = np.frombuffer(raw, dtype=np.float64)
                            r = match_score(stored, cur_emb)
                            if r["cosine_score"] > per_best_score:
                                per_second_score = per_best_score
                                per_best_score   = r["cosine_score"]
                                per_best_l2      = r["l2_distance"]
                                per_best_t       = t if r["is_match"] else None
                            elif r["cosine_score"] > per_second_score:
                                per_second_score = r["cosine_score"]

                        # Margin gate: reject if best and 2nd-best are too close
                        # Only apply margin if the second best score is somewhat competitive
                        margin = per_best_score - per_second_score
                        if per_best_t and margin < MIN_MARGIN and per_second_score > (COSINE_THRESHOLD - 0.05):
                            logger.debug(f"WS margin too small ({margin:.3f}) best={per_best_score:.3f} 2nd={per_second_score:.3f} — rejecting ambiguous match")
                            per_best_t = None

                        if per_best_t:
                            logger.info(f"Match found: {per_best_t.get('fullName')} (cos={per_best_score:.3f}, l2={per_best_l2:.3f})")
                            face_identities.append({
                                "identified":  True,
                                "userId":      str(per_best_t["_id"]),
                                "teacherName": per_best_t.get("fullName"),
                                "confidence":  round(float(per_best_score), 4),
                            })
                        else:
                            if per_best_score > 0:
                                logger.info(f"Unknown face: best_score={per_best_score:.3f}, l2={per_best_l2:.3f}")
                            face_identities.append({"identified": False, "userId": None, "teacherName": None, "confidence": 0.0})

                    except Exception as ex:
                        logger.debug(f"WS per-face identify error: {ex}")
                        face_identities.append({"identified": False, "userId": None, "teacherName": None, "confidence": 0.0})

            # ── Prevent duplicate identity in same frame ──
            assigned_uids = {}
            for idx, fi in enumerate(face_identities):
                if fi["identified"]:
                    uid = fi["userId"]
                    if uid not in assigned_uids or fi["confidence"] > face_identities[assigned_uids[uid]]["confidence"]:
                        assigned_uids[uid] = idx

            for idx, fi in enumerate(face_identities):
                if fi["identified"] and assigned_uids[fi["userId"]] != idx:
                    fi["identified"] = False
                    fi["userId"] = None
                    fi["teacherName"] = None

            # Legacy single-identity fields (first identified face, for back-compat)
            identity: dict = {"identified": False, "userId": None, "teacherName": None, "confidence": 0.0}
            for fi in face_identities:
                if fi["identified"]:
                    identity = fi
                    break

            await websocket.send_json({
                "faceBoxes":      face_boxes,
                "faceIdentities": face_identities,
                "frameW":         w_frame,
                "frameH":         h_frame,
                "ts":             time.time(),
                **identity,
            })


    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"WS error: {e}", exc_info=True)
    finally:
        logger.info("WS /ws/live-detect disconnected")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
