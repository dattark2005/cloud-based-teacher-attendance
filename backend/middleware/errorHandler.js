const fs = require('fs');
const path = require('path');

const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';

  // Log error to a local file for debugging
  try {
    const logDir = __dirname;
    const logFile = path.join(logDir, '../error.log');
    const logMessage = `[${new Date().toISOString()}] ${req.method} ${req.originalUrl}\nError: ${err.message}\nStack: ${err.stack}\n\n`;
    fs.appendFileSync(logFile, logMessage);
  } catch (logErr) {
    console.error('Failed to write to error.log:', logErr);
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    statusCode = 400;
    const field = Object.keys(err.keyValue)[0];
    message = `${field.charAt(0).toUpperCase() + field.slice(1)} already exists`;
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = Object.values(err.errors).map(e => e.message).join(', ');
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
  }

  if (process.env.NODE_ENV === 'development') {
    console.error('❌ Error:', err);
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

const notFound = (req, res, next) => {
  const err = new Error(`Not found - ${req.originalUrl}`);
  err.statusCode = 404;
  next(err);
};

module.exports = { errorHandler, notFound };

