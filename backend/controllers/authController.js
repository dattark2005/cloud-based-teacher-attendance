const jwt = require('jsonwebtoken');
const Teacher = require('../models/Teacher');

const generateToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

const formatTeacher = (t) => ({
  id: t._id,
  fullName: t.fullName,
  employeeId: t.employeeId,
  email: t.email,
  department: t.department,
  designation: t.designation,
  profileImage: t.profileImage || null,
  faceImageUrl: t.faceImageUrl || null,
  faceRegistered: !!t.faceRegisteredAt,
  faceRegisteredAt: t.faceRegisteredAt || null,
  role: t.role,
  createdAt: t.createdAt,
});

// POST /api/auth/register
const register = async (req, res, next) => {
  try {
    const { fullName, email, password, role } = req.body;

    if (!fullName || !email || !password) {
      return res.status(400).json({ success: false, message: 'All required fields must be provided' });
    }

    const exists = await Teacher.findOne({ email });
    if (exists) {
      return res.status(409).json({ success: false, message: 'Email already exists' });
    }

    const teacher = await Teacher.create({
      fullName, 
      employeeId: 'EMP' + Date.now().toString().slice(-6), 
      email, 
      password, 
      department: 'General',
      designation: 'Staff',
      role: role || 'TEACHER'
    });

    const token = generateToken(teacher._id);

    res.status(201).json({
      success: true,
      message: 'Teacher registered successfully',
      data: { token, teacher: formatTeacher(teacher) },
    });
  } catch (err) {
    if (err.code === 11000) {
      const field = Object.keys(err.keyValue || {})[0] || 'field';
      return res.status(409).json({ success: false, message: `${field} already exists` });
    }
    next(err);
  }
};

// POST /api/auth/login
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const teacher = await Teacher.findOne({ email }).select('+password');
    if (!teacher || !(await teacher.comparePassword(password))) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    if (!teacher.isActive) {
      return res.status(403).json({ success: false, message: 'Account is deactivated' });
    }

    const token = generateToken(teacher._id);

    // Reload teacher to get all fields (password was select:false)
    const fullTeacher = await Teacher.findById(teacher._id);
    res.json({
      success: true,
      message: 'Login successful',
      data: { token, teacher: formatTeacher(fullTeacher) },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/auth/me
const getMe = async (req, res) => {
  const teacher = await Teacher.findById(req.teacher._id).select('+faceRegisteredAt');
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
        faceRegisteredAt: teacher.faceRegisteredAt,
        faceRegistered: !!teacher.faceRegisteredAt,
        role: teacher.role,
        createdAt: teacher.createdAt,
      },
    },
  });
};

module.exports = { register, login, getMe };
