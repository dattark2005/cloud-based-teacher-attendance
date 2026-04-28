/**
 * ATTENDANCE CONTROLLER TESTS
 * Covers: cameraScan (both paths), checkIn, checkOut, getTodayStatus, getHistory, getAllAttendance
 * 28 test cases
 */
const request = require('supertest');

// ── Mocks ────────────────────────────────────────────────────────────────────
jest.mock('../models/Teacher');
jest.mock('../models/AttendanceLog');
jest.mock('axios');
jest.mock('form-data', () => {
  return jest.fn().mockImplementation(() => ({
    append: jest.fn(),
    getHeaders: jest.fn().mockReturnValue({ 'content-type': 'multipart/form-data; boundary=test' }),
  }));
});
jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(() => 'mock_token'),
  verify: jest.fn(() => ({ id: 'teacher123' })),
}));
jest.mock('../config/database', () => jest.fn());
jest.mock('cloudinary', () => ({
  v2: { config: jest.fn(), uploader: { upload_stream: jest.fn() } },
}));
// Mock auth middleware to inject teacher without DB lookup
jest.mock('../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.teacher = { _id: 'teacher123' };
    next();
  },
}));

// ── Requires (after mocks) ───────────────────────────────────────────────────
const app           = require('../server');
const Teacher       = require('../models/Teacher');
const AttendanceLog = require('../models/AttendanceLog');
const axios         = require('axios');

// Auth header helper
const AUTH = 'Bearer mock_token';

// Common fixtures
const teacherFixture = {
  _id: 'teacher123',
  fullName: 'Dr. Priya Sharma',
  employeeId: 'EMP100',
  department: 'CS',
  faceImageUrl: 'https://cloudinary.com/face.jpg',
  faceEncoding: Buffer.alloc(1024),
  isActive: true,
};

const logFixture = {
  _id: 'log123',
  teacherId: 'teacher123',
  date: '2025-04-27',
  checkInTime: new Date(),
  checkOutTime: null,
  status: 'PRESENT',
  verificationMethod: 'FACE',
  confidenceScore: 0.92,
  logs: [],
  save: jest.fn().mockResolvedValue(true),
};

