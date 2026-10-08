/**
 * Memory-Efficient Asynchronous Export Queue & Worker (ExamSphere)
 * Supports streaming CSV and batched XLSX generation for 10,000+ to 100,000+ student results.
 * Prevents Node.js heap memory exhaustion, request timeouts, and server crashes.
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const ExportJob = require('../models/ExportJob');
const Result = require('../models/Result');
const ExportStorageService = require('../services/exportStorageService');

const EXPORT_HEADERS = [
  'Student Name',
  'Email',
  'Roll Number',
  'Enrollment Number',
  'Branch',
  'Semester',
  'Section',
  'Batch',
  'Student Status',
  'Exam Name',
  'Exam Code',
  'Subject',
  'Subject Code',
  'Marks',
  'Maximum Marks',
  'Percentage',
  'Result Status',
  'Submitted At',
  'Verification ID'
];

const escapeCsvValue = (val) => {
  if (val === null || val === undefined) return '""';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `"${str}"`;
};

const formatResultRow = (result) => {
  const student = result.studentId || {};
  const exam = result.examId || {};
  const subject = (exam.subjectId && typeof exam.subjectId === 'object') ? exam.subjectId : null;
  const passMarks = exam.passMarks != null ? exam.passMarks : 0;
  const score = result.score != null ? result.score : 0;
  const totalMarks = result.totalMarks != null ? result.totalMarks : (exam.totalMarks || 0);
  const isPassed = score >= passMarks;

  let percentageStr = '0%';
  if (result.percentage != null) {
    percentageStr = `${result.percentage}%`;
  } else if (totalMarks > 0) {
    percentageStr = `${((score / totalMarks) * 100).toFixed(2)}%`;
  }

  let formattedDate = '';
  if (result.submittedAt) {
    try {
      formattedDate = new Date(result.submittedAt).toISOString().replace('T', ' ').substring(0, 19);
    } catch (e) {
      formattedDate = String(result.submittedAt);
    }
  }

  return {
    studentName: student.name || 'N/A',
    email: student.email || 'N/A',
    rollNumber: student.rollNumber || '',
    enrollmentNumber: student.enrollmentNumber || '',
    branch: student.branch || '',
    semester: student.semester ? String(student.semester) : '',
    section: student.section || '',
    batch: student.batch || '',
    studentStatus: student.status || 'ACTIVE',
    examName: exam.title || 'N/A',
    examCode: exam.subjectCode || '',
    subjectName: (subject && subject.name) ? subject.name : '',
    subjectCode: (subject && subject.subjectCode) ? subject.subjectCode : (exam.subjectCode || ''),
    marks: score,
    maximumMarks: totalMarks,
    percentage: percentageStr,
    resultStatus: isPassed ? 'Passed' : 'Failed',
    isPassed,
    submittedAt: formattedDate,
    verificationId: result.verificationId || ''
  };
};

class ExportQueueEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.concurrency = Number(options.concurrency || process.env.EXPORT_CONCURRENCY || 3);
    this.jobsQueue = [];
    this.activeWorkers = 0;
    this.io = null;

    // Periodic check for queued jobs & expired file cleanup
    this.ticker = setInterval(() => {
      this.processNextJobs();
    }, 250).unref();

    // Run expiration cleanup every 1 hour
    this.cleanupTicker = setInterval(() => {
      ExportStorageService.cleanupExpiredExports(ExportJob);
    }, 60 * 60 * 1000).unref();
  }

  setSocketIO(io) {
    this.io = io;
  }

  /**
   * Enqueue a new export job
   */
  async enqueue(jobPayload) {
    const { jobId, io } = jobPayload;
    if (io) this.io = io;

    this.jobsQueue.push(jobId);
    this.emit('job:enqueued', { jobId });
    setImmediate(() => this.processNextJobs());
    return true;
  }

  getMetrics() {
    return {
      queueLength: this.jobsQueue.length,
      activeWorkers: this.activeWorkers,
      maxConcurrency: this.concurrency
    };
  }

  async processNextJobs() {
    while (this.activeWorkers < this.concurrency && this.jobsQueue.length > 0) {
      const jobId = this.jobsQueue.shift();
      if (!jobId) break;

      this.activeWorkers++;
      this.executeJob(jobId)
        .catch((err) => {
          console.error(`[ExportQueue] Unhandled job error for ${jobId}:`, err);
        })
        .finally(() => {
          this.activeWorkers--;
          setImmediate(() => this.processNextJobs());
        });
    }
  }

  /**
   * Emit socket progress helper
   */
  emitProgress(jobId, event, data) {
    if (!this.io) return;
    try {
      this.io.to(`export_${jobId}`).emit(event, data);
      this.io.emit(event, data); // Global broadcast for admin console
    } catch (err) {
      // Socket emission failure is non-fatal
    }
  }

  /**
   * Execute export job using cursor streaming
   */
  async executeJob(jobId) {
    const job = await ExportJob.findOne({ jobId });
    if (!job) {
      console.warn(`[ExportQueue] ExportJob ${jobId} not found in database.`);
      return;
    }

    if (job.status === 'CANCELLED' || job.status === 'EXPIRED') {
      return;
    }

    job.status = 'PROCESSING';
    job.startedAt = new Date();
    await job.save();

    this.emitProgress(jobId, 'export:started', {
      jobId,
      format: job.format,
      totalRecords: job.totalRecords,
      status: 'PROCESSING'
    });

    const format = job.format || 'csv';
    const timestamp = Date.now();
    const fileName = `results_export_${jobId}_${timestamp}.${format}`;
    const filePath = ExportStorageService.getSafePath(fileName);
    job.fileName = fileName;
    job.filePath = filePath;

    const resultQuery = job.filters?.resultQuery || {};
    const statusFilter = job.filters?.statusFilter || 'ALL';

    try {
      if (format === 'csv') {
        await this.generateStreamingCsv(job, resultQuery, statusFilter, filePath);
      } else {
        await this.generateBatchXlsx(job, resultQuery, statusFilter, filePath);
      }

      // Check file size
      const stats = fs.existsSync(filePath) ? fs.statSync(filePath) : { size: 0 };
      job.fileSize = stats.size;
      job.status = 'COMPLETED';
      job.completedAt = new Date();
      job.progressPercentage = 100;
      job.processedRecords = job.totalRecords;
      // Expire after 7 days
      job.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await job.save();

      this.emitProgress(jobId, 'export:completed', {
        jobId,
        fileName: job.fileName,
        fileSize: job.fileSize,
        totalRecords: job.totalRecords,
        processedRecords: job.processedRecords,
        progressPercentage: 100,
        status: 'COMPLETED'
      });
    } catch (err) {
      console.error(`[ExportQueue] Failed exporting job ${jobId}:`, err);
      job.status = 'FAILED';
      job.errorMessage = err.message || 'Unknown export error occurred';
      await job.save();

      // Cleanup broken file
      await ExportStorageService.deleteFile(filePath);

      this.emitProgress(jobId, 'export:failed', {
        jobId,
        errorMessage: job.errorMessage,
        status: 'FAILED'
      });
    }
  }

  /**
   * Stream MongoDB cursor directly to CSV file
   */
  async generateStreamingCsv(job, resultQuery, statusFilter, filePath) {
    return new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(filePath, { flags: 'w', encoding: 'utf8' });

      writeStream.on('error', (err) => {
        reject(err);
      });

      // Write UTF-8 BOM for Microsoft Excel compatibility
      writeStream.write('\uFEFF');
      // Write Header row
      writeStream.write(EXPORT_HEADERS.map(escapeCsvValue).join(',') + '\r\n');

      let processed = 0;
      let lastProgressUpdate = Date.now();
      const total = Math.max(1, job.totalRecords || 1);

      const cursor = Result.find(resultQuery)
        .populate({
          path: 'studentId',
          select: 'name email rollNumber enrollmentNumber branch semester section batch status'
        })
        .populate({
          path: 'examId',
          select: 'title duration totalMarks passMarks subjectId subjectCode',
          populate: {
            path: 'subjectId',
            select: 'name subjectCode'
          }
        })
        .sort({ submittedAt: -1 })
        .cursor({ batchSize: 500 })
        .lean();

      cursor.on('data', (doc) => {
        const row = formatResultRow(doc);

        if (statusFilter === 'PASSED' && !row.isPassed) return;
        if (statusFilter === 'FAILED' && row.isPassed) return;

        const line = [
          escapeCsvValue(row.studentName),
          escapeCsvValue(row.email),
          escapeCsvValue(row.rollNumber),
          escapeCsvValue(row.enrollmentNumber),
          escapeCsvValue(row.branch),
          escapeCsvValue(row.semester),
          escapeCsvValue(row.section),
          escapeCsvValue(row.batch),
          escapeCsvValue(row.studentStatus),
          escapeCsvValue(row.examName),
          escapeCsvValue(row.examCode),
          escapeCsvValue(row.subjectName),
          escapeCsvValue(row.subjectCode),
          escapeCsvValue(row.marks),
          escapeCsvValue(row.maximumMarks),
          escapeCsvValue(row.percentage),
          escapeCsvValue(row.resultStatus),
          escapeCsvValue(row.submittedAt),
          escapeCsvValue(row.verificationId)
        ].join(',') + '\r\n';

        const canWrite = writeStream.write(line);
        if (!canWrite) {
          cursor.pause();
          writeStream.once('drain', () => {
            cursor.resume();
          });
        }

        processed++;

        // Throttle progress DB writes and socket emissions (every 250ms or 200 records)
        const now = Date.now();
        if (now - lastProgressUpdate > 250 || processed % 200 === 0 || processed === total) {
          lastProgressUpdate = now;
          const progressPercentage = Math.min(99, Math.round((processed / total) * 100));
          
          ExportJob.updateOne(
            { jobId: job.jobId },
            { $set: { processedRecords: processed, progressPercentage } }
          ).exec().catch(() => {});

          this.emitProgress(job.jobId, 'export:progress', {
            jobId: job.jobId,
            processedRecords: processed,
            totalRecords: total,
            progressPercentage
          });
        }
      });

      cursor.on('end', () => {
        writeStream.end(() => {
          resolve();
        });
      });

      cursor.on('error', (err) => {
        writeStream.destroy();
        reject(err);
      });
    });
  }

  /**
   * Batch process records to XLSX file
   */
  async generateBatchXlsx(job, resultQuery, statusFilter, filePath) {
    const excelRows = [];
    let processed = 0;
    let lastProgressUpdate = Date.now();
    const total = Math.max(1, job.totalRecords || 1);

    const cursor = Result.find(resultQuery)
      .populate({
        path: 'studentId',
        select: 'name email rollNumber enrollmentNumber branch semester section batch status'
      })
      .populate({
        path: 'examId',
        select: 'title duration totalMarks passMarks subjectId subjectCode',
        populate: {
          path: 'subjectId',
          select: 'name subjectCode'
        }
      })
      .sort({ submittedAt: -1 })
      .cursor({ batchSize: 500 })
      .lean();

    for await (const doc of cursor) {
      const row = formatResultRow(doc);

      if (statusFilter === 'PASSED' && !row.isPassed) continue;
      if (statusFilter === 'FAILED' && row.isPassed) continue;

      excelRows.push({
        'Student Name': row.studentName,
        'Email': row.email,
        'Roll Number': row.rollNumber,
        'Enrollment Number': row.enrollmentNumber,
        'Branch': row.branch,
        'Semester': row.semester,
        'Section': row.section,
        'Batch': row.batch,
        'Student Status': row.studentStatus,
        'Exam Name': row.examName,
        'Exam Code': row.examCode,
        'Subject': row.subjectName,
        'Subject Code': row.subjectCode,
        'Marks': row.marks,
        'Maximum Marks': row.maximumMarks,
        'Percentage': row.percentage,
        'Result Status': row.resultStatus,
        'Submitted At': row.submittedAt,
        'Verification ID': row.verificationId
      });

      processed++;

      const now = Date.now();
      if (now - lastProgressUpdate > 250 || processed % 200 === 0 || processed === total) {
        lastProgressUpdate = now;
        const progressPercentage = Math.min(95, Math.round((processed / total) * 95));

        ExportJob.updateOne(
          { jobId: job.jobId },
          { $set: { processedRecords: processed, progressPercentage } }
        ).exec().catch(() => {});

        this.emitProgress(job.jobId, 'export:progress', {
          jobId: job.jobId,
          processedRecords: processed,
          totalRecords: total,
          progressPercentage
        });
      }
    }

    // Build worksheet with autofilters and column widths
    const ws = XLSX.utils.json_to_sheet(excelRows, { header: EXPORT_HEADERS });
    ws['!cols'] = [
      { wch: 22 }, // Student Name
      { wch: 28 }, // Email
      { wch: 14 }, // Roll Number
      { wch: 16 }, // Enrollment Number
      { wch: 10 }, // Branch
      { wch: 10 }, // Semester
      { wch: 10 }, // Section
      { wch: 12 }, // Batch
      { wch: 14 }, // Student Status
      { wch: 30 }, // Exam Name
      { wch: 14 }, // Exam Code
      { wch: 25 }, // Subject
      { wch: 14 }, // Subject Code
      { wch: 10 }, // Marks
      { wch: 14 }, // Maximum Marks
      { wch: 12 }, // Percentage
      { wch: 14 }, // Result Status
      { wch: 20 }, // Submitted At
      { wch: 25 }  // Verification ID
    ];

    if (excelRows.length > 0) {
      ws['!autofilter'] = { ref: `A1:S${excelRows.length + 1}` };
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Exam Results');
    XLSX.writeFile(wb, filePath);
  }
}

const exportQueue = new ExportQueueEngine();
module.exports = exportQueue;
