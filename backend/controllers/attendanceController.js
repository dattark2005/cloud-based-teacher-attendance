const AttendanceLog = require('../models/AttendanceLog');
const Teacher = require('../models/Teacher');
const axios = require('axios');
const FormData = require('form-data');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const FACE_SERVICE_URL = process.env.FACE_SERVICE_URL || 'http://localhost:8000';

function getTodayDateString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// ─── SESSION HELPERS ──────────────────────────────────────────────────────────

/** Returns the currently open session (cabinOutTime === null), or null. */
function getOpenSession(logDoc) {
  if (!logDoc || !logDoc.sessions.length) return null;
  return logDoc.sessions.find(s => !s.cabinOutTime) || null;
}

/**
 * For a given session, what is the teacher's current gate state?
 * Returns 'IN' (in cabin / returned) or 'OUT' (left via gate, not yet back).
 */
function gateState(session) {
  if (!session.movements.length) return 'IN'; // just cabin-checked-in
  const last = session.movements[session.movements.length - 1];
  return last.type === 'GATE_OUT' ? 'OUT' : 'IN';
}

// ─── CORE SCAN EVENT HANDLER ──────────────────────────────────────────────────

/**
 * Handles CABIN_IN / CABIN_OUT / GATE_OUT / GATE_IN events.
 * Returns { autoCheckedIn: bool, reason: string }.
 */
async function handleScanEvent(teacher, type, confidence, io) {
  const today = getTodayDateString();
  const now   = new Date();

  let logDoc = await AttendanceLog.findOne({ teacherId: teacher._id, date: today });
  if (!logDoc) {
    logDoc = new AttendanceLog({
      teacherId: teacher._id,
      date:      today,
      status:    'ABSENT',
      sessions:  [],
    });
  } else {
    // Normalize legacy status fields (old docs may have 'LATE' which was removed)
    if (logDoc.status === 'LATE') logDoc.status = 'PRESENT';
    // Also fix any sessions that still carry 'LATE' (same migration)
    for (const s of logDoc.sessions) {
      if (s.status === 'LATE') s.status = 'PRESENT';
    }
  }

  let autoCheckedIn = false;
  let reason        = '';

  switch (type) {

    // ── Cabin Check-In — start a new session ────────────────────────────────
    case 'CABIN_IN': {
      const open = getOpenSession(logDoc);
      if (open) {
        reason = 'Session already open — please check out first';
        break;
      }
      const sessionStatus = 'PRESENT';

      logDoc.sessions.push({
        cabinInTime:  now,
        cabinOutTime: null,
        status:       sessionStatus,
        confidence:   confidence || null,
        movements:    [],
      });

      // Update top-level convenience fields
      if (!logDoc.checkInTime) {
        logDoc.checkInTime  = now;
        logDoc.status       = sessionStatus;
        logDoc.confidenceScore = confidence || null;
        logDoc.verificationMethod = 'FACE';
      }

      autoCheckedIn = true;
      reason        = 'Cabin session started';

      if (io) io.emit('attendance:checkin', {
        teacherId:   teacher._id.toString(),
        teacherName: teacher.fullName,
        timestamp:   now,
        status:      sessionStatus,
        confidence,
      });
      break;
    }

    // ── Cabin Check-Out — close the open session ─────────────────────────────
    case 'CABIN_OUT': {
      const open = getOpenSession(logDoc);
      if (!open) {
        reason = 'No open session — please check in first';
        break;
      }
      // Cannot check out while outside via gate
      if (gateState(open) === 'OUT') {
        reason = 'Teacher is currently outside (gate OUT pending) — return via gate first';
        break;
      }
      open.cabinOutTime = now;
      logDoc.checkOutTime = now;  // update convenience field

      autoCheckedIn = true;
      reason        = 'Cabin session closed';

      if (io) io.emit('attendance:checkout', {
        teacherId:   teacher._id.toString(),
        teacherName: teacher.fullName,
        timestamp:   now,
      });
      break;
    }

    // ── Gate OUT — teacher leaving campus temporarily ────────────────────────
    case 'GATE_OUT': {
      const open = getOpenSession(logDoc);
      if (!open) {
        reason = 'No open cabin session — GATE_OUT ignored';
        break;
      }
      if (gateState(open) === 'OUT') {
        reason = 'Already logged as outside — duplicate GATE_OUT ignored';
        break;
      }
      open.movements.push({ type: 'GATE_OUT', timestamp: now, confidence: confidence || null });
      autoCheckedIn = true;
      reason        = 'Gate OUT recorded';
      break;
    }

    // ── Gate IN — teacher returning to campus ────────────────────────────────
    case 'GATE_IN': {
      const open = getOpenSession(logDoc);
      if (!open) {
        reason = 'No open cabin session — GATE_IN ignored';
        break;
      }
      if (gateState(open) === 'IN') {
        reason = 'Not logged as outside — GATE_IN ignored';
        break;
      }
      open.movements.push({ type: 'GATE_IN', timestamp: now, confidence: confidence || null });
      autoCheckedIn = true;
      reason        = 'Gate IN recorded';
      break;
    }

    default:
      reason = `Unknown event type: ${type}`;
  }

  if (autoCheckedIn) {
    await logDoc.save();
  }

  return { autoCheckedIn, reason };
}

