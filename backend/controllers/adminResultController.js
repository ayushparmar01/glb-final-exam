// /**
//  * Admin Result Management & Export Controller - GLB ExamSphere
//  * Provides bulk result viewing, multi-dimensional filtering, pagination,
//  * streaming CSV export, batched Excel (.xlsx) export, background export jobs,
//  * progress tracking, export history, and secure stream downloads.
//  */

// const crypto = require('crypto');
// const Result = require('../models/Result');
// const Exam = require('../models/Exam');
// const User = require('../models/User');
// const AcademicYear = require('../models/AcademicYear');
// const Branch = require('../models/Branch');
// const Semester = require('../models/Semester');
// const Section = require('../models/Section');
// const Batch = require('../models/Batch');
// const Subject = require('../models/Subject');
// const ExportJob = require('../models/ExportJob');
// const exportQueue = require('../queues/exportQueue');
// const ExportStorageService = require('../services/exportStorageService');
// const mongoose = require('mongoose');
// const XLSX = require('xlsx');

// /**
//  * Helper to sanitize string inputs and prevent regex / MongoDB injection
//  */
// const escapeRegex = (string) => {
//   if (!string || typeof string !== 'string') return '';
//   return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// };

// const cleanString = (val) => {
//   if (!val || typeof val !== 'string') return '';
//   return val.trim();
// };

// /**
//  * Standard CSV / Excel Column Headers
//  */
// const EXPORT_HEADERS = [
//   'Student Name',
//   'Email',
//   'Roll Number',
//   'Enrollment Number',
//   'Branch',
//   'Semester',
//   'Section',
//   'Batch',
//   'Student Status',
//   'Exam Name',
//   'Exam Code',
//   'Subject',
//   'Subject Code',
//   'Marks',
//   'Maximum Marks',
//   'Percentage',
//   'Result Status',
//   'Submitted At',
//   'Verification ID'
// ];

// /**
//  * Format a Result document into a standardized flat object for display/export
//  */
// const formatResultRecord = (result) => {
//   const student = result.studentId || {};
//   const exam = result.examId || {};
//   const subject = (exam.subjectId && typeof exam.subjectId === 'object') ? exam.subjectId : null;
//   const passMarks = exam.passMarks != null ? exam.passMarks : 0;
//   const score = result.score != null ? result.score : 0;
//   const totalMarks = result.totalMarks != null ? result.totalMarks : (exam.totalMarks || 0);
//   const isPassed = score >= passMarks;

//   let percentageStr = '0%';
//   if (result.percentage != null) {
//     percentageStr = `${result.percentage}%`;
//   } else if (totalMarks > 0) {
//     percentageStr = `${((score / totalMarks) * 100).toFixed(2)}%`;
//   }

//   let formattedDate = '';
//   if (result.submittedAt) {
//     try {
//       formattedDate = new Date(result.submittedAt).toISOString().replace('T', ' ').substring(0, 19);
//     } catch (e) {
//       formattedDate = String(result.submittedAt);
//     }
//   }

//   return {
//     studentName: student.name || 'N/A',
//     email: student.email || 'N/A',
//     rollNumber: student.rollNumber || '',
//     enrollmentNumber: student.enrollmentNumber || '',
//     branch: student.branch || '',
//     semester: student.semester ? String(student.semester) : '',
//     section: student.section || '',
//     batch: student.batch || '',
//     studentStatus: student.status || 'ACTIVE',
//     examName: exam.title || 'N/A',
//     examCode: exam.subjectCode || '',
//     subjectName: (subject && subject.name) ? subject.name : '',
//     subjectCode: (subject && subject.subjectCode) ? subject.subjectCode : (exam.subjectCode || ''),
//     marks: score,
//     maximumMarks: totalMarks,
//     percentage: percentageStr,
//     percentageNumber: result.percentage != null ? result.percentage : (totalMarks > 0 ? parseFloat(((score / totalMarks) * 100).toFixed(2)) : 0),
//     resultStatus: isPassed ? 'Passed' : 'Failed',
//     isPassed,
//     passMarks,
//     timeTaken: result.timeTaken || '00:00',
//     submittedAt: formattedDate,
//     rawSubmittedAt: result.submittedAt,
//     verificationId: result.verificationId || '',
//     _id: result._id
//   };
// };

