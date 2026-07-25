const mongoose = require('mongoose');

const connectDB = async (retries = 3) => {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.error('❌ MONGODB_URI is not set in .env file!');
    return;
  }

  for (let i = 0; i < retries; i++) {
    try {
      const conn = await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 8000,
        socketTimeoutMS: 45000,
      });
      console.log(`✅ MongoDB Atlas Connected: ${conn.connection.host}`);
      return;
    } catch (error) {
      console.error(`❌ MongoDB attempt ${i+1}/${retries}: ${error.message}`);

      if (error.message.includes('whitelist') || error.message.includes('IP')) {
        console.error('🔒 FIX: Go to MongoDB Atlas → Security → Network Access → Add your current IP address');
        break; // No point retrying for IP whitelist issues
      }

      if (i < retries - 1) {
        console.log(`⏳ Retrying in 3s...`);
        await new Promise(r => setTimeout(r, 3000));
      } else {
        console.error('❌ MongoDB Atlas failed after all retries. Server will run without DB.');
        console.error('🔒 If IP whitelist error: MongoDB Atlas → Security → Network Access → Add IP');
      }
    }
  }
};

module.exports = connectDB;
