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
    // Primary method (backwards compat)
    verificationMethod: {
      type: String,
      enum: ['FACE', 'FACE_LOCAL', 'MANUAL', 'VOICE', 'FACE+VOICE'],
      default: 'FACE',
    },
    // Array of ALL methods used — supports FACE, VOICE, or both
    verificationMethods: {
      type: [String],
      enum: ['FACE', 'FACE_LOCAL', 'MANUAL', 'VOICE'],
      default: [],
    },
    confidenceScore: {
      type: Number,
      min: 0,
      max: 1,
      default: null,
    },
    voiceSimilarity: {
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
    // Per-event audit log
    logs: [
      {
        event:      { type: String, enum: ['CHECK_IN', 'CHECK_OUT'] },
        method:     { type: String, enum: ['FACE', 'FACE_LOCAL', 'MANUAL', 'VOICE'] },
        timestamp:  { type: Date, default: Date.now },
        confidence: { type: Number },
        snapshotUrl:{ type: String },
      },
    ],
  },
  { timestamps: true }
);

// One record per teacher per day
attendanceLogSchema.index({ teacherId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('AttendanceLog', attendanceLogSchema);