// /**
//  * Build consolidated MongoDB filter queries for Results based on request parameters
//  */
// const buildFilterContext = async (queryParams = {}) => {
//   const {
//     search,
//     exam,
//     examId,
//     academicYear,
//     academicYearId,
//     branch,
//     semester,
//     section,
//     batch,
//     subject,
//     subjectId,
//     status,
//     resultStatus,
//     startDate,
//     fromDate,
//     endDate,
//     toDate
//   } = queryParams;

//   const resultQuery = {};
//   let studentQueryNeeded = false;
//   const studentQuery = { role: 'STUDENT' };

//   // 1. Resolve Academic Year / Subject / Exam filters
//   const examQuery = {};
//   let examQueryNeeded = false;

//   const cleanExamId = cleanString(examId || exam);
//   if (cleanExamId && cleanExamId !== 'ALL') {
//     if (mongoose.Types.ObjectId.isValid(cleanExamId)) {
//       examQuery._id = new mongoose.Types.ObjectId(cleanExamId);
//       examQueryNeeded = true;
//     } else {
//       examQuery.title = new RegExp(`^${escapeRegex(cleanExamId)}$`, 'i');
//       examQueryNeeded = true;
//     }
//   }

//   const cleanSubjectId = cleanString(subjectId || subject);
//   if (cleanSubjectId && cleanSubjectId !== 'ALL') {
//     if (mongoose.Types.ObjectId.isValid(cleanSubjectId)) {
//       const subjectDoc = await Subject.findById(cleanSubjectId).lean();
//       if (subjectDoc) {
//         examQuery.$or = [
//           { subjectId: subjectDoc._id },
//           { subjectCode: subjectDoc.subjectCode }
//         ];
//       } else {
//         examQuery.subjectId = new mongoose.Types.ObjectId(cleanSubjectId);
//       }
//     } else {
//       const subjectDocs = await Subject.find({
//         $or: [
//           { subjectCode: new RegExp(`^${escapeRegex(cleanSubjectId)}$`, 'i') },
//           { name: new RegExp(`^${escapeRegex(cleanSubjectId)}$`, 'i') }
//         ]
//       }).select('_id subjectCode').lean();

//       const subIds = subjectDocs.map(s => s._id);
//       const subCodes = subjectDocs.map(s => s.subjectCode);

//       examQuery.$or = [
//         { subjectId: { $in: subIds } },
//         { subjectCode: { $in: subCodes } },
//         { subjectCode: new RegExp(`^${escapeRegex(cleanSubjectId)}$`, 'i') }
//       ];
//     }
//     examQueryNeeded = true;
//   }

//   const cleanYearId = cleanString(academicYearId || academicYear);
//   if (cleanYearId && cleanYearId !== 'ALL') {
//     if (mongoose.Types.ObjectId.isValid(cleanYearId)) {
//       examQuery.$or = [
//         ...(examQuery.$or || []),
//         { 'target.academicYears': new mongoose.Types.ObjectId(cleanYearId) },
//         { audienceType: 'ENTIRE_COLLEGE' }
//       ];
//     } else {
//       const yearDoc = await AcademicYear.findOne({
//         $or: [
//           { code: new RegExp(`^${escapeRegex(cleanYearId)}$`, 'i') },
//           { name: new RegExp(`^${escapeRegex(cleanYearId)}$`, 'i') }
//         ]
//       }).lean();
//       if (yearDoc) {
//         examQuery.$or = [
//           ...(examQuery.$or || []),
//           { 'target.academicYears': yearDoc._id },
//           { audienceType: 'ENTIRE_COLLEGE' }
//         ];
//       }
//     }
//     examQueryNeeded = true;
//   }

//   if (examQueryNeeded) {
//     const matchingExams = await Exam.find(examQuery).select('_id').lean();
//     const matchingExamIds = matchingExams.map(e => e._id);
//     resultQuery.examId = { $in: matchingExamIds };
//   }

