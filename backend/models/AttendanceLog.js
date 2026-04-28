const mongoose = require('mongoose');

// ── Movement within a session (gate exits/returns) ────────────────────────────
const movementSchema = new mongoose.Schema(
  {
    type:       { type: String, enum: ['GATE_OUT', 'GATE_IN'], required: true },
    timestamp:  { type: Date, default: Date.now },
    confidence: { type: Number, default: null },
  },
  { _id: true }
);

// ── One cabin-in → cabin-out session ─────────────────────────────────────────
const sessionSchema = new mongoose.Schema(
  {
    cabinInTime:  { type: Date, required: true },
    cabinOutTime: { type: Date, default: null },      // null = session still open
    status:       { type: String, enum: ['PRESENT'], default: 'PRESENT' },
    confidence:   { type: Number, default: null },
    location:     { type: String, default: 'Admin Cabin' },
    movements:    [movementSchema],                   // chronological gate events
  },
  { _id: true }
);

// ── One document per teacher per day ─────────────────────────────────────────
const attendanceLogSchema = new mongoose.Schema(
  {
    teacherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  'Teacher',
      required: true,
    },
    date: {
      type:     String,   // YYYY-MM-DD
      required: true,
    },
    // Convenience top-level fields (first cabin-in / last cabin-out of the day)
    checkInTime:  { type: Date, default: null },
    checkOutTime: { type: Date, default: null },
    status: {
      type:    String,
      enum:    ['PRESENT', 'ABSENT'],
      default: 'ABSENT',
    },
    verificationMethod: {
      type:    String,
      enum:    ['FACE', 'FACE_LOCAL', 'MANUAL'],
      default: 'FACE',
    },
    confidenceScore: { type: Number, min: 0, max: 1, default: null },
    snapshotUrl:     { type: String, default: null },
    location:        { type: String, default: 'Admin Cabin' },

    // Session array — each element is one cabin-in → cabin-out block
    sessions: [sessionSchema],
  },
  { timestamps: true }
);

// One record per teacher per day
attendanceLogSchema.index({ teacherId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('AttendanceLog', attendanceLogSchema);
