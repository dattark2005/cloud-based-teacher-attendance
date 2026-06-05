const mongoose = require('mongoose');

const biometricLogSchema = new mongoose.Schema(
  {
    teacherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Teacher',
      required: true,
    },
    biometricType: {
      type: String,
      enum: ['FACE', 'VOICE'],
      required: true,
    },
    action: {
      type: String,
      enum: ['REGISTER', 'UPDATE', 'DELETE'],
      required: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
    details: {
      type: String,
      default: '',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('BiometricLog', biometricLogSchema);
