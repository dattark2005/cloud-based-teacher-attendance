const mongoose = require('mongoose');

const connectDB = async (retries = 5) => {
  for (let i = 0; i < retries; i++) {
    try {
      const conn = await mongoose.connect(process.env.MONGODB_URI, {
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
      });
      console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
      return;
    } catch (error) {
      console.error(`❌ MongoDB attempt ${i+1}/${retries}: ${error.message}`);
      if (i < retries - 1) {
        console.log(`⏳ Retrying in 3s...`);
        await new Promise(r => setTimeout(r, 3000));
      } else {
        console.error('❌ MongoDB failed after all retries. Server will run without DB.');
      }
    }
  }
};

module.exports = connectDB;