//   // 2. Resolve Student filters (Branch, Semester, Section, Batch, Search)
//   const cleanBranch = cleanString(branch);
//   if (cleanBranch && cleanBranch !== 'ALL') {
//     studentQueryNeeded = true;
//     if (mongoose.Types.ObjectId.isValid(cleanBranch)) {
//       const branchDoc = await Branch.findById(cleanBranch).lean();
//       if (branchDoc) {
//         studentQuery.branch = new RegExp(`^${escapeRegex(branchDoc.code)}$`, 'i');
//       } else {
//         studentQuery.branch = cleanBranch;
//       }
//     } else {
//       studentQuery.branch = new RegExp(`^${escapeRegex(cleanBranch)}$`, 'i');
//     }
//   }

//   const cleanSemester = cleanString(semester);
//   if (cleanSemester && cleanSemester !== 'ALL') {
//     studentQueryNeeded = true;
//     if (mongoose.Types.ObjectId.isValid(cleanSemester)) {
//       const semDoc = await Semester.findById(cleanSemester).lean();
//       if (semDoc) {
//         studentQuery.semester = new RegExp(`^(${semDoc.number}|Semester ${semDoc.number})$`, 'i');
//       } else {
//         studentQuery.semester = cleanSemester;
//       }
//     } else {
//       studentQuery.semester = new RegExp(`^(${escapeRegex(cleanSemester)}|Semester ${escapeRegex(cleanSemester)})$`, 'i');
//     }
//   }

//   const cleanSection = cleanString(section);
//   if (cleanSection && cleanSection !== 'ALL') {
//     studentQueryNeeded = true;
//     if (mongoose.Types.ObjectId.isValid(cleanSection)) {
//       const secDoc = await Section.findById(cleanSection).lean();
//       if (secDoc) {
//         studentQuery.section = new RegExp(`^${escapeRegex(secDoc.name)}$`, 'i');
//       } else {
//         studentQuery.section = cleanSection;
//       }
//     } else {
//       studentQuery.section = new RegExp(`^${escapeRegex(cleanSection)}$`, 'i');
//     }
//   }

//   const cleanBatch = cleanString(batch);
//   if (cleanBatch && cleanBatch !== 'ALL') {
//     studentQueryNeeded = true;
//     if (mongoose.Types.ObjectId.isValid(cleanBatch)) {
//       const batchDoc = await Batch.findById(cleanBatch).lean();
//       if (batchDoc) {
//         studentQuery.batch = new RegExp(`^${escapeRegex(batchDoc.name)}$`, 'i');
//       } else {
//         studentQuery.batch = cleanBatch;
//       }
//     } else {
//       studentQuery.batch = new RegExp(`^${escapeRegex(cleanBatch)}$`, 'i');
//     }
//   }

//   const cleanSearch = cleanString(search);
//   if (cleanSearch) {
//     studentQueryNeeded = true;
//     const escaped = escapeRegex(cleanSearch);
//     studentQuery.$or = [
//       { name: { $regex: escaped, $options: 'i' } },
//       { email: { $regex: escaped, $options: 'i' } },
//       { rollNumber: { $regex: escaped, $options: 'i' } },
//       { enrollmentNumber: { $regex: escaped, $options: 'i' } }
//     ];
//   }

//   if (studentQueryNeeded) {
//     const matchingStudents = await User.find(studentQuery).select('_id').lean();
//     const matchingStudentIds = matchingStudents.map(s => s._id);
//     resultQuery.studentId = { $in: matchingStudentIds };
//   }

//   // 3. Date Range Filter on submittedAt
//   const cleanStartDate = cleanString(startDate || fromDate);
//   const cleanEndDate = cleanString(endDate || toDate);

//   if (cleanStartDate) {
//     const start = new Date(cleanStartDate);
//     if (!isNaN(start.getTime())) {
//       resultQuery.submittedAt = { ...(resultQuery.submittedAt || {}), $gte: start };
//     }
//   }

//   if (cleanEndDate) {
//     const end = new Date(cleanEndDate);
//     if (!isNaN(end.getTime())) {
//       if (/^\d{4}-\d{2}-\d{2}$/.test(cleanEndDate)) {
//         end.setHours(23, 59, 59, 999);
//       }
//       resultQuery.submittedAt = { ...(resultQuery.submittedAt || {}), $lte: end };
//     }
//   }

