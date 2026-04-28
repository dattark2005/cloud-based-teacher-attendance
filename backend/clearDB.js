require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const mongoose = require('mongoose');
const Teacher = require('./models/Teacher');
const AttendanceLog = require('./models/AttendanceLog');

async function clearDB() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // 1. Delete all Attendance Logs
    const logRes = await AttendanceLog.deleteMany({});
    console.log(`Deleted ${logRes.deletedCount} attendance logs.`);

    // 2. Delete all Teachers EXCEPT those with role='ADMIN'
    const teacherRes = await Teacher.deleteMany();
    console.log(`Deleted ${teacherRes.deletedCount} teachers (Admins were preserved).`);

    console.log('Database successfully cleared!');
    process.exit(0);
  } catch (err) {
    console.error('Error clearing database:', err);
    process.exit(1);
  }
}

clearDB();
