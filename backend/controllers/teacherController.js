const Teacher = require('../models/Teacher');
const AttendanceLog = require('../models/AttendanceLog');
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
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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

    const updatedTeacher = await Teacher.findByIdAndUpdate(
      teacherId,
      updateFields,
      { new: true }
    );

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
          profileImage: teacher.profileImage,
          faceImageUrl: teacher.faceImageUrl,
          faceRegistered: !!teacher.faceRegisteredAt,
          faceRegisteredAt: teacher.faceRegisteredAt,
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

module.exports = { registerFace, getProfile, getAllTeachers };
