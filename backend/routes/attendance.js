const express = require('express');
const router = express.Router();
const { checkIn, checkOut, getTodayStatus, getHistory, getAllAttendance, cameraScan, getTeacherLogsToday } = require('../controllers/attendanceController');
const { authenticate } = require('../middleware/auth');

// Camera scan (public — used by entrance camera kiosk)
router.post('/camera-scan', cameraScan);

// Teacher gate logs (public — used by scanner kiosk to show per-teacher movement)
router.get('/teacher-logs/:teacherId', getTeacherLogsToday);

// All other routes require auth
router.use(authenticate);

// GET /api/attendance/today
router.get('/today', getTodayStatus);

// GET /api/attendance/history
router.get('/history', getHistory);

// GET /api/attendance/all?date=YYYY-MM-DD
router.get('/all', getAllAttendance);

// POST /api/attendance/check-in
router.post('/check-in', checkIn);

// POST /api/attendance/check-out
router.post('/check-out', checkOut);

module.exports = router;