//   // 4. Result Status Filter (Passed / Failed)
//   const cleanStatus = cleanString(status || resultStatus).toUpperCase();

//   return {
//     resultQuery,
//     statusFilter: ['PASSED', 'FAILED'].includes(cleanStatus) ? cleanStatus : 'ALL'
//   };
// };

// /**
//  * Generate safe filename for export
//  */
// const generateExportFilename = (ext, queryParams = {}) => {
//   const parts = ['GLB_ExamSphere'];
//   if (queryParams.branch && queryParams.branch !== 'ALL') {
//     parts.push(String(queryParams.branch).replace(/[^a-zA-Z0-9_-]/g, '_'));
//   }
//   if (queryParams.semester && queryParams.semester !== 'ALL') {
//     parts.push(`Sem${String(queryParams.semester).replace(/[^a-zA-Z0-9_-]/g, '_')}`);
//   }
//   parts.push('Results');
//   const dateStr = new Date().toISOString().split('T')[0];
//   parts.push(dateStr);
//   return `${parts.join('_')}.${ext}`;
// };

// // @desc    Get all results with server-side pagination and multi-dimensional filters
// // @route   GET /api/admin/results
// // @access  Private/Admin
// exports.getAdminResults = async (req, res, next) => {
//   try {
//     const page = Math.max(1, parseInt(req.query.page, 10) || 1);
//     const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
//     const skip = (page - 1) * limit;

//     const { resultQuery, statusFilter } = await buildFilterContext(req.query);

//     // If studentId or examId query is an empty array $in, immediately return empty results
//     if (
//       (resultQuery.studentId && Array.isArray(resultQuery.studentId.$in) && resultQuery.studentId.$in.length === 0) ||
//       (resultQuery.examId && Array.isArray(resultQuery.examId.$in) && resultQuery.examId.$in.length === 0)
//     ) {
//       return res.status(200).json({
//         success: true,
//         count: 0,
//         totalCount: 0,
//         page,
//         totalPages: 1,
//         pagination: {
//           page,
//           limit,
//           total: 0,
//           totalPages: 1
//         },
//         results: [],
//         data: []
//       });
//     }

//     // Query results from DB
//     const results = await Result.find(resultQuery)
//       .populate({
//         path: 'studentId',
//         select: 'name email rollNumber enrollmentNumber branch semester section batch status'
//       })
//       .populate({
//         path: 'examId',
//         select: 'title duration totalMarks passMarks subjectId subjectCode',
//         populate: {
//           path: 'subjectId',
//           select: 'name subjectCode'
//         }
//       })
//       .sort({ submittedAt: -1 })
//       .lean();

//     // Map and apply statusFilter if requested
//     let formattedRecords = results.map(formatResultRecord);

//     if (statusFilter === 'PASSED') {
//       formattedRecords = formattedRecords.filter(r => r.isPassed);
//     } else if (statusFilter === 'FAILED') {
//       formattedRecords = formattedRecords.filter(r => !r.isPassed);
//     }

//     const totalCount = formattedRecords.length;
//     const totalPages = Math.ceil(totalCount / limit) || 1;
//     const paginatedRecords = formattedRecords.slice(skip, skip + limit);

//     res.status(200).json({
//       success: true,
//       count: paginatedRecords.length,
//       totalCount,
//       page,
//       totalPages,
//       pagination: {
//         page,
//         limit,
//         total: totalCount,
//         totalPages
//       },
//       results: paginatedRecords,
//       data: paginatedRecords
//     });
//   } catch (error) {
//     next(error);
//   }
// };

// // @desc    Create an asynchronous background export job for large results (10k+ rows)
// // @route   POST /api/admin/results/export
// // @access  Private/Admin
// exports.createExportJob = async (req, res, next) => {
//   try {
//     const rawFormat = cleanString(req.body.format || req.query.format || 'csv').toLowerCase();

//     if (!['csv', 'xlsx'].includes(rawFormat)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid export format. Allowed formats: csv, xlsx'
//       });
//     }

//     const params = { ...req.query, ...req.body };
//     const { resultQuery, statusFilter } = await buildFilterContext(params);

