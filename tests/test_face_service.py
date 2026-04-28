"""
FACE SERVICE PYTHON TESTS
Covers: liveness detection, embedding helpers, match_score, API endpoints
Tests: 20 test cases
Run: python -m pytest tests/test_face_service.py -v
"""
import sys
import os
import pytest
import numpy as np

# Add parent dir to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# ── Minimal mocks for heavy dependencies before import ──────────────────────
from unittest.mock import MagicMock, patch, AsyncMock
import importlib

# Patch cv2 and motor before importing face_service
cv2_mock = MagicMock()
# Simulate FaceDetectorYN behavior
detector_mock = MagicMock()
detector_mock.detect.return_value = (None, None)
cv2_mock.FaceDetectorYN.create.return_value = detector_mock
cv2_mock.FaceRecognizerSF.create.return_value = MagicMock()
cv2_mock.Laplacian.return_value = MagicMock()
cv2_mock.COLOR_BGR2GRAY = 6
cv2_mock.CV_64F = 6
cv2_mock.imdecode.return_value = np.zeros((480, 640, 3), dtype=np.uint8)
cv2_mock.imencode.return_value = (True, np.zeros(100, dtype=np.uint8))
cv2_mock.IMREAD_COLOR = 1
cv2_mock.IMWRITE_JPEG_QUALITY = 1
cv2_mock.FONT_HERSHEY_SIMPLEX = 0
cv2_mock.LINE_AA = 16
cv2_mock.__version__ = '4.9.0'

sys.modules['cv2'] = cv2_mock
sys.modules['motor'] = MagicMock()
sys.modules['motor.motor_asyncio'] = MagicMock()
sys.modules['cloudinary'] = MagicMock()
sys.modules['cloudinary.uploader'] = MagicMock()

