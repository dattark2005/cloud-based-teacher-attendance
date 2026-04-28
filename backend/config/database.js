const mongoose = require('mongoose');

const MONGO_OPTS = {
  serverSelectionTimeoutMS: 15000,   // how long to wait for a server
  socketTimeoutMS: 60000,            // how long a socket stays idle
  heartbeatFrequencyMS: 10000,       // ping Atlas every 10s to keep alive
  connectTimeoutMS: 20000,           // initial connect timeout
  maxPoolSize: 10,
  retryWrites: true,
  retryReads: true,
};

const connectDB = async (retries = 5) => {
  for (let i = 0; i < retries; i++) {
    try {
      const conn = await mongoose.connect(process.env.MONGODB_URI, MONGO_OPTS);
      console.log(`✅ MongoDB Connected: ${conn.connection.host}`);

      // Auto-reconnect on unexpected disconnect
      mongoose.connection.on('disconnected', () => {
        console.warn('⚠️  MongoDB disconnected — reconnecting in 5s...');
        setTimeout(() => connectDB(3), 5000);
      });
      mongoose.connection.on('error', (err) => {
        console.error('❌ MongoDB error:', err.message);
      });

      return;
    } catch (error) {
      console.error(`❌ MongoDB attempt ${i + 1}/${retries}: ${error.message}`);
      if (i < retries - 1) {
        const wait = (i + 1) * 3000;   // back-off: 3s, 6s, 9s…
        console.log(`⏳ Retrying in ${wait / 1000}s...`);
        await new Promise(r => setTimeout(r, wait));
      } else {
        console.error('❌ MongoDB failed after all retries. Server will run without DB.');
      }
    }
  }
};

module.exports = connectDB;