//     // If query requires matching students/exams that returned empty, zero count
//     if (
//       (resultQuery.studentId && Array.isArray(resultQuery.studentId.$in) && resultQuery.studentId.$in.length === 0) ||
//       (resultQuery.examId && Array.isArray(resultQuery.examId.$in) && resultQuery.examId.$in.length === 0)
//     ) {
//       return res.status(400).json({
//         success: false,
//         message: 'No matching exam results found with the selected filter criteria.',
//         totalRecords: 0
//       });
//     }

//     const totalRecords = await Result.countDocuments(resultQuery);
//     if (totalRecords === 0) {
//       return res.status(400).json({
//         success: false,
//         message: 'No matching exam results found with the selected filter criteria.',
//         totalRecords: 0
//       });
//     }

//     const jobId = `exp_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
//     const initialFileName = generateExportFilename(rawFormat, params);

//     const exportJob = await ExportJob.create({
//       jobId,
//       createdBy: req.user._id,
//       format: rawFormat,
//       status: 'QUEUED',
//       filters: { resultQuery, statusFilter, queryParams: params },
//       totalRecords,
//       processedRecords: 0,
//       progressPercentage: 0,
//       fileName: initialFileName
//     });

//     const io = req.app.get('io');
//     await exportQueue.enqueue({ jobId, io });

//     res.status(202).json({
//       success: true,
//       jobId,
//       status: 'QUEUED',
//       totalRecords,
//       format: rawFormat,
//       fileName: initialFileName,
//       message: `Export job created successfully for ${totalRecords} results. File generation is running in background.`
//     });
//   } catch (error) {
//     next(error);
//   }
// };

// // @desc    Get status and live progress of an export job
// // @route   GET /api/admin/results/export/:jobId
// // @access  Private/Admin
// exports.getExportJobStatus = async (req, res, next) => {
//   try {
//     const { jobId } = req.params;
//     const job = await ExportJob.findOne({ jobId }).populate('createdBy', 'name email').lean();

//     if (!job) {
//       return res.status(404).json({
//         success: false,
//         message: `Export job '${jobId}' not found.`
//       });
//     }

//     res.status(200).json({
//       success: true,
//       job: {
//         jobId: job.jobId,
//         format: job.format,
//         status: job.status,
//         totalRecords: job.totalRecords,
//         processedRecords: job.processedRecords,
//         progressPercentage: job.progressPercentage,
//         fileName: job.fileName,
//         fileSize: job.fileSize,
//         errorMessage: job.errorMessage,
//         startedAt: job.startedAt,
//         completedAt: job.completedAt,
//         expiresAt: job.expiresAt,
//         createdAt: job.createdAt,
//         createdBy: job.createdBy
//       }
//     });
//   } catch (error) {
//     next(error);
//   }
// };

// // @desc    Get paginated export history
// // @route   GET /api/admin/results/exports
// // @access  Private/Admin
// exports.getExportHistory = async (req, res, next) => {
//   try {
//     const page = Math.max(1, parseInt(req.query.page, 10) || 1);
//     const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
//     const skip = (page - 1) * limit;

//     const totalCount = await ExportJob.countDocuments();
//     const totalPages = Math.ceil(totalCount / limit) || 1;

//     const jobs = await ExportJob.find()
//       .populate('createdBy', 'name email role')
//       .sort({ createdAt: -1 })
//       .skip(skip)
//       .limit(limit)
//       .lean();

//     res.status(200).json({
//       success: true,
//       count: jobs.length,
//       totalCount,
//       page,
//       totalPages,
//       jobs
//     });
//   } catch (error) {
//     next(error);
//   }
// };

// // @desc    Download completed export file securely via stream
// // @route   GET /api/admin/results/export/:jobId/download
// // @access  Private/Admin
// exports.downloadExportFile = async (req, res, next) => {
//   try {
//     const { jobId } = req.params;
//     const job = await ExportJob.findOne({ jobId });

//     if (!job) {
//       return res.status(404).json({
//         success: false,
//         message: `Export job '${jobId}' not found.`
//       });
//     }

//     if (job.status !== 'COMPLETED') {
//       return res.status(400).json({
//         success: false,
//         message: `Export is not ready for download. Current status: ${job.status}`
//       });
//     }