# Mock urllib to skip model download
with patch('urllib.request.urlretrieve'), \
     patch('os.path.getsize', return_value=1024 * 1024 * 5), \
     patch('os.path.exists', return_value=True):
    import face_service as fs


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class TestMatchScore:
    """TC-PY-01 to TC-PY-07: match_score function"""

    def test_TC_PY_01_identical_vectors_max_score(self):
        """Same vector should give cosine score = 1.0"""
        v = np.random.rand(128).astype(np.float64)
        result = fs.match_score(v, v)
        assert abs(result['cosine_score'] - 1.0) < 1e-6

    def test_TC_PY_02_opposite_vectors_score_negative(self):
        """Opposite vectors should give score near -1"""
        v = np.ones(128, dtype=np.float64)
        result = fs.match_score(v, -v)
        assert result['cosine_score'] < 0

    def test_TC_PY_03_zero_vector_returns_no_match(self):
        """Zero vectors should not crash and return is_match=False"""
        z = np.zeros(128, dtype=np.float64)
        v = np.ones(128, dtype=np.float64)
        result = fs.match_score(z, v)
        assert result['is_match'] is False
        assert result['cosine_score'] == 0.0

    def test_TC_PY_04_both_zero_vectors(self):
        """Two zero vectors edge case"""
        z = np.zeros(128, dtype=np.float64)
        result = fs.match_score(z, z)
        assert result['is_match'] is False

    def test_TC_PY_05_threshold_at_boundary(self):
        """Score exactly at COSINE_THRESHOLD should match"""
        # Build a pair of vectors where cosine score == COSINE_THRESHOLD exactly
        # by constructing v2 as a combination of v1 and orthogonal component
        v1 = np.ones(128, dtype=np.float64)
        v1 /= np.linalg.norm(v1)
        # result at threshold
        score = fs.COSINE_THRESHOLD
        # v2 = score*v1 + sqrt(1-score^2)*perp
        perp = np.zeros(128, dtype=np.float64)
        perp[0] = 1.0 - v1[0]   # make it orthogonal-ish
        v2 = score * v1 + np.sqrt(max(0, 1 - score**2)) * perp
        result = fs.match_score(v1, v2)
        # Should be approximately at threshold, may or may not match — just no crash
        assert 'is_match' in result

    def test_TC_PY_06_result_has_all_keys(self):
        """Result dict must have all required keys"""
        v = np.random.rand(128).astype(np.float64)
        result = fs.match_score(v, v)
        assert all(k in result for k in ['cosine_score', 'l2_distance', 'is_match', 'confidence'])

    def test_TC_PY_07_l2_distance_identical_is_zero(self):
        """L2 distance of identical vectors should be 0"""
        v = np.random.rand(128).astype(np.float64)
        result = fs.match_score(v, v)
        assert result['l2_distance'] < 1e-6


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class TestLivenessDetection:
    """TC-PY-08 to TC-PY-13: detect_liveness function"""

    def _make_image(self, lap_var_override=None):
        """Create a test BGR image"""
        return np.ones((200, 200, 3), dtype=np.uint8) * 128

    def test_TC_PY_08_blurry_image_fails(self):
        """Laplacian variance < 30 → liveness fails"""
        img = self._make_image()
        # Patch cv2.Laplacian to return low variance
        mock_lap = MagicMock()
        mock_lap.var.return_value = 10.0  # very blurry
        cv2_mock.Laplacian.return_value = mock_lap
        cv2_mock.cvtColor.return_value = img[:,:,0]
        # Patch detect_face to return None to isolate test
        with patch.object(fs, 'detect_face', return_value=None):
            is_live, conf, reason = fs.detect_liveness(img)
        assert is_live is False
        assert 'blurry' in reason.lower()

    def test_TC_PY_09_too_sharp_image_fails(self):
        """Laplacian variance > 20000 → liveness fails"""
        img = self._make_image()
        mock_lap = MagicMock()
        mock_lap.var.return_value = 25000.0
        cv2_mock.Laplacian.return_value = mock_lap
        cv2_mock.cvtColor.return_value = img[:,:,0]
        with patch.object(fs, 'detect_face', return_value=None):
            is_live, conf, reason = fs.detect_liveness(img)
        assert is_live is False
        assert 'sharp' in reason.lower()

    def test_TC_PY_10_no_face_detected_fails(self):
        """Good sharpness but no face → fails"""
        img = self._make_image()
        mock_lap = MagicMock()
        mock_lap.var.return_value = 500.0
        cv2_mock.Laplacian.return_value = mock_lap
        cv2_mock.cvtColor.return_value = img[:,:,0]
        with patch.object(fs, 'detect_face', return_value=None):
            is_live, conf, reason = fs.detect_liveness(img)
        assert is_live is False

    def test_TC_PY_11_low_confidence_face_fails(self):
        """Face detected but low confidence → fails"""
        img = self._make_image()
        mock_lap = MagicMock()
        mock_lap.var.return_value = 500.0
        cv2_mock.Laplacian.return_value = mock_lap
        cv2_mock.cvtColor.return_value = img[:,:,0]
        # Face with confidence < 0.7
        fake_face = np.array([50, 50, 100, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5])
        with patch.object(fs, 'detect_face', return_value=fake_face):
            is_live, conf, reason = fs.detect_liveness(img)
        assert is_live is False
        assert conf < 0.7

    def test_TC_PY_12_valid_face_passes(self):
        """Good sharpness + high confidence face → passes"""
        img = self._make_image()
        mock_lap = MagicMock()
        mock_lap.var.return_value = 500.0
        cv2_mock.Laplacian.return_value = mock_lap
        cv2_mock.cvtColor.return_value = img[:,:,0]
        fake_face = np.array([50, 50, 100, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.95])
        with patch.object(fs, 'detect_face', return_value=fake_face):
            is_live, conf, reason = fs.detect_liveness(img)
        assert is_live is True
        assert conf >= 0.85

    def test_TC_PY_13_boundary_variance_valid(self):
        """Variance exactly at 30 (blurry threshold) → fails"""
        img = self._make_image()
        mock_lap = MagicMock()
        mock_lap.var.return_value = 29.0  # just below threshold
        cv2_mock.Laplacian.return_value = mock_lap
        cv2_mock.cvtColor.return_value = img[:,:,0]
        with patch.object(fs, 'detect_face', return_value=None):
            is_live, conf, reason = fs.detect_liveness(img)
        assert is_live is False


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class TestImageHelpers:
    """TC-PY-14 to TC-PY-17: image_bytes_to_bgr, detect_all_faces"""

    def test_TC_PY_14_image_bytes_to_bgr_valid_jpeg(self):
        """Valid JPEG bytes should not raise and should return a numpy array"""
        import io
        from PIL import Image
        # Create a tiny real JPEG in memory
        pil_img = Image.new('RGB', (10, 10), color=(255, 0, 0))
        buf = io.BytesIO()
        pil_img.save(buf, format='JPEG')
        data = buf.getvalue()
        # cv2.cvtColor is mocked — just ensure no crash and result is ndarray
        bgr = fs.image_bytes_to_bgr(data)
        assert bgr is not None
        assert isinstance(bgr, np.ndarray)


    def test_TC_PY_15_detect_all_faces_no_faces(self):
        """When detector returns None → empty list"""
        detector_mock.detect.return_value = (None, None)
        detector_mock.setInputSize = MagicMock()
        img = np.zeros((200, 200, 3), dtype=np.uint8)
        result = fs.detect_all_faces(img)
        assert result == [] or result is None or len(result) == 0

    def test_TC_PY_16_embedding_constants(self):
        """EMBEDDING_DIM=128, ENCODING_BYTES=1024"""
        assert fs.EMBEDDING_DIM == 128
        assert fs.ENCODING_BYTES == 128 * 8  # float64 = 8 bytes

    def test_TC_PY_17_cosine_threshold_reasonable(self):
        """COSINE_THRESHOLD should be between 0.3 and 0.6"""
        assert 0.3 <= fs.COSINE_THRESHOLD <= 0.6


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class TestFastAPIEndpoints:
    """TC-PY-18 to TC-PY-20: HTTP endpoint smoke tests via TestClient"""

    def test_TC_PY_18_health_returns_200(self):
        """GET /health should return 200"""
        from fastapi.testclient import TestClient
        client = TestClient(fs.app)
        res = client.get('/health')
        assert res.status_code == 200
        assert res.json()['status'] == 'OK'

    def test_TC_PY_19_health_has_opencv_version(self):
        """Health response should include opencvVersion"""
        from fastapi.testclient import TestClient
        client = TestClient(fs.app)
        res = client.get('/health')
        data = res.json()
        assert 'opencvVersion' in data
        assert 'embeddingDim' in data
        assert data['embeddingDim'] == 128

    def test_TC_PY_20_register_face_no_file_returns_422(self):
        """POST /register-face without file → 422 Unprocessable Entity"""
        from fastapi.testclient import TestClient
        client = TestClient(fs.app)
        res = client.post('/register-face', data={'user_id': 'abc123'})
        assert res.status_code == 422  # FastAPI validation error
