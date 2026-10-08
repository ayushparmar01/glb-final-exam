const mongoose = require('mongoose');

const ExamAttemptSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  examId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Exam',
    required: true
  },
  startTime: {
    type: Date,
    default: Date.now
  },
  endTime: {
    type: Date
  },
  status: {
    type: String,
    enum: ['IN_PROGRESS', 'SUBMITTING', 'SUBMITTED', 'EXPIRED'],
    default: 'IN_PROGRESS'
  },
  savedAnswers: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {}
  },
  markedForReview: {
    type: [String],
    default: []
  },
  warningCount: {
    type: Number,
    default: 0,
    min: 0
  },
  disqualified: {
    type: Boolean,
    default: false
  },
  disqualificationReason: {
    type: String,
    default: ''
  },
  currentQuestionIndex: {
    type: Number,
    default: 0
  },
  lastActiveAt: {
    type: Date,
    default: Date.now
  },
  extraTimeMinutes: {
    type: Number,
    default: 0
  },
  adminBroadcastMessage: {
    type: String,
    default: ''
  },
  cameraStatus: {
    type: String,
    enum: ['ACTIVE', 'DISCONNECTED', 'BLOCKED', 'NOT_REQUIRED', 'UNKNOWN'],
    default: 'UNKNOWN'
  },
  latestCameraSnapshot: {
    type: String,
    default: ''
  },
  proctorLogs: [
    {
      timestamp: {
        type: Date,
        default: Date.now
      },
      eventType: {
        type: String,
        required: true
      },
      reason: {
        type: String,
        default: ''
      }
    }
  ],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// High-concurrency compound indexes for active attempt lookups, heartbeats, and status queries
ExamAttemptSchema.index({ studentId: 1, examId: 1, status: 1 });
ExamAttemptSchema.index({ examId: 1, lastActiveAt: -1 });
ExamAttemptSchema.index({ status: 1 });

module.exports = mongoose.model('ExamAttempt', ExamAttemptSchema);
