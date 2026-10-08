const mongoose = require('mongoose');

const ExportJobSchema = new mongoose.Schema(
  {
    jobId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    format: {
      type: String,
      enum: ['csv', 'xlsx'],
      default: 'csv',
      required: true
    },
    status: {
      type: String,
      enum: ['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED'],
      default: 'QUEUED',
      index: true
    },
    filters: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    totalRecords: {
      type: Number,
      default: 0
    },
    processedRecords: {
      type: Number,
      default: 0
    },
    progressPercentage: {
      type: Number,
      default: 0
    },
    fileName: {
      type: String
    },
    filePath: {
      type: String
    },
    fileSize: {
      type: Number,
      default: 0
    },
    errorMessage: {
      type: String,
      default: null
    },
    startedAt: {
      type: Date,
      default: null
    },
    completedAt: {
      type: Date,
      default: null
    },
    expiresAt: {
      type: Date,
      index: true
    }
  },
  {
    timestamps: true
  }
);

// Compound index for querying user's export history sorted by recency
ExportJobSchema.index({ createdBy: 1, createdAt: -1 });

module.exports = mongoose.model('ExportJob', ExportJobSchema);
