const request = require('supertest');

// Mocks
jest.mock('../models/Teacher');
jest.mock('../models/BiometricLog');
jest.mock('../models/AttendanceLog');
jest.mock('../config/database', () => jest.fn());
jest.mock('axios');
jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(() => 'mock_token'),
  verify: jest.fn(() => ({ id: 'teacher123' })),
}));
jest.mock('../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.teacher = { _id: 'teacher123', department: 'CS' };
    next();
  },
  authorizeAdmin: (req, res, next) => {
    req.teacher = { _id: 'teacher123', role: 'admin', department: 'CS' };
    next();
  },
}));

const app = require('../server');
const BiometricLog = require('../models/BiometricLog');
const Teacher = require('../models/Teacher');
const axios = require('axios');

const AUTH = 'Bearer mock_token';

describe('BiometricLog & Deletion Endpoints', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/teachers/biometric-log', () => {
    test('should log biometric activity successfully', async () => {
      const mockSave = jest.fn().mockResolvedValue({
        teacherId: 'teacher123',
        biometricType: 'VOICE',
        action: 'REGISTER',
        details: 'Voice registered',
      });
      BiometricLog.mockImplementation(() => ({
        save: mockSave,
      }));

      const res = await request(app)
        .post('/api/teachers/biometric-log')
        .set('Authorization', AUTH)
        .send({ biometricType: 'VOICE', action: 'REGISTER', details: 'Voice registered' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/logged successfully/i);
    });

    test('should reject invalid action', async () => {
      const res = await request(app)
        .post('/api/teachers/biometric-log')
        .set('Authorization', AUTH)
        .send({ biometricType: 'VOICE', action: 'INVALID_ACTION', details: 'Voice registered' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /api/teachers/biometric-logs', () => {
    test('should fetch biometric logs for the teacher', async () => {
      const mockLogs = [
        { teacherId: 'teacher123', biometricType: 'VOICE', action: 'REGISTER', details: 'Initial register', timestamp: new Date() },
      ];
      BiometricLog.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue(mockLogs),
      });

      const res = await request(app)
        .get('/api/teachers/biometric-logs')
        .set('Authorization', AUTH);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
    });
  });

  describe('GET /api/teachers/profile voiceRegistered check', () => {
    test('should return voiceRegistered: true if teacher has voiceEncoding set in DB', async () => {
      Teacher.findById.mockResolvedValueOnce({
        _id: 'teacher123',
        fullName: 'Test Teacher',
        email: 'test@example.com',
        voiceEncoding: Buffer.from('mock_voice_bytes'),
      });
      BiometricLog.findOne.mockReturnValueOnce({
        sort: jest.fn().mockResolvedValueOnce(null),
      });

      const res = await request(app)
        .get('/api/teachers/profile')
        .set('Authorization', AUTH);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.teacher.voiceRegistered).toBe(true);
    });

    test('should return voiceRegistered: true if latest BiometricLog is REGISTER even without loaded voiceEncoding', async () => {
      Teacher.findById.mockResolvedValueOnce({
        _id: 'teacher123',
        fullName: 'Test Teacher',
        email: 'test@example.com',
      });
      BiometricLog.findOne.mockReturnValueOnce({
        sort: jest.fn().mockResolvedValueOnce({ action: 'REGISTER' }),
      });

      const res = await request(app)
        .get('/api/teachers/profile')
        .set('Authorization', AUTH);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.teacher.voiceRegistered).toBe(true);
    });
  });

  describe('DELETE /api/teachers/face', () => {
    test('should delete face registration successfully', async () => {
      Teacher.findById.mockResolvedValueOnce({
        _id: 'teacher123',
        faceRegisteredAt: new Date(),
      });
      Teacher.findByIdAndUpdate.mockResolvedValueOnce({
        _id: 'teacher123',
      });
      const mockSave = jest.fn().mockResolvedValue(true);
      BiometricLog.mockImplementation(() => ({
        save: mockSave,
      }));

      const res = await request(app)
        .delete('/api/teachers/face')
        .set('Authorization', AUTH);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/deleted successfully/i);
      expect(Teacher.findByIdAndUpdate).toHaveBeenCalled();
    });

    test('should return 400 if face not registered', async () => {
      Teacher.findById.mockResolvedValueOnce({
        _id: 'teacher123',
        faceRegisteredAt: null,
      });

      const res = await request(app)
        .delete('/api/teachers/face')
        .set('Authorization', AUTH);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('DELETE /api/teachers/voice', () => {
    test('should delete voice registration successfully', async () => {
      Teacher.findById.mockResolvedValue({
        _id: 'teacher123',
        voiceEncoding: Buffer.from('test_voice'),
      });
      const mockLatestLog = {
        action: 'REGISTER',
      };
      BiometricLog.findOne.mockReturnValueOnce({
        sort: jest.fn().mockResolvedValueOnce(mockLatestLog),
      });
      Teacher.findByIdAndUpdate.mockResolvedValueOnce({
        _id: 'teacher123',
      });
      axios.delete.mockResolvedValueOnce({ data: { success: true } });
      const mockSave = jest.fn().mockResolvedValue(true);
      BiometricLog.mockImplementation(() => ({
        save: mockSave,
      }));

      const res = await request(app)
        .delete('/api/teachers/voice')
        .set('Authorization', AUTH);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/deleted successfully/i);
      expect(Teacher.findByIdAndUpdate).toHaveBeenCalledWith('teacher123', { $unset: { voiceEncoding: '' } });
    });

    test('should return 400 if voice not registered', async () => {
      Teacher.findById.mockResolvedValue({
        _id: 'teacher123',
        voiceEncoding: null,
      });
      BiometricLog.findOne.mockReturnValueOnce({
        sort: jest.fn().mockResolvedValueOnce(null),
      });

      const res = await request(app)
        .delete('/api/teachers/voice')
        .set('Authorization', AUTH);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });
});
