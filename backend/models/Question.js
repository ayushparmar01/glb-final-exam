const mongoose = require('mongoose');

const RubricCriterionSchema = new mongoose.Schema({
  criterion: {
    type: String,
    required: true,
    trim: true
  },
  marks: {
    type: Number,
    required: true,
    min: 0
  },
  description: {
    type: String,
    trim: true,
    default: ''
  }
}, { _id: false });

const EvaluationConfigSchema = new mongoose.Schema({
  enabled: {
    type: Boolean,
    default: true
  },
  threshold: {
    type: Number,
    default: 70,
    min: 0,
    max: 100
  },
  autoGrade: {
    type: Boolean,
    default: true
  },
  keywordWeight: {
    type: Number,
    default: 25,
    min: 0,
    max: 100
  },
  conceptWeight: {
    type: Number,
    default: 25,
    min: 0,
    max: 100
  },
  semanticWeight: {
    type: Number,
    default: 30,
    min: 0,
    max: 100
  },
  aiWeight: {
    type: Number,
    default: 20,
    min: 0,
    max: 100
  },
  allowTeacherOverride: {
    type: Boolean,
    default: true
  },
  minWords: {
    type: Number,
    default: 0
  },
  maxWords: {
    type: Number,
    default: 2000
  }
}, { _id: false });

const QuestionSchema = new mongoose.Schema({
  examId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Exam',
    required: [true, 'Question must belong to an exam']
  },
  questionText: {
    type: String,
    required: [true, 'Please provide question text'],
    trim: true
  },
  options: {
    type: [String],
    default: [],
    validate: {
      validator: function (opts) {
        if (this.type === 'SUBJECTIVE') return true;
        return Array.isArray(opts) && opts.length >= 2;
      },
      message: 'Objective questions (SINGLE/MULTIPLE) must have at least 2 options'
    }
  },
  type: {
    type: String,
    enum: ['SINGLE', 'MULTIPLE', 'SUBJECTIVE'],
    default: 'SINGLE'
  },
  correctAnswer: {
    type: String,
    default: ''
  },
  correctAnswers: {
    type: [String],
    default: []
  },
  // Fields for Subjective / Descriptive questions
  expectedAnswer: {
    type: String,
    trim: true,
    default: ''
  },
  keywords: {
    type: [String],
    default: []
  },
  keyConcepts: {
    type: [String],
    default: []
  },
  rubric: {
    type: [RubricCriterionSchema],
    default: []
  },
  evaluationConfig: {
    type: EvaluationConfigSchema,
    default: () => ({})
  },
  marks: {
    type: Number,
    default: 1,
    min: [0.5, 'Marks must be at least 0.5']
  },
  explanation: {
    type: String,
    default: ''
  },
  imageUrl: {
    type: String,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Question', QuestionSchema);
