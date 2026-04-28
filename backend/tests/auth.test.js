/**
 * AUTH CONTROLLER TESTS
 * Covers: register, login, getMe — 18 test cases
 */
const request = require('supertest');

// ── Mock Mongoose & bcrypt before requiring app ──────────────────────────────
jest.mock('../models/Teacher', () => {
  const mockTeacher = {
    _id: 'teacher123',
    fullName: 'Dr. Test Teacher',
    employeeId: 'EMP001',
    email: 'test@college.edu',
    department: 'Computer Science',
    designation: 'Assistant Professor',
    profileImage: null,
    faceImageUrl: null,
    faceRegisteredAt: null,
    isActive: true,
    createdAt: new Date('2024-01-01'),
    comparePassword: jest.fn(),
  };

  const MockTeacher = jest.fn();
  MockTeacher.findOne    = jest.fn();
  MockTeacher.findById   = jest.fn();
  MockTeacher.create     = jest.fn();
  MockTeacher.prototype  = mockTeacher;

  // make `new Teacher(...)` work
  MockTeacher.mockImplementation(() => mockTeacher);

  return MockTeacher;
});

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(() => 'mock_jwt_token_xyz'),
  verify: jest.fn(() => ({ id: 'teacher123' })),
}));

jest.mock('../config/database', () => jest.fn());

const app    = require('../server');
const Teacher = require('../models/Teacher');

// ── Helpers ──────────────────────────────────────────────────────────────────
const validRegisterBody = {
  fullName:    'Dr. Priya Sharma',
  employeeId:  'EMP100',
  email:       'priya.sharma@college.edu',
  password:    'SecurePass123',
  department:  'Computer Science',
  designation: 'Professor',
};

afterEach(() => jest.clearAllMocks());

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('POST /api/auth/register', () => {

  test('TC-01 — 400 when required fields missing', async () => {
    const res = await request(app).post('/api/auth/register').send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/required/i);
  });

  test('TC-02 — 400 when fullName missing', async () => {
    const { fullName, ...body } = validRegisterBody;
    const res = await request(app).post('/api/auth/register').send(body);
    expect(res.status).toBe(400);
  });

  test('TC-03 — 400 when email missing', async () => {
    const { email, ...body } = validRegisterBody;
    const res = await request(app).post('/api/auth/register').send(body);
    expect(res.status).toBe(400);
  });

  test('TC-04 — 400 when department missing', async () => {
    const { department, ...body } = validRegisterBody;
    const res = await request(app).post('/api/auth/register').send(body);
    expect(res.status).toBe(400);
  });

  test('TC-05 — 409 when email already exists', async () => {
    Teacher.findOne.mockResolvedValueOnce({
      email: 'priya.sharma@college.edu',
      employeeId: 'EMP999',
    });
    const res = await request(app).post('/api/auth/register').send(validRegisterBody);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/email/i);
  });

  test('TC-06 — 409 when employeeId already exists', async () => {
    Teacher.findOne.mockResolvedValueOnce({
      email: 'other@college.edu',
      employeeId: 'EMP100',
    });
    const res = await request(app).post('/api/auth/register').send(validRegisterBody);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/employeeid/i);
  });

  test('TC-07 — 201 success returns token + teacher', async () => {
    Teacher.findOne.mockResolvedValueOnce(null); // no duplicate
    Teacher.create.mockResolvedValueOnce({
      _id: 'newId',
      ...validRegisterBody,
      isActive: true,
      faceRegisteredAt: null,
      faceImageUrl: null,
      profileImage: null,
      createdAt: new Date(),
    });
    Teacher.findById.mockResolvedValueOnce({
      _id: 'newId',
      ...validRegisterBody,
      isActive: true,
      faceRegisteredAt: null,
      faceImageUrl: null,
      profileImage: null,
      createdAt: new Date(),
    });

    const res = await request(app).post('/api/auth/register').send(validRegisterBody);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('token');
    expect(res.body.data).toHaveProperty('teacher');
  });

  test('TC-08 — designation defaults to Assistant Professor if not provided', async () => {
    const { designation, ...body } = validRegisterBody;
    Teacher.findOne.mockResolvedValueOnce(null);
    Teacher.create.mockResolvedValueOnce({ _id: 'id2', ...body, designation: 'Assistant Professor', isActive: true, faceRegisteredAt: null, faceImageUrl: null, profileImage: null, createdAt: new Date() });
    Teacher.findById.mockResolvedValueOnce({ _id: 'id2', ...body, designation: 'Assistant Professor', isActive: true, faceRegisteredAt: null, faceImageUrl: null, profileImage: null, createdAt: new Date() });
    const res = await request(app).post('/api/auth/register').send(body);
    expect(res.status).toBe(201);
    // The create call should have received default designation
    expect(Teacher.create).toHaveBeenCalledWith(
      expect.objectContaining({ designation: 'Assistant Professor' })
    );
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('POST /api/auth/login', () => {

  test('TC-09 — 400 when email or password missing', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'a@b.com' });
    expect(res.status).toBe(400);
  });

  test('TC-10 — 401 when teacher not found', async () => {
    Teacher.findOne.mockReturnValueOnce({ select: jest.fn().mockResolvedValueOnce(null) });
    const res = await request(app).post('/api/auth/login').send({ email: 'x@y.com', password: 'abc' });
    expect(res.status).toBe(401);
  });

  test('TC-11 — 401 when password incorrect', async () => {
    const fakeTeacher = { comparePassword: jest.fn().mockResolvedValueOnce(false), isActive: true };
    Teacher.findOne.mockReturnValueOnce({ select: jest.fn().mockResolvedValueOnce(fakeTeacher) });
    const res = await request(app).post('/api/auth/login').send({ email: 'a@b.com', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  test('TC-12 — 403 when account deactivated', async () => {
    const fakeTeacher = { comparePassword: jest.fn().mockResolvedValueOnce(true), isActive: false };
    Teacher.findOne.mockReturnValueOnce({ select: jest.fn().mockResolvedValueOnce(fakeTeacher) });
    const res = await request(app).post('/api/auth/login').send({ email: 'a@b.com', password: 'pass' });
    expect(res.status).toBe(403);
  });

  test('TC-13 — 200 success returns token', async () => {
    const fakeTeacher = { _id: 'teacher123', comparePassword: jest.fn().mockResolvedValueOnce(true), isActive: true };
    Teacher.findOne.mockReturnValueOnce({ select: jest.fn().mockResolvedValueOnce(fakeTeacher) });
    Teacher.findById.mockResolvedValueOnce({ _id: 'teacher123', fullName: 'Dr. Test', employeeId: 'EMP001', email: 'a@b.com', department: 'CS', designation: 'Prof', profileImage: null, faceImageUrl: null, faceRegisteredAt: null, createdAt: new Date() });

    const res = await request(app).post('/api/auth/login').send({ email: 'a@b.com', password: 'correct' });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('token', 'mock_jwt_token_xyz');
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('GET /api/auth/me', () => {

  test('TC-14 — 401 when no token provided', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  test('TC-15 — 401 when token is malformed', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer bad.token.here');
    expect(res.status).toBe(401);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('Health endpoint', () => {
  test('TC-16 — GET /health returns 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('TC-17 — 404 for unknown routes', async () => {
    const res = await request(app).get('/api/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  test('TC-18 — response has timestamp', async () => {
    const res = await request(app).get('/health');
    expect(res.body).toHaveProperty('timestamp');
    expect(new Date(res.body.timestamp).toString()).not.toBe('Invalid Date');
  });
});
