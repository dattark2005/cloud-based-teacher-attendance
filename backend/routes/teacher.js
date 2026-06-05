const express = require('express');
const router = express.Router();
const { registerFace, getProfile, getAllTeachers, updateProfile, changePassword, createBiometricLog, getBiometricLogs, deleteFace, deleteVoice } = require('../controllers/teacherController');
const { authenticate } = require('../middleware/auth');

// All require auth
router.use(authenticate);

// GET /api/teachers/profile
router.get('/profile', getProfile);

// PUT /api/teachers/profile
router.put('/profile', updateProfile);

// PUT /api/teachers/change-password
router.put('/change-password', changePassword);

// GET /api/teachers
router.get('/', getAllTeachers);

// POST /api/teachers/register-face
router.post('/register-face', registerFace);

// DELETE /api/teachers/face
router.delete('/face', deleteFace);

// DELETE /api/teachers/voice
router.delete('/voice', deleteVoice);

// POST /api/teachers/biometric-log
router.post('/biometric-log', createBiometricLog);

// GET /api/teachers/biometric-logs
router.get('/biometric-logs', getBiometricLogs);

module.exports = router;