// ─── CHECK-IN (profile page / manual) ────────────────────────────────────────

// POST /api/attendance/check-in
const checkIn = async (req, res, next) => {
  try {
    const teacherId = req.teacher._id;
    const { faceImage, location = 'Admin Cabin' } = req.body;

    if (!faceImage) {
      return res.status(400).json({ success: false, message: 'Face image is required' });
    }

    // Verify face
    const teacher = await Teacher.findById(teacherId).select('+faceEncoding +faceImageData');
    if (!teacher || (!teacher.faceEncoding && !teacher.faceImageData)) {
      return res.status(400).json({
        success: false,
        message: 'Face not registered. Please register your face first.',
        data: { faceNotRegistered: true },
      });
    }

    const imageBuffer = Buffer.from(faceImage.replace(/^data:image\/\w+;base64,/, ''), 'base64');
    let confidenceScore = null;
    let snapshotUrl = null;

    try {
      const formData = new FormData();
      formData.append('user_id', teacherId.toString());
      formData.append('file', imageBuffer, { filename: 'verify.jpg', contentType: 'image/jpeg' });
      const pyRes = await axios.post(`${FACE_SERVICE_URL}/verify-face`, formData, {
        headers: formData.getHeaders(), timeout: 20000,
      });
      if (!pyRes.data.verified) {
        return res.status(401).json({
          success: false,
          message: '❌ Face not recognised. Try in better lighting.',
          data: { confidence: pyRes.data.confidence },
        });
      }
      confidenceScore = pyRes.data.confidence;
      snapshotUrl = pyRes.data.verificationImageUrl || null;
    } catch {
      console.warn('⚠️  Face service unavailable — proceeding');
    }

    const io = req.app.get('io');
    const { autoCheckedIn, reason } = await handleScanEvent(teacher, 'CABIN_IN', confidenceScore, io);

    const today  = getTodayDateString();
    const logDoc = await AttendanceLog.findOne({ teacherId, date: today });

    if (!autoCheckedIn) {
      return res.status(400).json({ success: false, message: reason, data: { log: logDoc } });
    }

    res.json({
      success: true,
      message: `✅ Checked in — ${reason}`,
      data: { log: logDoc, confidence: confidenceScore, snapshotUrl },
    });
  } catch (err) { next(err); }
};

// ─── CHECK-OUT (profile page / manual) ───────────────────────────────────────

