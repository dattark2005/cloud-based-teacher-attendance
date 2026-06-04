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
      method: verificationMethod,
      timestamp: now,
      confidence: confidenceScore,
      snapshotUrl,
    };

    let log;
    if (existing) {
      existing.checkInTime = now;
      existing.status = isLate ? 'LATE' : 'PRESENT';
      existing.confidenceScore = confidenceScore;
      // Merge methods
      const methods = new Set([...(existing.verificationMethods || []), verificationMethod]);
      existing.verificationMethods = [...methods];
      existing.verificationMethod  = methods.size > 1 ? 'FACE+VOICE' : verificationMethod;
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
        verificationMethods: [verificationMethod],
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
    const adminDept = req.teacher.department; // The admin's department

    // Fetch all logs and filter in memory by department
    const allLogs = await AttendanceLog.find({ date }).populate('teacherId', 'fullName employeeId department');
    const logs = allLogs.filter(l => l.teacherId && l.teacherId.department === adminDept);

    // Fetch teachers in the same department
    const teachers = await Teacher.find({ isActive: true, department: adminDept }, 'fullName employeeId department');

    // Find absent teachers (no log for this date) — guard against null populate
    const presentIds = new Set(logs.map(l => l.teacherId._id.toString()));
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

const cameraScan = async (req, res, next) => {
  try {
    const { faceImage, userId: directUserId, gate = 'in' } = req.body;

    // ── Path A: WS live-detect already identified the teacher — record check-in or check-out ──
    if (directUserId && !faceImage) {
      const teacher = await Teacher.findById(directUserId).select('fullName employeeId department faceImageUrl');
      if (!teacher) {
        return res.status(404).json({ success: false, message: 'Teacher not found' });
      }
      const today = getTodayDateString();
      const existing = await AttendanceLog.findOne({ teacherId: teacher._id, date: today });
      const io = req.app.get('io');
      const now = new Date();

      const lastEvent = existing && existing.logs && existing.logs.length > 0
        ? existing.logs[existing.logs.length - 1].event
        : (existing && existing.checkInTime ? 'CHECK_IN' : null);

      let isOutGate = gate === 'out';
      if (gate === 'auto') {
        isOutGate = (lastEvent === 'CHECK_IN');
      }

      if (isOutGate) {
        // ── CHECK-OUT via OUT gate ──
        if (!existing || lastEvent !== 'CHECK_IN') {
          return res.json({ success: true, data: { identified: true, autoCheckedOut: false, alreadyCheckedOut: true, reason: 'Not checked in or already checked out' } });
        }
        existing.checkOutTime = now;
        existing.logs.push({ event: 'CHECK_OUT', method: 'FACE', timestamp: now, confidence: null });
        await existing.save();
        if (io) io.emit('attendance:checkout', { teacherId: teacher._id.toString(), teacherName: teacher.fullName, timestamp: now });
        return res.json({
          success: true,
          data: { identified: true, teacher: { fullName: teacher.fullName }, autoCheckedOut: true, checkOutTime: now },
        });
      }

      // ── CHECK-IN via IN gate ──
      let autoCheckedIn = false;
      if (!existing || lastEvent !== 'CHECK_IN') {
        const isLate = now.getHours() > 9 || (now.getHours() === 9 && now.getMinutes() > 30);
        const logEntry = { event: 'CHECK_IN', method: 'FACE', timestamp: now, confidence: null };
        if (existing) {
          existing.checkInTime = existing.checkInTime || now;
          existing.status = existing.checkInTime ? existing.status : (isLate ? 'LATE' : 'PRESENT');
          const methods = new Set([...(existing.verificationMethods || []), 'FACE']);
          existing.verificationMethods = [...methods];
          existing.verificationMethod  = methods.size > 1 ? 'FACE+VOICE' : 'FACE';
          existing.logs.push(logEntry);
          await existing.save();
        } else {
          await AttendanceLog.create({
            teacherId: teacher._id, date: today, checkInTime: now,
            status: isLate ? 'LATE' : 'PRESENT',
            verificationMethod: 'FACE', verificationMethods: ['FACE'],
            location: 'Campus Entrance', logs: [logEntry],
          });
        }
        autoCheckedIn = true;
        if (io) io.emit('attendance:checkin', { teacherId: teacher._id.toString(), teacherName: teacher.fullName, timestamp: now, status: isLate ? 'LATE' : 'PRESENT' });
      } else {
        // Already checked in. Make sure 'FACE' is in methods if they did voice first.
        if (!existing.verificationMethods || !existing.verificationMethods.includes('FACE')) {
          const methods = new Set([...(existing.verificationMethods || []), 'FACE']);
          existing.verificationMethods = [...methods];
          existing.verificationMethod  = methods.size > 1 ? 'FACE+VOICE' : 'FACE';
          existing.logs.push({ event: 'CHECK_IN', method: 'FACE', timestamp: now, confidence: null });
          await existing.save();
        }
      }
      return res.json({
        success: true,
        data: { identified: true, teacher: { fullName: teacher.fullName }, autoCheckedIn, alreadyCheckedIn: !autoCheckedIn, checkInTime: existing?.checkInTime || now },
      });
    }

    // ── Path B: Legacy — faceImage base64 sent ──
    if (!faceImage) {
      return res.status(400).json({ success: false, message: 'Either faceImage or userId is required' });
    }
    
    try {
      const imageBuffer = Buffer.from(faceImage.replace(/^data:image\/\w+;base64,/, ''), 'base64');
      const formData = new FormData();
      formData.append('file', imageBuffer, { filename: 'identify.jpg', contentType: 'image/jpeg' });
      
      const pyRes = await axios.post(`${FACE_SERVICE_URL}/identify-face`, formData, {
        headers: formData.getHeaders(),
        timeout: 20000,
      });

      if (!pyRes.data.identified) {
        return res.json({ success: true, data: { identified: false, reason: 'No match' } });
      }

      req.body.userId = pyRes.data.userId;
      req.body.faceImage = null; // Clear to run Path A
      return cameraScan(req, res, next);
    } catch (err) {
      console.warn('⚠️ Legacy identify failed:', err.message);
      return res.json({ success: true, data: { identified: false, reason: 'Face service unavailable' } });
    }
  } catch (err) {
    next(err);
  }
};

// ─── VOICE CHECK-IN ───────────────────────────────────────────────────────────

// POST /api/attendance/voice-checkin
const voiceCheckIn = async (req, res, next) => {
  try {
    const teacherId = req.teacher._id;
    const similarity = parseFloat(req.body.similarity) || 1;

    const today = getTodayDateString();
    const existing = await AttendanceLog.findOne({ teacherId, date: today });
    const teacher  = await Teacher.findById(teacherId).select('fullName');
    const io       = req.app.get('io');
    const now      = new Date();

    const lastEvent = existing && existing.logs && existing.logs.length > 0
        ? existing.logs[existing.logs.length - 1].event
        : (existing && existing.checkInTime ? 'CHECK_IN' : null);

    // If already checked in and NOT checked out, perform check-out!
    if (existing && lastEvent === 'CHECK_IN') {
      existing.checkOutTime = now;
      
      const logEntry = { event: 'CHECK_OUT', method: 'VOICE', timestamp: now, confidence: similarity };
      if (!existing.logs) {
        existing.logs = [];
      }
      existing.logs.push(logEntry);
      
      // Merge VOICE into methods
      const currentMethods = existing.verificationMethods || [];
      const methods = new Set([...currentMethods, 'VOICE']);
      existing.verificationMethods = [...methods];
      existing.verificationMethod  = methods.size > 1 ? 'FACE+VOICE' : 'VOICE';
      existing.voiceSimilarity     = similarity;
      
      const log = await existing.save();

      if (io) io.emit('attendance:checkout', {
        teacherId: teacherId.toString(),
        teacherName: teacher?.fullName,
        timestamp: now,
        method: log.verificationMethod
      });

      return res.json({
        success: true,
        data: {
          autoCheckedOut: true,
          checkOutTime: now,
          status: log.status,
          verificationMethod: log.verificationMethod,
          verificationMethods: log.verificationMethods,
        },
      });
    }

    // If they already checked out, prevent checking in again or allow it?
    if (existing && lastEvent === 'CHECK_OUT') {
      return res.json({
        success: true,
        data: {
          alreadyCheckedOut: true,
          checkInTime: existing.checkInTime,
          checkOutTime: existing.checkOutTime,
        }
      });
    }

    const isLate   = now.getHours() > 9 || (now.getHours() === 9 && now.getMinutes() > 30);
    const logEntry = { event: 'CHECK_IN', method: 'VOICE', timestamp: now, confidence: similarity };

    let log;
    if (existing) {
      existing.checkInTime    = existing.checkInTime || now;
      existing.status         = existing.checkInTime ? existing.status : (isLate ? 'LATE' : 'PRESENT');
      // Merge VOICE into methods
      const currentMethods = existing.verificationMethods || [];
      const methods = new Set([...currentMethods, 'VOICE']);
      existing.verificationMethods = [...methods];
      existing.verificationMethod  = methods.size > 1 ? 'FACE+VOICE' : 'VOICE';
      existing.voiceSimilarity     = similarity;
      
      if (!existing.logs) {
        existing.logs = [];
      }
      existing.logs.push(logEntry);
      log = await existing.save();
    } else {
      log = await AttendanceLog.create({
        teacherId, date: today, checkInTime: now,
        status: isLate ? 'LATE' : 'PRESENT',
        verificationMethod: 'VOICE', verificationMethods: ['VOICE'],
        voiceSimilarity: similarity, confidenceScore: similarity,
        location: 'Voice Check-In',
        logs: [logEntry],
      });
    }

    if (io) io.emit('attendance:checkin', {
      teacherId: teacherId.toString(),
      teacherName: teacher?.fullName,
      timestamp: now,
      status: log.status,
      method: log.verificationMethod
    });

    res.json({
      success: true,
      data: {
        autoCheckedIn: true,
        checkInTime: log.checkInTime,
        status: log.status,
        verificationMethod: log.verificationMethod,
        verificationMethods: log.verificationMethods,
      },
    });
  } catch (err) {
    console.error('❌ voiceCheckIn error:', err);
    next(err);
  }
};
// ─── ADMIN: GET SPECIFIC TEACHER HISTORY ───────────────────────────────────────
const getAdminTeacherHistory = async (req, res, next) => {
  try {
    const teacherId = req.params.id;
    const teacher = await Teacher.findById(teacherId).select('-password -faceEncoding -faceImageData');
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }

    const logs = await AttendanceLog.find({ teacherId }).sort({ date: -1 });

    const total = logs.length;
    const present = logs.filter(l => l.status === 'PRESENT').length;
    const late = logs.filter(l => l.status === 'LATE').length;

    res.json({
      success: true,
      data: {
        teacher,
        stats: { total, present, late },
        logs
      }
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { checkIn, checkOut, getTodayStatus, getHistory, getAllAttendance, cameraScan, voiceCheckIn, getAdminTeacherHistory };