//     if (!job.filePath || !ExportStorageService.exists(job.filePath)) {
//       return res.status(410).json({
//         success: false,
//         message: 'Export file has expired or was deleted from server storage.'
//       });
//     }

//     const mimeType = job.format === 'xlsx'
//       ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
//       : 'text/csv; charset=utf-8';

//     const downloadFileName = job.fileName || `GLB_ExamSphere_Results_${jobId}.${job.format}`;

//     res.setHeader('Content-Type', mimeType);
//     res.setHeader('Content-Disposition', `attachment; filename="${downloadFileName}"`);
//     if (job.fileSize) {
//       res.setHeader('Content-Length', job.fileSize);
//     }

//     const stream = ExportStorageService.getDownloadStream(job.filePath);
//     stream.on('error', (err) => {
//       if (!res.headersSent) {
//         res.status(500).json({ success: false, message: 'Error streaming export file' });
//       }
//     });

//     stream.pipe(res);
//   } catch (error) {
//     next(error);
//   }
// };

// // @desc    Export filtered results as CSV or Excel (.xlsx) [Direct legacy stream for compatibility]
// // @route   GET /api/admin/results/export
// // @access  Private/Admin
// exports.exportAdminResults = async (req, res, next) => {
//   try {
//     const rawFormat = cleanString(req.query.format || 'csv').toLowerCase();

//     if (!['csv', 'xlsx'].includes(rawFormat)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid export format. Allowed formats: csv, xlsx'
//       });
//     }

//     const { resultQuery, statusFilter } = await buildFilterContext(req.query);

//     let results = [];
//     if (
//       !(resultQuery.studentId && Array.isArray(resultQuery.studentId.$in) && resultQuery.studentId.$in.length === 0) &&
//       !(resultQuery.examId && Array.isArray(resultQuery.examId.$in) && resultQuery.examId.$in.length === 0)
//     ) {
//       results = await Result.find(resultQuery)
//         .populate({
//           path: 'studentId',
//           select: 'name email rollNumber enrollmentNumber branch semester section batch status'
//         })
//         .populate({
//           path: 'examId',
//           select: 'title duration totalMarks passMarks subjectId subjectCode',
//           populate: {
//             path: 'subjectId',
//             select: 'name subjectCode'
//           }
//         })
//         .sort({ submittedAt: -1 })
//         .lean();
//     }

//     let formattedRecords = results.map(formatResultRecord);

//     if (statusFilter === 'PASSED') {
//       formattedRecords = formattedRecords.filter(r => r.isPassed);
//     } else if (statusFilter === 'FAILED') {
//       formattedRecords = formattedRecords.filter(r => !r.isPassed);
//     }

//     const filename = generateExportFilename(rawFormat, req.query);

//     if (rawFormat === 'csv') {
//       const escapeCsvValue = (val) => {
//         if (val === null || val === undefined) return '""';
//         const str = String(val);
//         if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
//           return `"${str.replace(/"/g, '""')}"`;
//         }
//         return `"${str}"`;
//       };

//       const csvRows = [EXPORT_HEADERS.map(escapeCsvValue).join(',')];

//       formattedRecords.forEach(row => {
//         csvRows.push([
//           escapeCsvValue(row.studentName),
//           escapeCsvValue(row.email),
//           escapeCsvValue(row.rollNumber),
//           escapeCsvValue(row.enrollmentNumber),
//           escapeCsvValue(row.branch),
//           escapeCsvValue(row.semester),
//           escapeCsvValue(row.section),
//           escapeCsvValue(row.batch),
//           escapeCsvValue(row.studentStatus),
//           escapeCsvValue(row.examName),
//           escapeCsvValue(row.examCode),
//           escapeCsvValue(row.subjectName),
//           escapeCsvValue(row.subjectCode),
//           escapeCsvValue(row.marks),
//           escapeCsvValue(row.maximumMarks),
//           escapeCsvValue(row.percentage),
//           escapeCsvValue(row.resultStatus),
//           escapeCsvValue(row.submittedAt),
//           escapeCsvValue(row.verificationId)
//         ].join(','));
//       });

//       const csvContent = '\uFEFF' + csvRows.join('\r\n');

