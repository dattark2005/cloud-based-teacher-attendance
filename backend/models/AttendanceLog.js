const mongoose = require('mongoose');

const attendanceLogSchema = new mongoose.Schema(
  {
    teacherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Teacher',
      required: true,
    },
    date: {
      type: String, // YYYY-MM-DD
      required: true,
    },
    checkInTime: {
      type: Date,
      default: null,
    },
    checkOutTime: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ['PRESENT', 'ABSENT', 'LATE'],
      default: 'PRESENT',
    },
    verificationMethod: {
      type: String,
      enum: ['FACE', 'FACE_LOCAL', 'MANUAL'],
      default: 'FACE',
    },
    confidenceScore: {
      type: Number,
      min: 0,
      max: 1,
      default: null,
    },
    snapshotUrl: {
      type: String,
      default: null,
    },
    location: {
      type: String,
      default: 'Campus Entrance',
    },
    // For audit log — each scan creates a timestamped entry
    logs: [
      {
        event: { type: String, enum: ['CHECK_IN', 'CHECK_OUT'] },
        timestamp: { type: Date, default: Date.now },
        confidence: { type: Number },
        snapshotUrl: { type: String },
      },
    ],
  },
  { timestamps: true }
);

// One record per teacher per day
attendanceLogSchema.index({ teacherId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('AttendanceLog', attendanceLogSchema);
