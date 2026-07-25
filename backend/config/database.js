const mongoose = require('mongoose');

const connectDB = async (retries = 3) => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/teacher_attendance';

  for (let i = 0; i < retries; i++) {
    try {
      const conn = await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      });
      console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
      return;
    } catch (error) {
      console.error(`❌ MongoDB attempt ${i+1}/${retries}: ${error.message}`);
      if (i < retries - 1) {
        console.log(`⏳ Retrying in 2s...`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  // Fallback to local MongoDB if remote MongoDB Atlas cluster timed out or failed IP whitelisting
  if (uri.includes('mongodb.net') || uri.includes('shard')) {
    console.log('⚠️ Remote MongoDB Atlas failed (IP whitelist or network issue). Trying local MongoDB fallback (mongodb://localhost:27017)...');
    try {
      const localConn = await mongoose.connect('mongodb://localhost:27017/teacher_attendance', {
        serverSelectionTimeoutMS: 3000,
      });
      console.log(`✅ MongoDB Connected (Local Fallback): ${localConn.connection.host}`);
      return;
    } catch (localErr) {
      console.error(`❌ Local MongoDB fallback also failed: ${localErr.message}`);
    }
  }

  console.error('❌ MongoDB failed after all retries.');
};

module.exports = connectDB;
