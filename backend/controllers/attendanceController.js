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

// ─── CHECK-IN ─────────────────────────────────────────────────────────────────

// POST /api/attendance/check-in
const checkIn = async (req, res, next) => {
  try {
    const teacherId = req.teacher._id;
    const { faceImage, location = 'Campus Entrance' } = req.body;

    if (!faceImage) {
      return res.status(400).json({ success: false, message: 'Face image is required' });
    }

    const today = getTodayDateString();

    // Check if already checked in
    const existing = await AttendanceLog.findOne({ teacherId, date: today });
    if (existing && existing.checkInTime) {
      return res.status(400).json({
        success: false,
        message: 'Already checked in for today',
        data: { log: existing },
      });
    }

    // Verify face with Python service
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
    let verificationMethod = 'FACE_LOCAL';
    let snapshotUrl = null;

    try {
      const formData = new FormData();
      formData.append('user_id', teacherId.toString());
      formData.append('file', imageBuffer, { filename: 'verify.jpg', contentType: 'image/jpeg' });

      const pyRes = await axios.post(`${FACE_SERVICE_URL}/verify-face`, formData, {
        headers: formData.getHeaders(),
        timeout: 20000,
      });

      if (!pyRes.data.verified) {
        return res.status(401).json({
          success: false,
          message: '❌ Face not recognised. Please try again in good lighting.',
          data: { confidence: pyRes.data.confidence },
        });
      }

      confidenceScore = pyRes.data.confidence;
      verificationMethod = 'FACE';
      snapshotUrl = pyRes.data.verificationImageUrl || null;
    } catch (serviceErr) {
      console.warn('⚠️  Face service unavailable — fallback check-in');
      // Upload snapshot to Cloudinary as record
      try {
        const uploadRes = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: 'teacher_attendance/checkins', public_id: `checkin_${teacherId}_${Date.now()}` },
            (err, res) => (err ? reject(err) : resolve(res))
          );
          require('stream').Readable.from(imageBuffer).pipe(stream);
        });
        snapshotUrl = uploadRes.secure_url;
      } catch (_) {}
    }

    // Determine status — LATE if after 9:30 AM
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const isLate = hours > 9 || (hours === 9 && minutes > 30);

    const logEntry = {
      event: 'CHECK_IN',
      timestamp: now,
      confidence: confidenceScore,
      snapshotUrl,
    };

    let log;
    if (existing) {
      // Already has a record (e.g. from a previous session), update it
      existing.checkInTime = now;
      existing.status = isLate ? 'LATE' : 'PRESENT';
      existing.confidenceScore = confidenceScore;
      existing.verificationMethod = verificationMethod;
      existing.snapshotUrl = snapshotUrl;
      existing.location = location;
      existing.logs.push(logEntry);
      log = await existing.save();
    } else {
      log = await AttendanceLog.create({
        teacherId,
        date: today,
        checkInTime: now,
        status: isLate ? 'LATE' : 'PRESENT',
        verificationMethod,
        confidenceScore,
        snapshotUrl,
        location,
        logs: [logEntry],
      });
    }

    // Broadcast to socket clients
    const io = req.app.get('io');
    if (io) {
      io.emit('attendance:checkin', {
        teacherId: teacherId.toString(),
        teacherName: teacher.fullName,
        timestamp: now,
        status: log.status,
      });
    }

    res.json({
      success: true,
      message: `✅ Check-in successful! ${isLate ? '(Late)' : 'On time'}`,
      data: {
        log,
        confidence: confidenceScore,
        status: log.status,
        checkInTime: log.checkInTime,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── CHECK-OUT ────────────────────────────────────────────────────────────────

// POST /api/attendance/check-out
const checkOut = async (req, res, next) => {
  try {
    const teacherId = req.teacher._id;
    const { faceImage, location = 'Campus Exit' } = req.body;

    if (!faceImage) {
      return res.status(400).json({ success: false, message: 'Face image is required' });
    }

    const today = getTodayDateString();
    const existing = await AttendanceLog.findOne({ teacherId, date: today });

    if (!existing || !existing.checkInTime) {
      return res.status(400).json({ success: false, message: 'No check-in found for today. Please check in first.' });
    }
    if (existing.checkOutTime) {
      return res.status(400).json({ success: false, message: 'Already checked out for today', data: { log: existing } });
    }

    const imageBuffer = Buffer.from(faceImage.replace(/^data:image\/\w+;base64,/, ''), 'base64');
    let confidenceScore = null;
    let snapshotUrl = null;

    try {
      const formData = new FormData();
      formData.append('user_id', teacherId.toString());
      formData.append('file', imageBuffer, { filename: 'verify.jpg', contentType: 'image/jpeg' });
      const pyRes = await axios.post(`${FACE_SERVICE_URL}/verify-face`, formData, {
        headers: formData.getHeaders(),
        timeout: 20000,
      });
      if (!pyRes.data.verified) {
        return res.status(401).json({
          success: false,
          message: '❌ Face not recognised for check-out.',
          data: { confidence: pyRes.data.confidence },
        });
      }
      confidenceScore = pyRes.data.confidence;
      snapshotUrl = pyRes.data.verificationImageUrl || null;
    } catch (err) {
      console.warn('⚠️  Face service unavailable — fallback check-out');
    }

    const now = new Date();
    existing.checkOutTime = now;
    existing.logs.push({ event: 'CHECK_OUT', timestamp: now, confidence: confidenceScore, snapshotUrl });
    await existing.save();

    const io = req.app.get('io');
    if (io) io.emit('attendance:checkout', { teacherId: teacherId.toString(), timestamp: now });

    res.json({
      success: true,
      message: '✅ Check-out recorded successfully',
      data: { log: existing, checkOutTime: now },
    });
  } catch (err) {
    next(err);
  }
};

// ─── TODAY STATUS ─────────────────────────────────────────────────────────────

// GET /api/attendance/today
const getTodayStatus = async (req, res, next) => {
  try {
    const teacherId = req.teacher._id;
    const today = getTodayDateString();
    const log = await AttendanceLog.findOne({ teacherId, date: today }).populate('teacherId', 'fullName employeeId');
    res.json({ success: true, data: { log, today } });
  } catch (err) {
    next(err);
  }
};

// ─── MY ATTENDANCE HISTORY ────────────────────────────────────────────────────

// GET /api/attendance/history
const getHistory = async (req, res, next) => {
  try {
    const teacherId = req.teacher._id;
    const limit = parseInt(req.query.limit) || 30;
    const page  = parseInt(req.query.page)  || 1;
    const skip  = (page - 1) * limit;

    const [logs, total, allLogs] = await Promise.all([
      AttendanceLog.find({ teacherId })
        .sort({ date: -1 })
        .skip(skip)
        .limit(limit),
      AttendanceLog.countDocuments({ teacherId }),
      // Fetch all to compute accurate present/late totals
      AttendanceLog.find({ teacherId }, 'status'),
    ]);

    const present = allLogs.filter(l => l.status === 'PRESENT').length;
    const late    = allLogs.filter(l => l.status === 'LATE').length;
    const absent  = total - present - late;

    res.json({
      success: true,
      data: {
        logs,
        stats: { total, present, late, absent: Math.max(0, absent) },
        pagination: { page, limit, totalDocs: total, totalPages: Math.ceil(total / limit) },
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── ADMIN: ALL ATTENDANCE ────────────────────────────────────────────────────

// GET /api/attendance/all?date=YYYY-MM-DD
const getAllAttendance = async (req, res, next) => {
  try {
    const { date = getTodayDateString() } = req.query;
    const logs = await AttendanceLog.find({ date }).populate('teacherId', 'fullName employeeId department');
    const teachers = await Teacher.find({ isActive: true }, 'fullName employeeId department');

    // Find absent teachers (no log for this date) — guard against null populate
    const presentIds = new Set(logs.filter(l => l.teacherId).map(l => l.teacherId._id.toString()));
    const absentTeachers = teachers.filter(t => !presentIds.has(t._id.toString()));

    res.json({
      success: true,
      data: {
        date,
        logs,
        absent: absentTeachers,
        summary: {
          present: logs.filter(l => l.status === 'PRESENT').length,
          late: logs.filter(l => l.status === 'LATE').length,
          absent: absentTeachers.length,
          total: teachers.length,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── CAMERA SCAN (identify from camera frame) ─────────────────────────────────

// POST /api/attendance/camera-scan
const cameraScan = async (req, res, next) => {
  try {
    const { faceImage, userId: directUserId } = req.body;

    // ── Path A: WS live-detect already identified the teacher — just record check-in ──
    if (directUserId && !faceImage) {
      const teacher = await Teacher.findById(directUserId).select('fullName employeeId department faceImageUrl');
      if (!teacher) {
        return res.status(404).json({ success: false, message: 'Teacher not found' });
      }
      const today = getTodayDateString();
      const existing = await AttendanceLog.findOne({ teacherId: teacher._id, date: today });
      let autoCheckedIn = false;
      if (!existing || !existing.checkInTime) {
        const now = new Date();
        const isLate = now.getHours() > 9 || (now.getHours() === 9 && now.getMinutes() > 30);
        const logEntry = { event: 'CHECK_IN', timestamp: now, confidence: null };
        if (existing) {
          existing.checkInTime = now;
          existing.status = isLate ? 'LATE' : 'PRESENT';
          existing.verificationMethod = 'FACE';
          existing.logs.push(logEntry);
          await existing.save();
        } else {
          await AttendanceLog.create({
            teacherId: teacher._id, date: today, checkInTime: now,
            status: isLate ? 'LATE' : 'PRESENT', verificationMethod: 'FACE',
            location: 'Campus Entrance', logs: [logEntry],
          });
        }
        autoCheckedIn = true;
        const io = req.app.get('io');
        if (io) io.emit('attendance:checkin', { teacherId: teacher._id.toString(), teacherName: teacher.fullName, timestamp: now, status: isLate ? 'LATE' : 'PRESENT' });
      }
      return res.json({
        success: true,
        data: {
          identified: true,
          teacher: { id: teacher._id, fullName: teacher.fullName, employeeId: teacher.employeeId, department: teacher.department, faceImageUrl: teacher.faceImageUrl },
          confidence: null,
          autoCheckedIn,
        },
      });
    }

    // ── Path B: Legacy — faceImage base64 sent, identify via Python service ──
    if (!faceImage) {
      return res.status(400).json({ success: false, message: 'Either faceImage or userId is required' });
    }

    const imageBuffer = Buffer.from(faceImage.replace(/^data:image\/\w+;base64,/, ''), 'base64');
    const formData = new FormData();
    formData.append('file', imageBuffer, { filename: 'frame.jpg', contentType: 'image/jpeg' });

    let identified = false;
    let teacher = null;
    let confidence = 0;

    try {
      const pyRes = await axios.post(`${FACE_SERVICE_URL}/identify-face`, formData, {
        headers: formData.getHeaders(),
        timeout: 15000,
      });

      if (pyRes.data.identified) {
        identified = true;
        confidence = pyRes.data.confidence;
        teacher = await Teacher.findById(pyRes.data.userId).select('fullName employeeId department faceImageUrl');
      }
    } catch (err) {
      return res.json({ success: true, data: { identified: false, reason: 'Face service unavailable' } });
    }

    if (!identified || !teacher) {
      return res.json({ success: true, data: { identified: false, reason: 'No match found' } });
    }

    // Auto check-in if not already checked in
    const today = getTodayDateString();
    const existing = await AttendanceLog.findOne({ teacherId: teacher._id, date: today });
    let autoCheckedIn = false;

    if (!existing || !existing.checkInTime) {
      const now = new Date();
      const isLate = now.getHours() > 9 || (now.getHours() === 9 && now.getMinutes() > 30);
      const logEntry = { event: 'CHECK_IN', timestamp: now, confidence };

      if (existing) {
        existing.checkInTime = now;
        existing.status = isLate ? 'LATE' : 'PRESENT';
        existing.confidenceScore = confidence;
        existing.verificationMethod = 'FACE';
        existing.logs.push(logEntry);
        await existing.save();
      } else {
        await AttendanceLog.create({
          teacherId: teacher._id, date: today, checkInTime: now,
          status: isLate ? 'LATE' : 'PRESENT', verificationMethod: 'FACE',
          confidenceScore: confidence, location: 'Campus Entrance', logs: [logEntry],
        });
      }
      autoCheckedIn = true;

      // Emit realtime event
      const io = req.app.get('io');
      if (io) {
        io.emit('attendance:checkin', {
          teacherId: teacher._id.toString(),
          teacherName: teacher.fullName,
          timestamp: now,
          status: isLate ? 'LATE' : 'PRESENT',
          confidence,
        });
      }
    }

    res.json({
      success: true,
      data: {
        identified: true,
        teacher: { id: teacher._id, fullName: teacher.fullName, employeeId: teacher.employeeId, department: teacher.department, faceImageUrl: teacher.faceImageUrl },
        confidence,
        autoCheckedIn,
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { checkIn, checkOut, getTodayStatus, getHistory, getAllAttendance, cameraScan };
