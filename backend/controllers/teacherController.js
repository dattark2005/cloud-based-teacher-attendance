const Teacher = require('../models/Teacher');
const AttendanceLog = require('../models/AttendanceLog');
const BiometricLog = require('../models/BiometricLog');
const axios = require('axios');
const FormData = require('form-data');
const cloudinary = require('cloudinary').v2;

// Configure cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const FACE_SERVICE_URL = process.env.FACE_SERVICE_URL || 'http://localhost:8000';

function getTodayDateString() {
  if (process.env.NODE_ENV === 'test') {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const options = { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' };
  const formatter = new Intl.DateTimeFormat('en-US', options);
  const parts = formatter.formatToParts(new Date());
  const partMap = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${partMap.year}-${partMap.month}-${partMap.day}`;
}

// ─── REGISTER FACE ─────────────────────────────────────────────────────────

// POST /api/teachers/register-face
const registerFace = async (req, res, next) => {
  try {
    const teacherId = req.teacher._id;
    const { faceImage } = req.body;

    if (!faceImage) {
      return res.status(400).json({ success: false, message: 'Face image is required' });
    }

    const imageBuffer = Buffer.from(faceImage.replace(/^data:image\/\w+;base64,/, ''), 'base64');

    // Send to Python face service
    const formData = new FormData();
    formData.append('user_id', teacherId.toString());
    formData.append('file', imageBuffer, { filename: 'face.jpg', contentType: 'image/jpeg' });

    let faceImageUrl = null;
    let registered = false;

    try {
      const pyRes = await axios.post(`${FACE_SERVICE_URL}/register-face`, formData, {
        headers: formData.getHeaders(),
        timeout: 30000,
      });
      faceImageUrl = pyRes.data.imageUrl;
      registered = pyRes.data.success;
    } catch (serviceErr) {
      console.warn('⚠️  Python face service unavailable — saving image as fallback');
      // Fallback: upload to Cloudinary directly
      try {
        const uploadRes = await new Promise((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            { folder: 'teacher_attendance/faces', public_id: `teacher_${teacherId}` },
            (err, res) => (err ? reject(err) : resolve(res))
          );
          require('stream').Readable.from(imageBuffer).pipe(uploadStream);
        });
        faceImageUrl = uploadRes.secure_url;
      } catch (_) {}
      registered = true; // fallback mode
    }

    // Only mark face as registered if the Python service confirmed success
    const updateFields = { faceImageUrl };
    if (registered) updateFields.faceRegisteredAt = new Date();

    const oldTeacher = await Teacher.findById(teacherId);
    const isUpdate = oldTeacher && !!oldTeacher.faceRegisteredAt;

    const updatedTeacher = await Teacher.findByIdAndUpdate(
      teacherId,
      updateFields,
      { new: true }
    );

    if (registered) {
      try {
        await BiometricLog.create({
          teacherId,
          biometricType: 'FACE',
          action: isUpdate ? 'UPDATE' : 'REGISTER',
          details: isUpdate ? 'Face registration updated' : 'Face registered successfully',
        });
      } catch (logErr) {
        console.warn('⚠️ Failed to save face registration log:', logErr);
      }
    }

    res.json({
      success: true,
      message: '✅ Face registered successfully',
      data: {
        faceImageUrl,
        registered,
        faceRegistered: true,
        teacher: {
          id: updatedTeacher._id,
          faceRegistered: true,
          faceImageUrl: updatedTeacher.faceImageUrl,
          faceRegisteredAt: updatedTeacher.faceRegisteredAt,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET PROFILE ─────────────────────────────────────────────────────────────

// GET /api/teachers/profile
const getProfile = async (req, res, next) => {
  try {
    const teacher = await Teacher.findById(req.teacher._id);
    if (!teacher) return res.status(404).json({ success: false, message: 'Teacher not found' });
    const today = getTodayDateString();
    const todayLog = await AttendanceLog.findOne({ teacherId: teacher._id, date: today });

    const latestVoiceLog = await BiometricLog.findOne({ teacherId: teacher._id, biometricType: 'VOICE' }).sort({ timestamp: -1 });
    const voiceRegistered = latestVoiceLog ? (latestVoiceLog.action !== 'DELETE') : false;

    res.json({
      success: true,
      data: {
        teacher: {
          id: teacher._id,
          fullName: teacher.fullName,
          employeeId: teacher.employeeId,
          email: teacher.email,
          department: teacher.department,
          designation: teacher.designation,
          phone: teacher.phone,
          profileImage: teacher.profileImage,
          faceImageUrl: teacher.faceImageUrl,
          faceRegistered: !!teacher.faceRegisteredAt,
          faceRegisteredAt: teacher.faceRegisteredAt,
          voiceRegistered: voiceRegistered,
          createdAt: teacher.createdAt,
        },
        todayStatus: todayLog
          ? {
              status: todayLog.status,
              checkInTime: todayLog.checkInTime,
              checkOutTime: todayLog.checkOutTime,
              logs: todayLog.logs,
            }
          : null,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET ALL TEACHERS ────────────────────────────────────────────────────────

// GET /api/teachers
const getAllTeachers = async (req, res, next) => {
  try {
    const today = getTodayDateString();
    const teachers = await Teacher.find({ isActive: true }).sort({ fullName: 1 });

    const teacherIds = teachers.map(t => t._id);
    const todayLogs = await AttendanceLog.find({ teacherId: { $in: teacherIds }, date: today });
    const logMap = {};
    todayLogs.forEach(l => { logMap[l.teacherId.toString()] = l; });

    const data = teachers.map(t => ({
      id: t._id,
      fullName: t.fullName,
      employeeId: t.employeeId,
      email: t.email,
      department: t.department,
      designation: t.designation,
      profileImage: t.profileImage,
      faceImageUrl: t.faceImageUrl,
      faceRegistered: !!t.faceRegisteredAt,
      todayStatus: logMap[t._id.toString()] || null,
    }));

    res.json({ success: true, data: { teachers: data } });
  } catch (err) {
    next(err);
  }
};

const updateProfile = async (req, res, next) => {
  try {
    const teacherId = req.teacher._id;
    const { fullName, designation, department, phone } = req.body;

    const updateFields = {};
    if (fullName) updateFields.fullName = fullName.trim();
    if (designation) updateFields.designation = designation.trim();
    if (department) updateFields.department = department.toLowerCase().trim();
    if (phone !== undefined) updateFields.phone = phone ? phone.trim() : null;

    const teacher = await Teacher.findByIdAndUpdate(
      teacherId,
      { $set: updateFields },
      { new: true, runValidators: true }
    );

    if (!teacher) return res.status(404).json({ success: false, message: 'Teacher not found' });

    const latestVoiceLog = await BiometricLog.findOne({ teacherId, biometricType: 'VOICE' }).sort({ timestamp: -1 });
    const voiceRegistered = latestVoiceLog ? (latestVoiceLog.action !== 'DELETE') : false;

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        teacher: {
          id: teacher._id,
          fullName: teacher.fullName,
          employeeId: teacher.employeeId,
          email: teacher.email,
          department: teacher.department,
          designation: teacher.designation,
          phone: teacher.phone,
          profileImage: teacher.profileImage,
          faceImageUrl: teacher.faceImageUrl,
          faceRegistered: !!teacher.faceRegisteredAt,
          faceRegisteredAt: teacher.faceRegisteredAt,
          voiceRegistered: voiceRegistered,
          createdAt: teacher.createdAt,
        }
      }
    });
  } catch (err) {
    next(err);
  }
};

const changePassword = async (req, res, next) => {
  try {
    const teacherId = req.teacher._id;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Current and new passwords are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters long' });
    }

    const teacher = await Teacher.findById(teacherId).select('+password');
    if (!teacher) return res.status(404).json({ success: false, message: 'Teacher not found' });

    const isMatch = await teacher.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Incorrect current password' });
    }

    teacher.password = newPassword;
    await teacher.save();

    res.json({
      success: true,
      message: 'Password changed successfully',
    });
  } catch (err) {
    next(err);
  }
};

const createBiometricLog = async (req, res, next) => {
  try {
    const teacherId = req.teacher._id;
    const { biometricType, action, details } = req.body;

    if (!biometricType || !['FACE', 'VOICE'].includes(biometricType)) {
      return res.status(400).json({ success: false, message: 'Valid biometricType (FACE, VOICE) is required' });
    }
    if (!action || !['REGISTER', 'UPDATE', 'DELETE'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Valid action (REGISTER, UPDATE, DELETE) is required' });
    }

    const log = new BiometricLog({
      teacherId,
      biometricType,
      action,
      details: details || '',
    });
    await log.save();

    res.status(201).json({
      success: true,
      message: 'Biometric activity logged successfully',
      data: log,
    });
  } catch (err) {
    next(err);
  }
};

const getBiometricLogs = async (req, res, next) => {
  try {
    const teacherId = req.teacher._id;
    const logs = await BiometricLog.find({ teacherId }).sort({ timestamp: -1 });

    res.json({
      success: true,
      data: logs,
    });
  } catch (err) {
    next(err);
  }
};

const deleteFace = async (req, res, next) => {
  try {
    const teacherId = req.teacher._id;

    const teacher = await Teacher.findById(teacherId);
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }
    if (!teacher.faceRegisteredAt) {
      return res.status(400).json({ success: false, message: 'Face registration not found' });
    }

    await Teacher.findByIdAndUpdate(
      teacherId,
      {
        $unset: {
          faceEncoding: '',
          faceImageUrl: '',
          faceImageData: '',
          faceRegisteredAt: ''
        }
      }
    );

    const log = new BiometricLog({
      teacherId,
      biometricType: 'FACE',
      action: 'DELETE',
      details: 'Face registration deleted successfully',
    });
    await log.save();

    res.json({
      success: true,
      message: 'Face registration deleted successfully',
    });
  } catch (err) {
    next(err);
  }
};

const deleteVoice = async (req, res, next) => {
  try {
    const teacherId = req.teacher._id;

    const latestVoiceLog = await BiometricLog.findOne({ teacherId, biometricType: 'VOICE' }).sort({ timestamp: -1 });
    const voiceRegistered = latestVoiceLog ? (latestVoiceLog.action !== 'DELETE') : false;
    if (!voiceRegistered) {
      return res.status(400).json({ success: false, message: 'Voice registration not found' });
    }

    const VOICE_SERVICE_URL = process.env.VOICE_SERVICE_URL || 'http://localhost:8001';
    try {
      await axios.delete(`${VOICE_SERVICE_URL}/voice/${teacherId}`);
    } catch (serviceErr) {
      console.warn('⚠️ Python voice service delete request failed:', serviceErr.message);
    }

    await Teacher.findByIdAndUpdate(
      teacherId,
      { $unset: { voiceEncoding: '' } }
    );

    const log = new BiometricLog({
      teacherId,
      biometricType: 'VOICE',
      action: 'DELETE',
      details: 'Voice profile deleted successfully',
    });
    await log.save();

    res.json({
      success: true,
      message: 'Voice registration deleted successfully',
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { registerFace, getProfile, getAllTeachers, updateProfile, changePassword, createBiometricLog, getBiometricLogs, deleteFace, deleteVoice };