// POST /api/attendance/check-out
const checkOut = async (req, res, next) => {
  try {
    const teacherId = req.teacher._id;
    const { faceImage } = req.body;

    if (!faceImage) {
      return res.status(400).json({ success: false, message: 'Face image is required' });
    }

    const imageBuffer = Buffer.from(faceImage.replace(/^data:image\/\w+;base64,/, ''), 'base64');
    let confidenceScore = null;

    try {
      const formData = new FormData();
      formData.append('user_id', teacherId.toString());
      formData.append('file', imageBuffer, { filename: 'verify.jpg', contentType: 'image/jpeg' });
      const pyRes = await axios.post(`${FACE_SERVICE_URL}/verify-face`, formData, {
        headers: formData.getHeaders(), timeout: 20000,
      });
      if (!pyRes.data.verified) {
        return res.status(401).json({
          success: false,
          message: '❌ Face not recognised for check-out.',
          data: { confidence: pyRes.data.confidence },
        });
      }
      confidenceScore = pyRes.data.confidence;
    } catch {
      console.warn('⚠️  Face service unavailable — proceeding');
    }

    const teacher = await Teacher.findById(teacherId).select('fullName');
    const io      = req.app.get('io');
    const { autoCheckedIn, reason } = await handleScanEvent(teacher, 'CABIN_OUT', confidenceScore, io);

    const today  = getTodayDateString();
    const logDoc = await AttendanceLog.findOne({ teacherId, date: today });

    if (!autoCheckedIn) {
      return res.status(400).json({ success: false, message: reason, data: { log: logDoc } });
    }

    res.json({
      success: true,
      message: `✅ Checked out — ${reason}`,
      data: { log: logDoc, checkOutTime: logDoc.checkOutTime },
    });
  } catch (err) { next(err); }
};

// ─── TODAY STATUS ─────────────────────────────────────────────────────────────

// GET /api/attendance/today
const getTodayStatus = async (req, res, next) => {
  try {
    const teacherId = req.teacher._id;
    const today     = getTodayDateString();
    const log       = await AttendanceLog.findOne({ teacherId, date: today })
                        .populate('teacherId', 'fullName employeeId');
    res.json({ success: true, data: { log, today } });
  } catch (err) { next(err); }
};

// ─── MY ATTENDANCE HISTORY ────────────────────────────────────────────────────

// GET /api/attendance/history
const getHistory = async (req, res, next) => {
  try {
    const teacherId = req.teacher._id;
    const limit     = parseInt(req.query.limit) || 30;
    const page      = parseInt(req.query.page)  || 1;
    const skip      = (page - 1) * limit;

    const [logs, total, allLogs] = await Promise.all([
      AttendanceLog.find({ teacherId }).sort({ date: -1 }).skip(skip).limit(limit),
      AttendanceLog.countDocuments({ teacherId }),
      AttendanceLog.find({ teacherId }, 'status'),
    ]);

    const present = allLogs.filter(l => l.status === 'PRESENT').length;
    const absent  = total - present;

    res.json({
      success: true,
      data: {
        logs,
        stats: { total, present, absent: Math.max(0, absent) },
        pagination: { page, limit, totalDocs: total, totalPages: Math.ceil(total / limit) },
      },
    });
  } catch (err) { next(err); }
};

// ─── ADMIN: ALL ATTENDANCE ────────────────────────────────────────────────────

// GET /api/attendance/all?date=YYYY-MM-DD
const getAllAttendance = async (req, res, next) => {
  try {
    const { date = getTodayDateString() } = req.query;
    const logs     = await AttendanceLog.find({ date }).populate('teacherId', 'fullName employeeId department');
    const teachers = await Teacher.find({ isActive: true, role: 'TEACHER' }, 'fullName employeeId department');

    const presentIds   = new Set(logs.filter(l => l.teacherId).map(l => l.teacherId._id.toString()));
    const absentTeachers = teachers.filter(t => !presentIds.has(t._id.toString()));

    res.json({
      success: true,
      data: {
        date,
        logs,
        absent: absentTeachers,
        summary: {
          present: logs.filter(l => l.status === 'PRESENT').length,
          absent:  absentTeachers.length,
          total:   teachers.length,
        },
      },
    });
  } catch (err) { next(err); }
};

// ─── CAMERA SCAN (WS-identified teacher) ─────────────────────────────────────

