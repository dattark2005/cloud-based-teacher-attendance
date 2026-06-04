const express = require('express');
const router = express.Router();
const { checkIn, checkOut, getTodayStatus, getHistory, getAllAttendance, cameraScan, voiceCheckIn, getAdminTeacherHistory } = require('../controllers/attendanceController');
const { authenticate, authorizeAdmin } = require('../middleware/auth');

// Camera scan (public — used by entrance camera kiosk)
router.post('/camera-scan', cameraScan);

// All other routes require auth
router.use(authenticate);

// GET /api/attendance/today
router.get('/today', getTodayStatus);

// GET /api/attendance/history
router.get('/history', getHistory);

// GET /api/attendance/all?date=YYYY-MM-DD
router.get('/all', authorizeAdmin, getAllAttendance);

// GET /api/attendance/admin/teacher/:id/history
router.get('/admin/teacher/:id/history', authorizeAdmin, getAdminTeacherHistory);

// POST /api/attendance/check-in
router.post('/check-in', checkIn);

// POST /api/attendance/check-out
router.post('/check-out', checkOut);

// POST /api/attendance/voice-checkin
router.post('/voice-checkin', voiceCheckIn);

module.exports = router;
