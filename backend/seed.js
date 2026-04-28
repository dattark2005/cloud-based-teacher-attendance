/**
 * seed.js — Insert demo teachers into MongoDB
 * Run from backend dir:  node seed.js
 */
require('dotenv').config();                // loads backend/.env
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const MONGO_URI = process.env.MONGODB_URI;

const teacherSchema = new mongoose.Schema({
  fullName:         { type: String, required: true },
  employeeId:       { type: String, required: true, unique: true, uppercase: true },
  email:            { type: String, required: true, unique: true, lowercase: true },
  password:         { type: String, required: true },
  department:       { type: String, required: true },
  designation:      { type: String, default: 'Assistant Professor' },
  phone:            { type: String, default: null },
  profileImage:     { type: String, default: null },
  faceEncoding:     { type: Buffer, select: false },
  faceImageUrl:     { type: String, default: null },
  faceImageData:    { type: Buffer, select: false },
  faceRegisteredAt: { type: Date,   default: null },
  isActive:         { type: Boolean, default: true },
}, { timestamps: true });

const Teacher = mongoose.model('Teacher', teacherSchema);

const DEMO = [
  {
    fullName:    'Demo Teacher',
    employeeId:  'EMP001',
    email:       'demo@teacher.com',
    password:    'demo1234',
    department:  'Computer Science',
    designation: 'Assistant Professor',
    phone:       '9876543210',
  },
  {
    fullName:    'Admin User',
    employeeId:  'EMP002',
    email:       'admin@teacher.com',
    password:    'admin1234',
    department:  'Information Technology',
    designation: 'Associate Professor',
    phone:       '9876543211',
    role:        'ADMIN',
  },
];

async function seed() {
  console.log('\n[*] Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('[OK] Connected!\n');

  for (const data of DEMO) {
    const exists = await Teacher.findOne({ email: data.email });
    if (exists) {
      console.log(`[--] ${data.email} already exists — skipping`);
      continue;
    }
    const hashed  = await bcrypt.hash(data.password, 12);
    const teacher = await Teacher.create({ ...data, password: hashed });
    console.log(`[++] Created: ${teacher.fullName}`);
    console.log(`     Email       : ${data.email}`);
    console.log(`     Password    : ${data.password}`);
    console.log(`     Employee ID : ${teacher.employeeId}`);
    console.log(`     Department  : ${teacher.department}`);
    console.log();
  }

  await mongoose.disconnect();
  console.log('[OK] Seed complete!\n');
}

seed().catch(err => {
  console.error('[!!] Seed failed:', err.message);
  process.exit(1);
});
