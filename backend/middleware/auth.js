const jwt = require('jsonwebtoken');
const Teacher = require('../models/Teacher');

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const teacher = await Teacher.findById(decoded.id).select('-password');
    if (!teacher || !teacher.isActive) {
      return res.status(401).json({ success: false, message: 'Invalid token or inactive account' });
    }
    req.teacher = teacher;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Token expired or invalid' });
  }
};

module.exports = { authenticate };