//       res.setHeader('Content-Type', 'text/csv; charset=utf-8');
//       res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
//       return res.status(200).send(Buffer.from(csvContent, 'utf-8'));
//     } else {
//       // XLSX Export
//       const excelRows = formattedRecords.map(row => ({
//         'Student Name': row.studentName,
//         'Email': row.email,
//         'Roll Number': row.rollNumber,
//         'Enrollment Number': row.enrollmentNumber,
//         'Branch': row.branch,
//         'Semester': row.semester,
//         'Section': row.section,
//         'Batch': row.batch,
//         'Student Status': row.studentStatus,
//         'Exam Name': row.examName,
//         'Exam Code': row.examCode,
//         'Subject': row.subjectName,
//         'Subject Code': row.subjectCode,
//         'Marks': row.marks,
//         'Maximum Marks': row.maximumMarks,
//         'Percentage': row.percentage,
//         'Result Status': row.resultStatus,
//         'Submitted At': row.submittedAt,
//         'Verification ID': row.verificationId
//       }));

//       const ws = XLSX.utils.json_to_sheet(excelRows, { header: EXPORT_HEADERS });

//       // Column widths
//       ws['!cols'] = [
//         { wch: 22 }, // Student Name
//         { wch: 28 }, // Email
//         { wch: 14 }, // Roll Number
//         { wch: 16 }, // Enrollment Number
//         { wch: 10 }, // Branch
//         { wch: 10 }, // Semester
//         { wch: 10 }, // Section
//         { wch: 12 }, // Batch
//         { wch: 14 }, // Student Status
//         { wch: 30 }, // Exam Name
//         { wch: 14 }, // Exam Code
//         { wch: 25 }, // Subject
//         { wch: 14 }, // Subject Code
//         { wch: 10 }, // Marks
//         { wch: 14 }, // Maximum Marks
//         { wch: 12 }, // Percentage
//         { wch: 14 }, // Result Status
//         { wch: 20 }, // Submitted At
//         { wch: 25 }  // Verification ID
//       ];

//       // Enable autofilter
//       if (excelRows.length > 0) {
//         ws['!autofilter'] = { ref: `A1:S${excelRows.length + 1}` };
//       }

//       const wb = XLSX.utils.book_new();
//       XLSX.utils.book_append_sheet(wb, ws, 'Exam Results');
//       const xlsxBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

//       res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
//       res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
//       return res.status(200).send(xlsxBuffer);
//     }
//   } catch (error) {
//     next(error);
//   }
// };

/**
 * Memory-Efficient Large Dataset Export Controller
 */

const Result = require('../models/Result');
const { sanitizeFormula } = require('../utils/studentExcelParser');

exports.exportResultsCSV = async (req, res, next) => {
  try {
    const { examId, branch, semester } = req.query;
    const filter = {};
    if (examId) filter.examId = examId;
    if (branch) filter.branch = branch;
    if (semester) filter.semester = semester;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="exam_results_${Date.now()}.csv"`);

    // Stream CSV Header
    res.write('Roll Number,Student Name,Email,Score,Total Marks,Percentage,Status,Submission Time\n');

    // MongoDB Cursor Stream (avoid loading 10k documents in RAM)
    const cursor = Result.find(filter)
      .populate('studentId', 'name email rollNumber')
      .populate('examId', 'title totalMarks')
      .lean()
      .cursor({ batchSize: 500 });

    for await (const doc of cursor) {
      const roll = sanitizeFormula(doc.studentId?.rollNumber || '');
      const name = sanitizeFormula(doc.studentId?.name || '');
      const email = doc.studentId?.email || '';
      const marks = doc.totalScore || 0;
      const total = doc.examId?.totalMarks || 0;
      const percentage = total > 0 ? ((marks / total) * 100).toFixed(2) : '0.00';
      const status = doc.status || 'SUBMITTED';
      const time = doc.createdAt ? new Date(doc.createdAt).toISOString() : '';

      const csvLine = `"${roll}","${name}","${email}",${marks},${total},${percentage}%,"${status}","${time}"\n`;
      res.write(csvLine);
    }

    res.end();
  } catch (err) {
    next(err);
  }
};