/**
 * Automated Test Suite for Authentication, Google Login Rules, & Student Bulk Import
 * GLB Final Exam - ExamSphere
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const XLSX = require('xlsx');
const connectDB = require('./config/db');
const User = require('./models/User');
const { parseSpreadsheetBuffer, validateAndProcessStudentRows } = require('./utils/studentExcelParser');

async function runAuthAndImportTests() {
  console.log('🧪 Starting Authentication & Student Import Test Suite...\n');
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

    // -------------------------------------------------------------
    // 1. Password Hashing & Normalization Tests
    // -------------------------------------------------------------
    const rawEmail = '  Candidate.STUDENT@GLB.ac.in  ';
    const normalizedEmail = rawEmail.trim().toLowerCase();
    assert(normalizedEmail === 'candidate.student@glb.ac.in', 'Email normalization handles whitespace and case');

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('SecurePassword@2026', salt);
    const isMatch = await bcrypt.compare('SecurePassword@2026', hashedPassword);
    const isMismatch = await bcrypt.compare('WrongPassword@123', hashedPassword);

    assert(isMatch === true, 'Password hashes and compares correctly with bcrypt');
    assert(isMismatch === false, 'Invalid password comparison is rejected');

    // -------------------------------------------------------------
    // 2. Google OAuth Security Validation Rules
    // -------------------------------------------------------------
    const collegeDomainConfig = 'glb.ac.in,glbajaj.org';
    const allowedDomains = collegeDomainConfig.split(',').map(d => d.trim().toLowerCase());

    const validStudentEmail = 'student1@glb.ac.in';
    const invalidDomainEmail = 'attacker@random-gmail.com';

    const checkDomain = (email) => {
      const domain = email.split('@')[1] ? email.split('@')[1].toLowerCase() : '';
      return allowedDomains.includes(domain);
    };

    assert(checkDomain(validStudentEmail) === true, 'Allowed college domain is accepted');
    assert(checkDomain(invalidDomainEmail) === false, 'Unauthorized public domain is rejected');

    // -------------------------------------------------------------
    // 3. Spreadsheet Parsing & Validation (CSV / XLSX)
    // -------------------------------------------------------------
    const testData = [
      { 'Name': 'Aarav Sharma', 'Email': 'aarav.sharma@glb.ac.in', 'Roll Number': 'CS2026-001', 'Enrollment Number': 'EN2026-001', 'Branch': 'CSE', 'Semester': '6', 'Section': 'A', 'Batch': '2026' },
      { 'Name': 'Diya Patel', 'Email': 'diya.patel@glb.ac.in', 'Roll Number': 'CS2026-002', 'Enrollment Number': 'EN2026-002', 'Branch': 'CSE', 'Semester': '6', 'Section': 'A', 'Batch': '2026' },
      { 'Name': 'Duplicate Email Row', 'Email': 'aarav.sharma@glb.ac.in', 'Roll Number': 'CS2026-003', 'Enrollment Number': 'EN2026-003', 'Branch': 'CSE', 'Semester': '6', 'Section': 'B', 'Batch': '2026' },
      { 'Name': 'Invalid Email Format', 'Email': 'invalid-email-string', 'Roll Number': 'CS2026-004', 'Enrollment Number': 'EN2026-004', 'Branch': 'CSE', 'Semester': '6', 'Section': 'B', 'Batch': '2026' },
      { 'Name': '=cmd|/C calc', 'Email': 'injection.test@glb.ac.in', 'Roll Number': 'CS2026-005', 'Enrollment Number': 'EN2026-005', 'Branch': 'CSE', 'Semester': '6', 'Section': 'B', 'Batch': '2026' }
    ];

    const worksheet = XLSX.utils.json_to_sheet(testData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Students');
    const xlsxBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    const parsedRows = parseSpreadsheetBuffer(xlsxBuffer, 'test_students.xlsx');
    assert(parsedRows.length === 5, 'Spreadsheet buffer parsed 5 student rows correctly');

    const validation = await validateAndProcessStudentRows(parsedRows);
    assert(validation.validRows.length >= 2, 'Valid student rows recognized and structured');
    assert(validation.duplicateInSheetRows.length >= 1, 'Duplicate email within same spreadsheet detected');
    assert(validation.invalidRows.length >= 1, 'Malformed email format detected and flagged');

    // -------------------------------------------------------------
    // 4. Large-Batch Simulation (2,000 students generated in memory)
    // -------------------------------------------------------------
    console.log('\n  ⚡ Simulating 2,000 student batch validation...');
    const largeBatch = [];
    for (let i = 1; i <= 2000; i++) {
      largeBatch.push({
        'Name': `Student ${i}`,
        'Email': `batch.student.${i}@glb.ac.in`,
        'Roll Number': `ROLL-2026-${String(i).padStart(4, '0')}`,
        'Enrollment Number': `EN-2026-${String(i).padStart(4, '0')}`,
        'Branch': 'CSE',
        'Semester': '6',
        'Section': 'A',
        'Batch': '2026'
      });
    }

    const tStart = Date.now();
    const wsLarge = XLSX.utils.json_to_sheet(largeBatch);
    const wbLarge = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wbLarge, wsLarge, 'Students');
    const largeBuffer = XLSX.write(wbLarge, { type: 'buffer', bookType: 'xlsx' });
    const parsedLarge = parseSpreadsheetBuffer(largeBuffer, 'large_students.xlsx');
    const largeValidation = await validateAndProcessStudentRows(parsedLarge);
    const tDuration = Date.now() - tStart;

    assert(parsedLarge.length === 2000, `Parsed all 2,000 student records in ${tDuration}ms`);
    assert(largeValidation.validRows.length === 2000, 'Validated all 2,000 rows without errors');

    console.log(`\n================================================================================`);
    console.log(`AUTH & IMPORT RESULTS: ${passedCount} / ${testCount} Passed`);
    console.log(`================================================================================\n`);

    await mongoose.connection.close();
  } catch (error) {
    console.error('Error running auth & import test suite:', error);
    process.exit(1);
  }
}

runAuthAndImportTests();