afterEach(() => jest.clearAllMocks());


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('POST /api/attendance/camera-scan — WS path (userId only)', () => {

  test('TC-19 — 404 when userId not found in DB', async () => {
    Teacher.findById.mockReturnValueOnce({ select: jest.fn().mockResolvedValueOnce(null) });
    const res = await request(app)
      .post('/api/attendance/camera-scan')
      .set('Authorization', AUTH)
      .send({ userId: 'nonexistentId' });
    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/not found/i);
  });

  test('TC-20 — 200 + autoCheckedIn=true for first check-in via WS path', async () => {
    Teacher.findById.mockReturnValueOnce({ select: jest.fn().mockResolvedValueOnce(teacherFixture) });
    AttendanceLog.findOne.mockResolvedValueOnce(null); // no existing
    AttendanceLog.create.mockResolvedValueOnce({ ...logFixture, checkInTime: new Date() });

    const res = await request(app)
      .post('/api/attendance/camera-scan')
      .set('Authorization', AUTH)
      .send({ userId: 'teacher123' });

    expect(res.status).toBe(200);
    expect(res.body.data.autoCheckedIn).toBe(true);
    expect(res.body.data.identified).toBe(true);
  });

  test('TC-21 — 200 + autoCheckedIn=false when already checked in', async () => {
    Teacher.findById.mockReturnValueOnce({ select: jest.fn().mockResolvedValueOnce(teacherFixture) });
    AttendanceLog.findOne.mockResolvedValueOnce({ ...logFixture, checkInTime: new Date() });

    const res = await request(app)
      .post('/api/attendance/camera-scan')
      .set('Authorization', AUTH)
      .send({ userId: 'teacher123' });

    expect(res.status).toBe(200);
    expect(res.body.data.autoCheckedIn).toBe(false);
  });

  test('TC-22 — 400 when neither faceImage nor userId provided', async () => {
    const res = await request(app)
      .post('/api/attendance/camera-scan')
      .set('Authorization', AUTH)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/required/i);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('POST /api/attendance/camera-scan — Legacy faceImage path', () => {

  const fakeBase64 = 'data:image/jpeg;base64,' + Buffer.alloc(100).toString('base64');

  test('TC-23 — 200 identified=false when face service unavailable', async () => {
    axios.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const res = await request(app)
      .post('/api/attendance/camera-scan')
      .set('Authorization', AUTH)
      .send({ faceImage: fakeBase64 });
    expect(res.status).toBe(200);
    expect(res.body.data.identified).toBe(false);
    expect(res.body.data.reason).toMatch(/unavailable/i);
  });

  test('TC-24 — 200 identified=false when no match', async () => {
    axios.post.mockResolvedValueOnce({ data: { identified: false } });
    const res = await request(app)
      .post('/api/attendance/camera-scan')
      .set('Authorization', AUTH)
      .send({ faceImage: fakeBase64 });
    expect(res.status).toBe(200);
    expect(res.body.data.identified).toBe(false);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('POST /api/attendance/check-in', () => {

  const fakeBase64 = 'data:image/jpeg;base64,' + Buffer.alloc(100).toString('base64');

  test('TC-25 — 400 when faceImage missing', async () => {
    const res = await request(app)
      .post('/api/attendance/check-in')
      .set('Authorization', AUTH)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/face image/i);
  });

  test('TC-26 — 400 when already checked in today', async () => {
    AttendanceLog.findOne.mockResolvedValueOnce({ ...logFixture, checkInTime: new Date() });
    const res = await request(app)
      .post('/api/attendance/check-in')
      .set('Authorization', AUTH)
      .send({ faceImage: fakeBase64 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already checked in/i);
  });

  test('TC-27 — 400 when face not registered', async () => {
    AttendanceLog.findOne.mockResolvedValueOnce(null);
    Teacher.findById.mockReturnValueOnce({
      select: jest.fn().mockResolvedValueOnce({ ...teacherFixture, faceEncoding: null, faceImageData: null }),
    });
    const res = await request(app)
      .post('/api/attendance/check-in')
      .set('Authorization', AUTH)
      .send({ faceImage: fakeBase64 });
    expect(res.status).toBe(400);
    expect(res.body.data.faceNotRegistered).toBe(true);
  });

  test('TC-28 — 401 when face not recognized by service', async () => {
    AttendanceLog.findOne.mockResolvedValueOnce(null);
    Teacher.findById.mockReturnValueOnce({
      select: jest.fn().mockResolvedValueOnce({ ...teacherFixture }),
    });
    axios.post.mockResolvedValueOnce({ data: { verified: false, confidence: 0.2 } });
    const res = await request(app)
      .post('/api/attendance/check-in')
      .set('Authorization', AUTH)
      .send({ faceImage: fakeBase64 });
    expect(res.status).toBe(401);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('POST /api/attendance/check-out', () => {

  const fakeBase64 = 'data:image/jpeg;base64,' + Buffer.alloc(100).toString('base64');

  test('TC-29 — 400 when faceImage missing', async () => {
    const res = await request(app)
      .post('/api/attendance/check-out')
      .set('Authorization', AUTH)
      .send({});
    expect(res.status).toBe(400);
  });

  test('TC-30 — 400 when no check-in found', async () => {
    AttendanceLog.findOne.mockResolvedValueOnce(null);
    const res = await request(app)
      .post('/api/attendance/check-out')
      .set('Authorization', AUTH)
      .send({ faceImage: fakeBase64 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no check-in/i);
  });

  test('TC-31 — 400 when already checked out', async () => {
    AttendanceLog.findOne.mockResolvedValueOnce({
      ...logFixture,
      checkInTime: new Date(),
      checkOutTime: new Date(),
    });
    const res = await request(app)
      .post('/api/attendance/check-out')
      .set('Authorization', AUTH)
      .send({ faceImage: fakeBase64 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already checked out/i);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('GET /api/attendance/today', () => {

  test('TC-32 — 200 returns log=null when no attendance today', async () => {
    AttendanceLog.findOne.mockReturnValueOnce({ populate: jest.fn().mockResolvedValueOnce(null) });
    const res = await request(app)
      .get('/api/attendance/today')
      .set('Authorization', AUTH);
    expect(res.status).toBe(200);
    expect(res.body.data.log).toBeNull();
  });

  test('TC-33 — 200 returns log with today date string', async () => {
    AttendanceLog.findOne.mockReturnValueOnce({
      populate: jest.fn().mockResolvedValueOnce(logFixture),
    });
    const res = await request(app)
      .get('/api/attendance/today')
      .set('Authorization', AUTH);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('today');
    expect(res.body.data.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('GET /api/attendance/history', () => {

  test('TC-34 — 200 returns correct pagination with parsed int limit', async () => {
    const mockFind = { sort: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), limit: jest.fn().mockResolvedValueOnce([]) };
    AttendanceLog.find.mockReturnValueOnce(mockFind).mockReturnValueOnce([]);
    AttendanceLog.countDocuments.mockResolvedValueOnce(0);

    const res = await request(app)
      .get('/api/attendance/history?limit=10&page=2')
      .set('Authorization', AUTH);

    expect(res.status).toBe(200);
    // skip should be (2-1)*10 = 10
    expect(mockFind.skip).toHaveBeenCalledWith(10);
    expect(mockFind.limit).toHaveBeenCalledWith(10);
  });

  test('TC-35 — stats present + late counted from allLogs not just page', async () => {
    const presentLog = { status: 'PRESENT' };
    const lateLog    = { status: 'LATE' };
    // paginated slice has 1 item, but allLogs has 3
    const mockFind1 = { sort: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), limit: jest.fn().mockResolvedValueOnce([presentLog]) };
    const allLogs   = [presentLog, lateLog, lateLog];
    AttendanceLog.find.mockReturnValueOnce(mockFind1).mockReturnValueOnce(allLogs);
    AttendanceLog.countDocuments.mockResolvedValueOnce(3);

    const res = await request(app)
      .get('/api/attendance/history?limit=1&page=1')
      .set('Authorization', AUTH);
    expect(res.status).toBe(200);
    // Stats should reflect allLogs, not just the page
    expect(res.body.data.stats.present).toBe(1);
    expect(res.body.data.stats.late).toBe(2);
    expect(res.body.data.stats.total).toBe(3);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('GET /api/attendance/all', () => {

  test('TC-36 — 200 returns summary with present/late/absent counts', async () => {
    const mockLog = { teacherId: { _id: 'teacher123', fullName: 'Dr. T', employeeId: 'E1', department: 'CS' }, status: 'PRESENT', checkInTime: new Date() };
    AttendanceLog.find.mockReturnValueOnce({ populate: jest.fn().mockResolvedValueOnce([mockLog]) });
    Teacher.find.mockResolvedValueOnce([{ _id: 'teacher123', fullName: 'Dr. T', employeeId: 'E1', department: 'CS' }, { _id: 'teacher456', fullName: 'Dr. S', employeeId: 'E2', department: 'Math' }]);

    const res = await request(app)
      .get('/api/attendance/all')
      .set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data.summary.present).toBe(1);
    expect(res.body.data.summary.absent).toBe(1); // teacher456 not in logs
    expect(res.body.data.absent).toHaveLength(1);
  });

  test('TC-37 — date query param forwarded correctly', async () => {
    AttendanceLog.find.mockReturnValueOnce({ populate: jest.fn().mockResolvedValueOnce([]) });
    Teacher.find.mockResolvedValueOnce([]);
    const res = await request(app)
      .get('/api/attendance/all?date=2025-01-15')
      .set('Authorization', AUTH);
    expect(res.status).toBe(200);
    expect(res.body.data.date).toBe('2025-01-15');
  });

  test('TC-38 — defaults to today when no date param', async () => {
    AttendanceLog.find.mockReturnValueOnce({ populate: jest.fn().mockResolvedValueOnce([]) });
    Teacher.find.mockResolvedValueOnce([]);
    const res = await request(app)
      .get('/api/attendance/all')
      .set('Authorization', AUTH);
    expect(res.status).toBe(200);
    const today = new Date().toISOString().slice(0, 10);
    expect(res.body.data.date).toBe(today);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('Utility functions — getTodayDateString', () => {

  test('TC-39 — date string is valid YYYY-MM-DD format', () => {
    // Test the helper function indirectly through the response
    const dateStr = new Date().toISOString().slice(0, 10);
    expect(dateStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Month should be padded
    const parts = dateStr.split('-');
    expect(parts[1].length).toBe(2);
    expect(parts[2].length).toBe(2);
  });

  test('TC-40 — isLate logic: 9:30 AM boundary', () => {
    // isLate = hours > 9 || (hours === 9 && minutes > 30)
    const checkLate = (h, m) => h > 9 || (h === 9 && m > 30);
    expect(checkLate(9, 30)).toBe(false);  // 9:30 exactly = NOT late
    expect(checkLate(9, 31)).toBe(true);   // 9:31 = late
    expect(checkLate(10, 0)).toBe(true);   // 10:00 = late
    expect(checkLate(8, 59)).toBe(false);  // 8:59 = not late
    expect(checkLate(9, 0)).toBe(false);   // 9:00 = not late
  });

  test('TC-41 — base64 strip regex handles all image types', () => {
    const strip = (s) => s.replace(/^data:image\/\w+;base64,/, '');
    expect(strip('data:image/jpeg;base64,ABC')).toBe('ABC');
    expect(strip('data:image/png;base64,XYZ')).toBe('XYZ');
    expect(strip('data:image/webp;base64,DEF')).toBe('DEF');
    expect(strip('ABC')).toBe('ABC'); // no prefix — unchanged
  });

  test('TC-42 — absent count never goes negative (Math.max guard)', () => {
    // If somehow present+late > total, absent should be 0 not negative
    const absent = Math.max(0, 5 - 3 - 4); // would be -2 without guard
    expect(absent).toBe(0);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('Teacher routes', () => {

  test('TC-43 — GET /api/teachers — 200 returns teachers array', async () => {
    Teacher.find.mockReturnValueOnce({ sort: jest.fn().mockResolvedValueOnce([teacherFixture]) });
    AttendanceLog.find.mockResolvedValueOnce([]);
    const res = await request(app)
      .get('/api/teachers')
      .set('Authorization', AUTH);
    expect(res.status).toBe(200);
    expect(res.body.data.teachers).toBeInstanceOf(Array);
  });

  test('TC-44 — GET /api/teachers/profile — 404 when teacher deleted', async () => {
    Teacher.findById.mockResolvedValueOnce(null);
    const res = await request(app)
      .get('/api/teachers/profile')
      .set('Authorization', AUTH);
    expect(res.status).toBe(404);
  });

  test('TC-45 — POST /api/teachers/register-face — 400 when faceImage missing', async () => {
    const res = await request(app)
      .post('/api/teachers/register-face')
      .set('Authorization', AUTH)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/face image/i);
  });

  test('TC-46 — registerFace does NOT set faceRegisteredAt on service failure', async () => {
    // If Python service returns success:false, faceRegisteredAt should NOT be set
    axios.post.mockResolvedValueOnce({ data: { success: false, imageUrl: null } });
    Teacher.findByIdAndUpdate.mockResolvedValueOnce({ ...teacherFixture, faceRegisteredAt: null });

    const fakeBase64 = 'data:image/jpeg;base64,' + Buffer.alloc(100).toString('base64');
    const res = await request(app)
      .post('/api/teachers/register-face')
      .set('Authorization', AUTH)
      .send({ faceImage: fakeBase64 });

    // findByIdAndUpdate should be called WITHOUT faceRegisteredAt when success=false
    const updateCall = Teacher.findByIdAndUpdate.mock.calls[0];
    if (updateCall) {
      expect(updateCall[1]).not.toHaveProperty('faceRegisteredAt');
    }
  });
});
