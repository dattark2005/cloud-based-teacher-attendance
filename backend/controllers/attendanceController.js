const AttendanceLog = require('../models/AttendanceLog');
const Teacher = require('../models/Teacher');
const BiometricLog = require('../models/BiometricLog');
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

function getCooldownRemaining(existing, now) {
  if (!existing) return 0;
  let lastTimestamp = null;
  if (existing.logs && existing.logs.length > 0) {
    lastTimestamp = existing.logs[existing.logs.length - 1].timestamp;
  } else if (existing.checkOutTime) {
    lastTimestamp = existing.checkOutTime;
  } else if (existing.checkInTime) {
    lastTimestamp = existing.checkInTime;
  }

  if (!lastTimestamp) return 0;

  const diffMs = now - new Date(lastTimestamp);
  const remainingSecs = 180 - (diffMs / 1000);
  return remainingSecs > 0 ? Math.ceil(remainingSecs) : 0;
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

    // Check absolute last event across all days
    let query = AttendanceLog.findOne({ teacherId });
    if (typeof query.sort === 'function') {
      query = query.sort({ date: -1 });
    }
    const lastLog = await query;
    const lastEvent = lastLog && lastLog.logs && lastLog.logs.length > 0
      ? lastLog.logs[lastLog.logs.length - 1].event
      : (lastLog && lastLog.checkInTime ? 'CHECK_IN' : null);

    if (lastEvent === 'CHECK_IN') {
      return res.status(400).json({
        success: false,
        message: 'Already checked in. Please check out first.',
        data: { log: lastLog },
      });
    }

    let now = new Date();
    const cooldownRemaining = getCooldownRemaining(lastLog, now);
    if (cooldownRemaining > 0) {
      return res.status(400).json({
        success: false,
        message: `Please wait ${cooldownRemaining} more seconds before checking in.`,
        data: { log: lastLog }
      });
    }

    const existing = (lastLog && lastLog.date === today) ? lastLog : null;

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

    now = new Date();

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
      existing.checkOutTime = null; // Clear check-out time on re-check-in
      existing.status = 'PRESENT';
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
        status: 'PRESENT',
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
      message: '✅ Check-in successful!',
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

    // Check absolute last event across all days
    let query = AttendanceLog.findOne({ teacherId });
    if (typeof query.sort === 'function') {
      query = query.sort({ date: -1 });
    }
    const lastLog = await query;

    const lastEvent = lastLog && lastLog.logs && lastLog.logs.length > 0
      ? lastLog.logs[lastLog.logs.length - 1].event
      : (lastLog && lastLog.checkInTime ? 'CHECK_IN' : null);

    if (!lastLog) {
      return res.status(400).json({ success: false, message: 'No check-in found. Please check in first.' });
    }

    if (lastEvent === 'CHECK_OUT') {
      return res.status(400).json({ success: false, message: 'Already checked out. Please check in first.' });
    }

    if (lastEvent !== 'CHECK_IN') {
      return res.status(400).json({ success: false, message: 'No check-in found. Please check in first.' });
    }

    const existing = lastLog;

    let now = new Date();
    const cooldownRemaining = getCooldownRemaining(existing, now);
    if (cooldownRemaining > 0) {
      return res.status(400).json({
        success: false,
        message: `Please wait ${cooldownRemaining} more seconds before checking out.`,
        data: { log: existing }
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

    now = new Date();
    existing.checkOutTime = now;
    existing.logs.push({ event: 'CHECK_OUT', method: 'FACE', timestamp: now, confidence: confidenceScore, snapshotUrl });
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

    const queryCond = { teacherId };
    if (req.query.startDate || req.query.endDate) {
      queryCond.date = {};
      if (req.query.startDate) queryCond.date.$gte = req.query.startDate;
      if (req.query.endDate) queryCond.date.$lte = req.query.endDate;
    }

    const [logs, total, allLogs, fullLogs] = await Promise.all([
      AttendanceLog.find(queryCond)
        .sort({ date: -1 })
        .skip(skip)
        .limit(limit),
      AttendanceLog.countDocuments(queryCond),
      // Fetch all to compute accurate present/late totals
      AttendanceLog.find(queryCond, 'status'),
      // Fetch all logs in range to calculate the exact check-in and check-out counts
      AttendanceLog.find(queryCond, 'logs checkInTime checkOutTime'),
    ]);

    const present = allLogs.filter(l => l.status === 'PRESENT').length;
    const absent  = total - present;

    let checkInCount = 0;
    let checkOutCount = 0;
    (fullLogs || []).forEach(l => {
      if (!l) return;
      if (l.logs && l.logs.length > 0) {
        l.logs.forEach(e => {
          if (e.event === 'CHECK_IN') checkInCount++;
          if (e.event === 'CHECK_OUT') checkOutCount++;
        });
      } else {
        if (l.checkInTime) checkInCount++;
        if (l.checkOutTime) checkOutCount++;
      }
    });

    res.json({
      success: true,
      data: {
        logs,
        stats: { total, present, absent: Math.max(0, absent), checkInCount, checkOutCount },
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
    const adminDept = (req.teacher.department || '').toLowerCase().trim(); // The admin's department

    // Fetch all logs and filter in memory by department
    const allLogs = await AttendanceLog.find({ date }).populate('teacherId', 'fullName employeeId department');
    const logs = allLogs.filter(l => l.teacherId && (l.teacherId.department || '').toLowerCase().trim() === adminDept);

    // Fetch teachers in the same department
    const teachers = await Teacher.find({
      isActive: true,
      department: { $regex: new RegExp('^' + adminDept.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '$', 'i') }
    }, 'fullName employeeId department');

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
    const { faceImage, userId: directUserId, gate = 'in', confidence: directConfidence = null } = req.body;

    // ── Path A: WS live-detect already identified the teacher — record check-in or check-out ──
    if (directUserId && !faceImage) {
      const teacher = await Teacher.findById(directUserId).select('fullName employeeId department faceImageUrl');
      if (!teacher) {
        return res.status(404).json({ success: false, message: 'Teacher not found' });
      }
      const today = getTodayDateString();
      let query = AttendanceLog.findOne({ teacherId: teacher._id });
      if (typeof query.sort === 'function') {
        query = query.sort({ date: -1 });
      }
      const lastLog = await query;
      const io = req.app.get('io');
      const now = new Date();

      const lastEvent = lastLog && lastLog.logs && lastLog.logs.length > 0
        ? lastLog.logs[lastLog.logs.length - 1].event
        : (lastLog && lastLog.checkInTime ? 'CHECK_IN' : null);

      let isOutGate = gate === 'out';
      if (gate === 'auto') {
        isOutGate = (lastEvent === 'CHECK_IN');
      }

      if (isOutGate) {
        // ── CHECK-OUT via OUT gate ──
        const existing = lastLog;
        if (!existing || lastEvent !== 'CHECK_IN') {
          return res.json({ success: true, data: { identified: true, autoCheckedOut: false, alreadyCheckedOut: true, reason: 'Not checked in or already checked out' } });
        }
        const cooldownRemaining = getCooldownRemaining(existing, now);
        if (cooldownRemaining > 0) {
          return res.json({
            success: true,
            data: {
              identified: true,
              autoCheckedOut: false,
              cooldown: true,
              message: `Please wait ${cooldownRemaining} more seconds.`,
              reason: `Please wait ${cooldownRemaining} more seconds before checking out.`
            }
          });
        }
        existing.checkOutTime = now;
        existing.logs.push({ event: 'CHECK_OUT', method: 'FACE', timestamp: now, confidence: directConfidence });
        await existing.save();
        if (io) io.emit('attendance:checkout', { teacherId: teacher._id.toString(), teacherName: teacher.fullName, timestamp: now });
        return res.json({
          success: true,
          data: { identified: true, teacher: { fullName: teacher.fullName }, autoCheckedOut: true, checkOutTime: now },
        });
      }

      // ── CHECK-IN via IN gate ──
      const existing = (lastLog && lastLog.date === today) ? lastLog : null;
      let autoCheckedIn = false;
      if (lastEvent !== 'CHECK_IN') {
        const cooldownRemaining = getCooldownRemaining(existing, now);
        if (cooldownRemaining > 0) {
          return res.json({
            success: true,
            data: {
              identified: true,
              autoCheckedIn: false,
              cooldown: true,
              message: `Please wait ${cooldownRemaining} more seconds.`,
              reason: `Please wait ${cooldownRemaining} more seconds before checking in.`
            }
          });
        }
        const logEntry = { event: 'CHECK_IN', method: 'FACE', timestamp: now, confidence: directConfidence };
        if (existing) {
          existing.checkInTime = now;
          existing.checkOutTime = null; // Clear check-out time on re-check-in
          existing.status = 'PRESENT';
          existing.confidenceScore = directConfidence;
          const methods = new Set([...(existing.verificationMethods || []), 'FACE']);
          existing.verificationMethods = [...methods];
          existing.verificationMethod  = methods.size > 1 ? 'FACE+VOICE' : 'FACE';
          existing.logs.push(logEntry);
          await existing.save();
        } else {
          await AttendanceLog.create({
            teacherId: teacher._id, date: today, checkInTime: now,
            status: 'PRESENT',
            verificationMethod: 'FACE', verificationMethods: ['FACE'],
            confidenceScore: directConfidence,
            location: 'Campus Entrance', logs: [logEntry],
          });
        }
        autoCheckedIn = true;
        if (io) io.emit('attendance:checkin', { teacherId: teacher._id.toString(), teacherName: teacher.fullName, timestamp: now, status: 'PRESENT' });
      } else {
        // Already checked in. Make sure 'FACE' is in methods if they did voice first.
        const cooldownRemaining = getCooldownRemaining(existing, now);
        if (cooldownRemaining === 0 && existing && (!existing.verificationMethods || !existing.verificationMethods.includes('FACE'))) {
          const methods = new Set([...(existing.verificationMethods || []), 'FACE']);
          existing.verificationMethods = [...methods];
          existing.verificationMethod  = methods.size > 1 ? 'FACE+VOICE' : 'FACE';
          existing.logs.push({ event: 'CHECK_IN', method: 'FACE', timestamp: now, confidence: directConfidence });
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
    let query = AttendanceLog.findOne({ teacherId });
    if (typeof query.sort === 'function') {
      query = query.sort({ date: -1 });
    }
    const lastLog = await query;
    const teacher  = await Teacher.findById(teacherId).select('fullName');
    const io       = req.app.get('io');
    const now      = new Date();

    const lastEvent = lastLog && lastLog.logs && lastLog.logs.length > 0
        ? lastLog.logs[lastLog.logs.length - 1].event
        : (lastLog && lastLog.checkInTime ? 'CHECK_IN' : null);

    // If already checked in and NOT checked out, perform check-out!
    if (lastEvent === 'CHECK_IN') {
      const existing = lastLog;
      const cooldownRemaining = getCooldownRemaining(existing, now);
      if (cooldownRemaining > 0) {
        return res.status(400).json({
          success: false,
          message: `Please wait ${cooldownRemaining} more seconds before checking out.`,
          data: { log: existing }
        });
      }
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

    const existing = (lastLog && lastLog.date === today) ? lastLog : null;

    // If they already checked out, allow checking in again (fall through to check-in path)
    const cooldownRemaining = getCooldownRemaining(existing, now);
    if (cooldownRemaining > 0) {
      return res.status(400).json({
        success: false,
        message: `Please wait ${cooldownRemaining} more seconds before checking in.`,
        data: { log: existing }
      });
    }

    const logEntry = { event: 'CHECK_IN', method: 'VOICE', timestamp: now, confidence: similarity };

    let log;
    if (existing) {
      existing.checkInTime    = now;
      existing.checkOutTime   = null; // Clear check-out time on re-check-in
      existing.status         = 'PRESENT';
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
        status: 'PRESENT',
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

    const adminDept = (req.teacher.department || '').toLowerCase().trim();
    const teacherDept = (teacher.department || '').toLowerCase().trim();
    if (teacherDept !== adminDept) {
      return res.status(403).json({ success: false, message: 'Access denied. Teacher belongs to a different department.' });
    }

    const queryCond = { teacherId };
    if (req.query.startDate || req.query.endDate) {
      queryCond.date = {};
      if (req.query.startDate) queryCond.date.$gte = req.query.startDate;
      if (req.query.endDate) queryCond.date.$lte = req.query.endDate;
    }

    const [logs, biometricLogs] = await Promise.all([
      AttendanceLog.find(queryCond).sort({ date: -1 }),
      BiometricLog.find({ teacherId }).sort({ timestamp: -1 })
    ]);

    const total = logs.length;
    const present = logs.filter(l => l.status === 'PRESENT').length;

    const latestVoiceLog = biometricLogs.find(l => l.biometricType === 'VOICE');
    const voiceRegistered = latestVoiceLog ? (latestVoiceLog.action !== 'DELETE') : false;

    const latestFaceLog = biometricLogs.find(l => l.biometricType === 'FACE');
    const faceRegistered = latestFaceLog ? (latestFaceLog.action !== 'DELETE') : (!!teacher.faceRegisteredAt);

    res.json({
      success: true,
      data: {
        teacher,
        stats: { total, present },
        logs,
        biometricLogs: biometricLogs || [],
        voiceRegistered,
        faceRegistered
      }
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { checkIn, checkOut, getTodayStatus, getHistory, getAllAttendance, cameraScan, voiceCheckIn, getAdminTeacherHistory };
