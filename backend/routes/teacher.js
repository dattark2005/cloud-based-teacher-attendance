const express = require('express');
const router = express.Router();
const { registerFace, getProfile, getAllTeachers } = require('../controllers/teacherController');
const { authenticate } = require('../middleware/auth');

// All require auth
router.use(authenticate);

// GET /api/teachers/profile
router.get('/profile', getProfile);

// GET /api/teachers
router.get('/', getAllTeachers);

// POST /api/teachers/register-face
router.post('/register-face', registerFace);

module.exports = router;
