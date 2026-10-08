const mongoose = require('mongoose');
const crypto = require('crypto');

const AnswerDetailSchema = new mongoose.Schema({
  questionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Question',
    required: true
  },
  questionType: {
    type: String,
    enum: ['SINGLE', 'MULTIPLE', 'SUBJECTIVE'],
    default: 'SINGLE'
  },
  selectedAnswer: {
    type: String,
    default: ''
  },
  selectedAnswers: {
    type: [String],
    default: []
  },
  correctAnswer: {
    type: String
  },
  correctAnswers: {
    type: [String],
    default: []
  },
  isCorrect: {
    type: Boolean,
    default: false
  },
  marksObtained: {
    type: Number,
    default: 0
  },
  // Production-Ready Subjective Evaluation Fields
  answerText: {
    type: String,
    default: ''
  },
  evaluationStatus: {
    type: String,
    enum: [
      'NOT_APPLICABLE',
      'QUEUED_FOR_EVALUATION',
      'EVALUATING',
      'AUTO_GRADED',
      'AUTO_GRADED_REVIEW_RECOMMENDED',
      'MANUAL_REVIEW_REQUIRED',
      'FALLBACK_EVALUATION',
      'TEACHER_OVERRIDDEN'
    ],
    default: 'NOT_APPLICABLE'
  },
  evaluationScore: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  confidenceScore: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  awardedMarks: {
    type: Number,
    default: 0
  },
  maximumMarks: {
    type: Number,
    default: 1
  },
  keywordScore: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  conceptScore: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  semanticScore: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  aiScore: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  matchedKeywords: {
    type: [String],
    default: []
  },
  missingKeywords: {
    type: [String],
    default: []
  },
  matchedConcepts: {
    type: [String],
    default: []
  },
  missingConcepts: {
    type: [String],
    default: []
  },
  incorrectClaims: {
    type: [String],
    default: []
  },
  evaluationReason: {
    type: String,
    default: ''
  },
  evaluatedAt: {
    type: Date,
    default: null
  },
  evaluatedBy: {
    type: String,
    default: ''
  },
  evaluationVersion: {
    type: String,
    default: 'subjective-v1'
  },
  originalAiSuggestedMarks: {
    type: Number,
    default: 0
  },
  overrideReason: {
    type: String,
    default: ''
  }
}, { _id: false });

const ResultSchema = new mongoose.Schema({
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
  attemptId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ExamAttempt',
    default: null
  },
  verificationId: {
    type: String,
    unique: true,
    sparse: true,
    default: () => 'GLB-VRF-' + crypto.randomBytes(6).toString('hex').toUpperCase()
  },
  answers: [AnswerDetailSchema],
  score: {
    type: Number,
    required: true
  },
  totalMarks: {
    type: Number,
    required: true
  },
  percentage: {
    type: Number,
    required: true
  },
  correctAnswers: {
    type: Number,
    required: true
  },
  wrongAnswers: {
    type: Number,
    required: true
  },
  unattempted: {
    type: Number,
    required: true
  },
  negativeMarksDeducted: {
    type: Number,
    default: 0
  },
  timeTaken: {
    type: String,
    default: '00:00'
  },
  warningCount: {
    type: Number,
    default: 0
  },
  submissionReason: {
    type: String,
    enum: ['NORMAL', 'TIMEOUT', 'TAB_SWITCH_LIMIT', 'ADMIN_DISQUALIFIED'],
    default: 'NORMAL'
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
  hasSubjectiveQuestions: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    enum: ['PROCESSING', 'PARTIALLY_EVALUATED', 'EVALUATED', 'MANUAL_REVIEW_REQUIRED'],
    default: 'EVALUATED'
  },
  subjectiveReviewStatus: {
    type: String,
    enum: ['NONE', 'QUEUED_FOR_EVALUATION', 'EVALUATING', 'ALL_AUTO_GRADED', 'REVIEW_RECOMMENDED', 'MANUAL_REVIEW_REQUIRED', 'COMPLETED_BY_TEACHER'],
    default: 'NONE'
  },
  submittedAt: {
    type: Date,
    default: Date.now
  }
});

// Ensure attemptId is unique when present (ObjectId) while safely permitting multiple null/missing legacy results
ResultSchema.index(
  { attemptId: 1 },
  {
    unique: true,
    partialFilterExpression: { attemptId: { $type: 'objectId' } }
  }
);

// High-throughput composite indexes for rapid filtering, pagination, and leaderboard calculations
ResultSchema.index({ studentId: 1, examId: 1 });
ResultSchema.index({ examId: 1, submittedAt: -1 });
ResultSchema.index({ examId: 1, subjectiveReviewStatus: 1 });
ResultSchema.index({ status: 1 });

module.exports = mongoose.model('Result', ResultSchema);
