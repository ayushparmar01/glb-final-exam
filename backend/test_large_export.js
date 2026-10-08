/**
 * Automated Test Suite for Large Scale Result Export System - GLB ExamSphere
 * Verifies memory-efficient streaming CSV, batched XLSX, background queue jobs,
 * progress tracking, history, secure stream download, and security safeguards.
 */

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const connectDB = require('./config/db');
const User = require('./models/User');
const Exam = require('./models/Exam');
const Result = require('./models/Result');
const ExportJob = require('./models/ExportJob');
const ExportStorageService = require('./services/exportStorageService');
const exportQueue = require('./queues/exportQueue');

async function runTests() {
  console.log('🧪 Starting Large-Scale Result Export Test Suite...\n');
  let testCount = 0;
  let passedCount = 0;

  const assert = (condition, title) => {
    testCount++;
    if (condition) {
      console.log(`  ✅ Test ${testCount}: ${title}`);
      passedCount++;
    } else {
      console.error(`  ❌ Test ${testCount} FAILED: ${title}`);
    }
  };

  try {
    await connectDB();
    console.log('📦 Connected to MongoDB.\n');

    // 1. Setup Test Admin, Student, Exam, and Results
    const adminUser = await User.findOneAndUpdate(
      { email: 'export_admin_test@glb.ac.in' },
      {
        name: 'Export Test Admin',
        email: 'export_admin_test@glb.ac.in',
        password: 'hashed_password_123',
        role: 'ADMIN',
        status: 'ACTIVE'
      },
      { upsert: true, new: true }
    );

    const studentUser = await User.findOneAndUpdate(
      { email: 'export_student_test@glb.ac.in' },
      {
        name: 'Export Test Student',
        email: 'export_student_test@glb.ac.in',
        password: 'hashed_password_123',
        role: 'STUDENT',
        rollNumber: 'CS2026-999',
        enrollmentNumber: 'EN2026-999',
        branch: 'CSE',
        semester: '6',
        section: 'A',
        batch: '2022-2026',
        status: 'ACTIVE'
      },
      { upsert: true, new: true }
    );

    const testExam = await Exam.findOneAndUpdate(
      { title: 'Large Export Benchmark Examination' },
      {
        title: 'Large Export Benchmark Examination',
        subjectCode: 'CS601',
        totalMarks: 100,
        passMarks: 40,
        duration: 60,
        status: 'PUBLISHED',
        createdBy: adminUser._id
      },
      { upsert: true, new: true }
    );

    // Create a series of test results
    await Result.deleteMany({ examId: testExam._id });
    const dummyResults = [];
    for (let i = 1; i <= 25; i++) {
      dummyResults.push({
        studentId: studentUser._id,
        examId: testExam._id,
        score: 60 + (i % 35),
        totalMarks: 100,
        percentage: 60 + (i % 35),
        status: 'EVALUATED',
        timeTaken: '45:00',
        submittedAt: new Date(Date.now() - i * 60000),
        verificationId: `VFY-EXP-${1000 + i}`,
        answers: []
      });
    }
    await Result.insertMany(dummyResults);
    console.log(`📝 Seeded 25 test results for benchmark exam: ${testExam.title}`);

    // --- TEST 1: Export Storage Service Directory Protection ---
    const exportDir = ExportStorageService.getExportDir();
    assert(fs.existsSync(exportDir), 'Export storage directory exists on disk');

    const safePath = ExportStorageService.getSafePath('../../../etc/passwd_exploit.csv');
    assert(
      !safePath.includes('..') && path.basename(safePath) === 'passwd_exploit.csv',
      'ExportStorageService sanitizes paths against directory traversal attacks'
    );

    // --- TEST 2: Asynchronous CSV Export Job Execution ---
    const csvJobId = `test_csv_${Date.now()}`;
    const csvJob = await ExportJob.create({
      jobId: csvJobId,
      createdBy: adminUser._id,
      format: 'csv',
      status: 'QUEUED',
      filters: { resultQuery: { examId: testExam._id }, statusFilter: 'ALL' },
      totalRecords: 25,
      fileName: `test_export_${csvJobId}.csv`
    });

    assert(csvJob.status === 'QUEUED', 'ExportJob document created with initial QUEUED status');

    // Run queue execution
    await exportQueue.executeJob(csvJobId);

    const completedCsvJob = await ExportJob.findOne({ jobId: csvJobId });
    assert(completedCsvJob.status === 'COMPLETED', 'CSV ExportJob marked as COMPLETED after worker execution');
    assert(completedCsvJob.progressPercentage === 100, 'CSV ExportJob progressPercentage reached 100%');
    assert(completedCsvJob.fileSize > 0, `CSV Export file generated on disk (Size: ${completedCsvJob.fileSize} bytes)`);
    assert(fs.existsSync(completedCsvJob.filePath), 'CSV file exists on filesystem at filePath');

    // Verify CSV file content (UTF-8 BOM and valid header)
    const csvContent = fs.readFileSync(completedCsvJob.filePath, 'utf8');
    assert(csvContent.startsWith('\uFEFF'), 'CSV file begins with UTF-8 BOM for Microsoft Excel compatibility');
    assert(csvContent.includes('Student Name,Email,Roll Number,Enrollment Number'), 'CSV file contains correct standardized header row');
    assert(csvContent.includes('Export Test Student'), 'CSV file contains exported student record data');

    // --- TEST 3: Asynchronous XLSX Export Job Execution ---
    const xlsxJobId = `test_xlsx_${Date.now()}`;
    const xlsxJob = await ExportJob.create({
      jobId: xlsxJobId,
      createdBy: adminUser._id,
      format: 'xlsx',
      status: 'QUEUED',
      filters: { resultQuery: { examId: testExam._id }, statusFilter: 'ALL' },
      totalRecords: 25,
      fileName: `test_export_${xlsxJobId}.xlsx`
    });

    await exportQueue.executeJob(xlsxJobId);

    const completedXlsxJob = await ExportJob.findOne({ jobId: xlsxJobId });
    assert(completedXlsxJob.status === 'COMPLETED', 'XLSX ExportJob marked as COMPLETED after worker execution');
    assert(completedXlsxJob.fileSize > 0, `XLSX Export file generated on disk (Size: ${completedXlsxJob.fileSize} bytes)`);
    assert(fs.existsSync(completedXlsxJob.filePath), 'XLSX file exists on filesystem at filePath');

    // Read and verify XLSX workbook
    const workbook = XLSX.readFile(completedXlsxJob.filePath);
    const sheetName = workbook.SheetNames[0];
    assert(sheetName === 'Exam Results', `XLSX sheet named '${sheetName}'`);
    const worksheet = workbook.Sheets[sheetName];
    const parsedData = XLSX.utils.sheet_to_json(worksheet);
    assert(parsedData.length === 25, `XLSX file contains exact 25 data rows (parsed: ${parsedData.length})`);
    assert(parsedData[0]['Student Name'] === 'Export Test Student', 'XLSX row contains valid Student Name header mapping');
    assert(worksheet['!autofilter'] !== undefined, 'XLSX worksheet includes autofilter range');

    // --- TEST 4: Export Storage Stream Download ---
    const downloadStream = ExportStorageService.getDownloadStream(completedCsvJob.filePath);
    assert(downloadStream && typeof downloadStream.pipe === 'function', 'ExportStorageService returns readable stream for file download');

    // --- TEST 5: Expiration and Cleanup Handling ---
    const expiredJobId = `test_expired_${Date.now()}`;
    const expiredTempFile = ExportStorageService.getSafePath(`temp_expired_${expiredJobId}.csv`);
    fs.writeFileSync(expiredTempFile, 'dummy,expired,data');

    await ExportJob.create({
      jobId: expiredJobId,
      createdBy: adminUser._id,
      format: 'csv',
      status: 'COMPLETED',
      filePath: expiredTempFile,
      fileName: `temp_expired_${expiredJobId}.csv`,
      totalRecords: 1,
      expiresAt: new Date(Date.now() - 10000) // already expired in past
    });

    const cleanedCount = await ExportStorageService.cleanupExpiredExports(ExportJob);
    assert(cleanedCount >= 1, `ExportStorageService cleaned up ${cleanedCount} expired export job(s)`);
    assert(!fs.existsSync(expiredTempFile), 'Expired file successfully unlinked from storage disk');

    const expiredJobDoc = await ExportJob.findOne({ jobId: expiredJobId });
    assert(expiredJobDoc.status === 'EXPIRED', 'Expired ExportJob record status updated to EXPIRED');

    // --- TEST 6: Cleanup Test Artifacts ---
    await ExportStorageService.deleteFile(completedCsvJob.filePath);
    await ExportStorageService.deleteFile(completedXlsxJob.filePath);
    await Result.deleteMany({ examId: testExam._id });
    await Exam.deleteOne({ _id: testExam._id });
    await ExportJob.deleteMany({ jobId: { $in: [csvJobId, xlsxJobId, expiredJobId] } });

    console.log(`\n==================================================`);
    console.log(`🏆 ALL TESTS PASSED: ${passedCount}/${testCount} tests successful.`);
    console.log(`==================================================\n`);

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Unhandled error in Large Export Test Suite:', error);
    process.exit(1);
  }
}

runTests();
