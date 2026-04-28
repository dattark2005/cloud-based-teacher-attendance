/**
 * Jest Global Setup — Runs before all tests
 * Sets essential env vars and global mocks
 */

// Environment variables needed by server.js / controllers
process.env.JWT_SECRET        = 'test-secret-key-do-not-use-in-prod';
process.env.JWT_EXPIRES_IN    = '7d';
process.env.NODE_ENV          = 'test';
process.env.PORT              = '5001';  // avoid conflict with running dev server
process.env.FACE_SERVICE_URL  = 'http://localhost:8000';
process.env.FRONTEND_URL      = 'http://localhost:3000';
process.env.CLOUDINARY_CLOUD_NAME = 'test_cloud';
process.env.CLOUDINARY_API_KEY    = 'test_api_key';
process.env.CLOUDINARY_API_SECRET = 'test_api_secret';
process.env.MONGODB_URI       = 'mongodb://localhost:27017/test_db';