// POST /api/attendance/camera-scan
const cameraScan = async (req, res, next) => {
  try {
    const { faceImage, userId: directUserId, type = 'CABIN_IN' } = req.body;
    const io = req.app.get('io');

    // ── Path A: WS live-detect already identified teacher ──
    if (directUserId && !faceImage) {
      const teacher = await Teacher.findById(directUserId).select('fullName employeeId department faceImageUrl');
      if (!teacher) {
        return res.status(404).json({ success: false, message: 'Teacher not found' });
      }

      const { autoCheckedIn, reason } = await handleScanEvent(teacher, type, null, io);

      return res.json({
        success: true,
        data: {
          identified: true,
          teacher:    { id: teacher._id, fullName: teacher.fullName, employeeId: teacher.employeeId, department: teacher.department },
          confidence: null,
          autoCheckedIn,
          reason,
        },
      });
    }

    // ── Path B: Legacy — base64 faceImage, identify via Python ──
    if (!faceImage) {
      return res.status(400).json({ success: false, message: 'Either faceImage or userId is required' });
    }

    const imageBuffer = Buffer.from(faceImage.replace(/^data:image\/\w+;base64,/, ''), 'base64');
    const formData    = new FormData();
    formData.append('file', imageBuffer, { filename: 'frame.jpg', contentType: 'image/jpeg' });

    let identified = false;
    let teacher    = null;
    let confidence = 0;

    try {
      const pyRes = await axios.post(`${FACE_SERVICE_URL}/identify-face`, formData, {
        headers: formData.getHeaders(), timeout: 15000,
      });
      if (pyRes.data.identified) {
        identified = true;
        confidence = pyRes.data.confidence;
        teacher    = await Teacher.findById(pyRes.data.userId).select('fullName employeeId department faceImageUrl');
      }
    } catch {
      return res.json({ success: true, data: { identified: false, reason: 'Face service unavailable' } });
    }

    if (!identified || !teacher) {
      return res.json({ success: true, data: { identified: false, reason: 'No match found' } });
    }

    const { autoCheckedIn, reason } = await handleScanEvent(teacher, type, confidence, io);

    res.json({
      success: true,
      data: {
        identified: true,
        teacher:    { id: teacher._id, fullName: teacher.fullName, employeeId: teacher.employeeId, department: teacher.department },
        confidence,
        autoCheckedIn,
        reason,
      },
    });
  } catch (err) { next(err); }
};

// ─── TEACHER GATE LOGS (sessions, for scanner panel) ─────────────────────────

// GET /api/attendance/teacher-logs/:teacherId?date=YYYY-MM-DD
const getTeacherLogsToday = async (req, res, next) => {
  try {
    const { teacherId } = req.params;
    const { date = getTodayDateString() } = req.query;

    const log = await AttendanceLog.findOne({ teacherId, date })
                  .populate('teacherId', 'fullName employeeId department');

    if (!log) {
      return res.json({ success: true, data: { sessions: [], teacher: null, status: 'ABSENT' } });
    }

    // Enrich sessions with derived state info
    const enriched = log.sessions.map(s => ({
      _id:          s._id,
      cabinInTime:  s.cabinInTime,
      cabinOutTime: s.cabinOutTime,
      isOpen:       !s.cabinOutTime,
      status:       s.status,
      confidence:   s.confidence,
      currentGateState: gateState(s),        // 'IN' or 'OUT'
      movements:    s.movements.map(m => ({
        type:      m.type,
        timestamp: m.timestamp,
      })),
    }));

    res.json({
      success: true,
      data: {
        teacher:      log.teacherId,
        date:         log.date,
        status:       log.status,
        checkInTime:  log.checkInTime,
        checkOutTime: log.checkOutTime,
        sessions:     enriched,
        openSession:  enriched.find(s => s.isOpen) || null,
      },
    });
  } catch (err) { next(err); }
};

module.exports = { checkIn, checkOut, getTodayStatus, getHistory, getAllAttendance, cameraScan, getTeacherLogsToday };
