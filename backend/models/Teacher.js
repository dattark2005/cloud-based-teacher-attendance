const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const teacherSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: [true, 'Full name is required'],
      trim: true,
    },
    employeeId: {
      type: String,
      required: [true, 'Employee ID is required'],
      unique: true,
      uppercase: true,
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: 6,
      select: false,
    },
    department: {
      type: String,
      required: [true, 'Department is required'],
      trim: true,
    },
    designation: {
      type: String,
      default: 'Assistant Professor',
    },
    phone: {
      type: String,
      default: null,
    },
    profileImage: {
      type: String,
      default: null,
    },
    // Face recognition
    faceEncoding: {
      type: Buffer,
      select: false,
    },
    faceImageUrl: {
      type: String,
      default: null,
    },
    faceImageData: {
      type: Buffer,
      select: false,
    },
    faceRegisteredAt: {
      type: Date,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    role: {
      type: String,
      enum: ['TEACHER', 'ADMIN'],
      default: 'TEACHER',
    },
  },
  { timestamps: true }
);

// Hash password before save
teacherSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password
teacherSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('Teacher', teacherSchema);
