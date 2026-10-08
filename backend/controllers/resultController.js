const Exam = require('../models/Exam');
const Question = require('../models/Question');
const ExamAttempt = require('../models/ExamAttempt');
const Result = require('../models/Result');
const ProctoringSession = require('../models/ProctoringSession');
const ProctoringEvent = require('../models/ProctoringEvent');
const { generatePdfReport } = require('../utils/pdfReportGenerator');
const { isStudentEligibleForExam } = require('../utils/examEligibility');
const subjectiveEvaluationService = require('../services/subjectiveEvaluationService');
const cacheService = require('../services/cacheService');
const distributedLock = require('../services/distributedLock');
const evaluationQueue = require('../queues/evaluationQueue');
const mongoose = require('mongoose');
const crypto = require('crypto');

// Helper to check if a user is allowed to modify/review an exam result
const checkExamOwnershipOrAdmin = (user, exam) => {
  if (user.role === 'ADMIN') return true;
  if (user.role === 'TEACHER') {
    const creatorId = exam.createdBy ? exam.createdBy.toString() : '';
    return creatorId === user.id.toString();
  }
  return false;
};

// @desc    Start an exam attempt (STUDENT)
// @route   GET /api/exams/:id/start
// @access  Private/Student
exports.startExam = async (req, res, next) => {
  try {
    const examId = req.params.id;
    const studentId = req.user.id;

    if (!mongoose.Types.ObjectId.isValid(examId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid exam ID format'
      });
    }

    const exam = await cacheService.getExamMetadata(examId);
    if (!exam) {
      return res.status(404).json({
        success: false,
        message: 'Exam not found'
      });
    }

    if (!exam.isPublished) {
      return res.status(403).json({
        success: false,
        message: 'This exam is not currently available'
      });
    }

    // Server-side Student Eligibility Validation
    const { eligible, reason, statusCode } = await isStudentEligibleForExam(req.user, exam);
    if (!eligible) {
      return res.status(statusCode || 403).json({
        success: false,
        reason,
        message: 'You are not eligible to attempt this assessment'
      });
    }

    // Check multiple attempts restriction
    if (!exam.allowMultipleAttempts) {
      const existingResult = await Result.findOne({ studentId, examId }).select('_id').lean();
      if (existingResult) {
        return res.status(400).json({
          success: false,
          message: 'You have already submitted this exam. Multiple attempts are not allowed.'
        });
      }
    }

    // Check for existing active in-progress attempt
    let attempt = await ExamAttempt.findOne({ studentId, examId, status: 'IN_PROGRESS' });

    // Check scheduled time window
    const now = new Date();
    if (exam.isScheduled) {
      if (exam.startTime && now < new Date(exam.startTime)) {
        return res.status(403).json({
          success: false,
          isUpcoming: true,
          scheduledStartTime: exam.startTime,
          message: `This assessment has not started yet. The scheduled window opens on ${new Date(exam.startTime).toLocaleString()}.`
        });
      }

      if (exam.endTime && now > new Date(exam.endTime)) {
        if (!attempt) {
          return res.status(403).json({
            success: false,
            isExpired: true,
            scheduledEndTime: exam.endTime,
            message: `The scheduled access window for this exam closed on ${new Date(exam.endTime).toLocaleString()}.`
          });
        }
      }
    }

    // If starting a new session and exam is passcode protected, verify access code
    if (!attempt && exam.hasAccessCode) {
      const providedCode = (req.query.accessCode || req.headers['x-access-code'] || '').trim();
      if (!providedCode || providedCode.toLowerCase() !== (exam.accessCode || '').trim().toLowerCase()) {
        return res.status(403).json({
          success: false,
          requiresAccessCode: true,
          message: providedCode ? 'Incorrect exam access passcode. Please try again.' : 'This exam is passcode protected. Please enter the access code provided by your instructor.'
        });
      }
    }

    if (!attempt) {
      attempt = await ExamAttempt.create({
        studentId,
        examId,
        startTime: new Date(),
        status: 'IN_PROGRESS'
      });
    }

    // SECURITY & CACHE: Retrieve sanitized questions bundle (with negative projection)
    const questions = await cacheService.getSanitizedQuestions(examId);

    if (!questions || questions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'This exam has no questions available'
      });
    }

    const savedAnswersObj = attempt.savedAnswers ? (attempt.savedAnswers instanceof Map ? Object.fromEntries(attempt.savedAnswers) : attempt.savedAnswers) : {};

    res.status(200).json({
      success: true,
      message: Object.keys(savedAnswersObj).length > 0 ? 'Exam session resumed' : 'Exam started',
      data: {
        exam: {
          id: exam._id,
          title: exam.title,
          description: exam.description,
          duration: exam.duration,
          totalMarks: exam.totalMarks,
          passMarks: exam.passMarks,
          isScheduled: exam.isScheduled || false,
          startTime: exam.startTime || null,
          endTime: exam.endTime || null,
          hasNegativeMarking: exam.hasNegativeMarking || false,
          negativeMarks: exam.negativeMarks || 0,
          requireCamera: exam.requireCamera !== undefined ? exam.requireCamera : true
        },
        attemptId: attempt._id,
        startTime: attempt.startTime,
        durationMinutes: exam.duration,
        savedAnswers: savedAnswersObj,
        markedForReview: attempt.markedForReview || [],
        warningCount: attempt.warningCount || 0,
        questions
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Save in-progress exam answers (STUDENT)
// @route   PATCH /api/results/attempts/:examId/save
// @access  Private/Student
exports.saveExamProgress = async (req, res, next) => {
  try {
    const { examId } = req.params;
    const { answers, markedForReview, warningCount, currentQuestionIndex, proctorEvent, cameraStatus, cameraSnapshot, attemptId } = req.body;
    const studentId = req.user.id;

    if (!mongoose.Types.ObjectId.isValid(examId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid exam ID format'
      });
    }

    const query = {
      studentId,
      examId,
      status: 'IN_PROGRESS'
    };
    if (attemptId && mongoose.Types.ObjectId.isValid(attemptId)) {
      query._id = attemptId;
    }

    const updateDoc = {
      $set: {
        lastActiveAt: new Date()
      }
    };

    if (answers && typeof answers === 'object') {
      updateDoc.$set.savedAnswers = answers;
    }
    if (Array.isArray(markedForReview)) {
      updateDoc.$set.markedForReview = markedForReview.slice(0, 1000);
    }
    if (typeof warningCount === 'number' && warningCount >= 0) {
      updateDoc.$set.warningCount = warningCount;
    }
    if (typeof currentQuestionIndex === 'number' && currentQuestionIndex >= 0) {
      updateDoc.$set.currentQuestionIndex = currentQuestionIndex;
    }
    if (cameraStatus && typeof cameraStatus === 'string') {
      updateDoc.$set.cameraStatus = cameraStatus.slice(0, 50);
    }
    if (cameraSnapshot && typeof cameraSnapshot === 'string' && cameraSnapshot.length < 200000) {
      updateDoc.$set.latestCameraSnapshot = cameraSnapshot;
    }
    if (proctorEvent && proctorEvent.eventType) {
      updateDoc.$push = {
        proctorLogs: {
          $each: [{
            timestamp: proctorEvent.timestamp ? new Date(proctorEvent.timestamp) : new Date(),
            eventType: String(proctorEvent.eventType).slice(0, 50),
            reason: String(proctorEvent.reason || '').slice(0, 200)
          }],
          $slice: -200 // Keep only the latest 200 proctor logs in bounded array
        }
      };
    }

    const attempt = await ExamAttempt.findOneAndUpdate(
      query,
      updateDoc,
      { new: true, select: 'disqualified disqualificationReason extraTimeMinutes adminBroadcastMessage warningCount' }
    ).lean();

    if (!attempt) {
      return res.status(404).json({
        success: false,
        message: 'No active in-progress exam attempt found to save'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Exam progress saved successfully',
      data: {
        forceSubmit: Boolean(attempt.disqualified),
        disqualificationReason: attempt.disqualificationReason || '',
        extraTimeMinutes: attempt.extraTimeMinutes || 0,
        adminBroadcastMessage: attempt.adminBroadcastMessage || '',
        warningCount: attempt.warningCount || 0
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Submit exam & calculate result (Idempotent & High-Concurrency Protected)
// @route   POST /api/results/submit
// @access  Private/Student
exports.submitExam = async (req, res, next) => {
  let lockId = null;
  const { examId, attemptId, answers, warningCount, submissionReason } = req.body;
  const studentId = req.user.id;
  const lockKey = `submit:${studentId}:${examId}`;

  try {
    if (!examId || !mongoose.Types.ObjectId.isValid(examId)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid examId'
      });
    }

    // 1. Distributed Mutex Lock (15s TTL) to prevent double clicks & race conditions
    const lockRes = await distributedLock.acquire(lockKey, 15000);
    lockId = lockRes.lockId;

    const exam = await Exam.findById(examId).lean();
    if (!exam) {
      if (lockId) await distributedLock.release(lockKey, lockId);
      return res.status(404).json({
        success: false,
        message: 'Exam not found'
      });
    }

    // 2. Check if already submitted previously (Idempotent response)
    if (!exam.allowMultipleAttempts) {
      const existingResult = await Result.findOne({ studentId, examId }).lean();
      if (existingResult) {
        if (lockId) await distributedLock.release(lockKey, lockId);
        return res.status(200).json({
          success: true,
          message: 'Exam already submitted previously.',
          resultId: existingResult._id,
          data: existingResult
        });
      }
    }

    // 3. Atomically transition attempt status from IN_PROGRESS -> SUBMITTING
    const attemptQuery = {
      studentId,
      examId,
      status: 'IN_PROGRESS'
    };
    if (attemptId && mongoose.Types.ObjectId.isValid(attemptId)) {
      attemptQuery._id = attemptId;
    }

    let attempt = await ExamAttempt.findOneAndUpdate(
      attemptQuery,
      { $set: { status: 'SUBMITTING', endTime: new Date() } },
      { new: true }
    );

    if (!attempt) {
      // Check if attempt was already submitted by previous click
      const alreadySubmittedAttempt = await ExamAttempt.findOne({ studentId, examId, status: { $in: ['SUBMITTING', 'SUBMITTED'] } });
      if (alreadySubmittedAttempt) {
        const existingResult = await Result.findOne({ attemptId: alreadySubmittedAttempt._id }).lean();
        if (existingResult) {
          if (lockId) await distributedLock.release(lockKey, lockId);
          return res.status(200).json({
            success: true,
            message: 'Exam submission already received.',
            resultId: existingResult._id,
            data: existingResult
          });
        }
      }
      if (lockId) await distributedLock.release(lockKey, lockId);
      return res.status(400).json({
        success: false,
        message: 'No active in-progress exam attempt found. You cannot submit an exam without an active attempt session.'
      });
    }

    // 4. Cleanup active proctoring session asynchronously (non-blocking)
    setImmediate(async () => {
      try {
        const proctorSession = await ProctoringSession.findOne({ attemptId: attempt._id });
        if (proctorSession && (proctorSession.status === 'ACTIVE' || proctorSession.status === 'DISCONNECTED')) {
          proctorSession.status = 'ENDED';
          proctorSession.endedAt = new Date();
          await proctorSession.save();
        }
      } catch (e) {}
    });

    const submittedAt = new Date();
    const startTime = attempt.startTime || submittedAt;
    const actualElapsedMs = submittedAt.getTime() - startTime.getTime();
    const elapsedSeconds = Math.floor(actualElapsedMs / 1000);
    const mins = Math.floor(elapsedSeconds / 60);
    const secs = elapsedSeconds % 60;
    const timeTakenStr = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

    // 5. Fetch questions from DB
    const questions = await Question.find({ examId }).lean();
    const submittedAnswersMap = new Map();
    if (Array.isArray(answers)) {
      answers.forEach(a => {
        if (a && a.questionId) {
          const val = a.answer !== undefined 
            ? a.answer 
            : (a.answerText !== undefined 
                ? a.answerText 
                : (a.selectedOption !== undefined 
                    ? a.selectedOption 
                    : a.selectedAnswer));
          submittedAnswersMap.set(a.questionId.toString(), val);
        }
      });
    }

    let objectiveScore = 0;
    let correctAnswersCount = 0;
    let wrongAnswersCount = 0;
    let unattemptedCount = 0;
    let negativeMarksDeducted = 0;
    const penaltyPerWrong = (exam.hasNegativeMarking && exam.negativeMarks > 0) ? Number(exam.negativeMarks) : 0;
    const evaluatedAnswers = [];
    let hasSubjective = false;
    let subjectiveStatuses = [];

    // Evaluate Objective & Enqueue Subjective Questions
    for (const q of questions) {
      const qIdStr = q._id.toString();
      const rawStudentAns = submittedAnswersMap.get(qIdStr);

      if (q.type === 'SUBJECTIVE') {
        hasSubjective = true;
        const studentText = typeof rawStudentAns === 'string'
          ? rawStudentAns.trim()
          : (Array.isArray(rawStudentAns) ? rawStudentAns.join('\n').trim() : '');

        if (!studentText) {
          unattemptedCount++;
          subjectiveStatuses.push('AUTO_GRADED');
          evaluatedAnswers.push({
            questionId: q._id,
            questionType: 'SUBJECTIVE',
            selectedAnswer: '',
            selectedAnswers: [],
            answerText: '',
            correctAnswer: q.expectedAnswer || '',
            correctAnswers: [],
            isCorrect: false,
            marksObtained: 0,
            evaluationStatus: 'AUTO_GRADED',
            evaluationScore: 0,
            confidenceScore: 100,
            awardedMarks: 0,
            maximumMarks: q.marks || 1,
            keywordScore: 0,
            conceptScore: 0,
            semanticScore: 0,
            aiScore: 0,
            matchedKeywords: [],
            missingKeywords: q.keywords || [],
            matchedConcepts: [],
            missingConcepts: q.keyConcepts || [],
            incorrectClaims: [],
            evaluationReason: 'Candidate did not attempt this subjective question.',
            evaluatedAt: new Date(),
            evaluatedBy: 'SYSTEM',
            evaluationVersion: 'subjective-v1',
            originalAiSuggestedMarks: 0
          });
        } else {
          // If in test mode or synchronous requirement, evaluate immediately; else queue asynchronously
          if (process.env.NODE_ENV === 'test' || process.env.SYNC_SUBJECTIVE_EVAL === 'true') {
            const evalRes = await subjectiveEvaluationService.evaluateAnswer({
              question: q,
              studentAnswer: studentText
            });
            objectiveScore += evalRes.awardedMarks;
            if (evalRes.isCorrect) correctAnswersCount++;
            else if (evalRes.awardedMarks > (q.marks * 0.5)) correctAnswersCount++;
            else wrongAnswersCount++;

            subjectiveStatuses.push(evalRes.evaluationStatus);
            evaluatedAnswers.push({
              questionId: q._id,
              questionType: 'SUBJECTIVE',
              selectedAnswer: studentText,
              selectedAnswers: [],
              answerText: studentText,
              correctAnswer: q.expectedAnswer || '',
              correctAnswers: [],
              isCorrect: evalRes.isCorrect,
              marksObtained: evalRes.awardedMarks,
              evaluationStatus: evalRes.evaluationStatus,
              evaluationScore: evalRes.evaluationScore,
              confidenceScore: evalRes.confidenceScore,
              awardedMarks: evalRes.awardedMarks,
              maximumMarks: evalRes.maximumMarks,
              keywordScore: evalRes.keywordScore,
              conceptScore: evalRes.conceptScore,
              semanticScore: evalRes.semanticScore,
              aiScore: evalRes.aiScore,
              matchedKeywords: evalRes.matchedKeywords,
              missingKeywords: evalRes.missingKeywords,
              matchedConcepts: evalRes.matchedConcepts,
              missingConcepts: evalRes.missingConcepts,
              incorrectClaims: evalRes.incorrectClaims,
              evaluationReason: evalRes.evaluationReason,
              evaluatedAt: evalRes.evaluatedAt,
              evaluatedBy: evalRes.evaluatedBy,
              evaluationVersion: evalRes.evaluationVersion,
              originalAiSuggestedMarks: evalRes.originalAiSuggestedMarks
            });
          } else {
            // High-concurrency production: Queued for asynchronous worker evaluation
            subjectiveStatuses.push('QUEUED_FOR_EVALUATION');
            evaluatedAnswers.push({
              questionId: q._id,
              questionType: 'SUBJECTIVE',
              selectedAnswer: studentText,
              selectedAnswers: [],
              answerText: studentText,
              correctAnswer: q.expectedAnswer || '',
              correctAnswers: [],
              isCorrect: false,
              marksObtained: 0,
              evaluationStatus: 'QUEUED_FOR_EVALUATION',
              evaluationScore: 0,
              confidenceScore: 0,
              awardedMarks: 0,
              maximumMarks: q.marks || 1,
              keywordScore: 0,
              conceptScore: 0,
              semanticScore: 0,
              aiScore: 0,
              matchedKeywords: [],
              missingKeywords: q.keywords || [],
              matchedConcepts: [],
              missingConcepts: q.keyConcepts || [],
              incorrectClaims: [],
              evaluationReason: 'Evaluation queued for asynchronous worker processing.',
              evaluatedAt: null,
              evaluatedBy: 'SYSTEM',
              evaluationVersion: 'subjective-v1',
              originalAiSuggestedMarks: 0
            });
          }
        }
      } else {
        // Objective question (SINGLE or MULTIPLE)
        const isMulti = q.type === 'MULTIPLE';
        let studentAnsList = [];
        if (Array.isArray(rawStudentAns)) {
          studentAnsList = rawStudentAns.map(a => String(a).trim()).filter(Boolean);
        } else if (typeof rawStudentAns === 'string' && rawStudentAns.trim() !== '') {
          studentAnsList = [rawStudentAns.trim()];
        }

        let expectedAnsList = [];
        if (isMulti) {
          expectedAnsList = (q.correctAnswers && q.correctAnswers.length > 0)
            ? q.correctAnswers.map(a => a.trim())
            : (q.correctAnswer ? [q.correctAnswer.trim()] : []);
        } else {
          expectedAnsList = q.correctAnswer ? [q.correctAnswer.trim()] : (q.correctAnswers && q.correctAnswers[0] ? [q.correctAnswers[0].trim()] : []);
        }

        const isUnattempted = studentAnsList.length === 0;
        let isAnswerCorrect = false;

        if (!isUnattempted) {
          if (isMulti) {
            const studentSet = new Set(studentAnsList);
            const expectedSet = new Set(expectedAnsList);
            isAnswerCorrect = studentSet.size === expectedSet.size && [...studentSet].every(item => expectedSet.has(item));
          } else {
            isAnswerCorrect = studentAnsList[0] === (q.correctAnswer || expectedAnsList[0]);
          }
        }

        const primaryCorrectAnswer = q.correctAnswer || (expectedAnsList[0] || '');

        if (isUnattempted) {
          unattemptedCount++;
          evaluatedAnswers.push({
            questionId: q._id,
            questionType: isMulti ? 'MULTIPLE' : 'SINGLE',
            selectedAnswer: '',
            selectedAnswers: [],
            correctAnswer: primaryCorrectAnswer,
            correctAnswers: expectedAnsList,
            isCorrect: false,
            marksObtained: 0
          });
        } else if (isAnswerCorrect) {
          correctAnswersCount++;
          objectiveScore += (q.marks || 1);
          evaluatedAnswers.push({
            questionId: q._id,
            questionType: isMulti ? 'MULTIPLE' : 'SINGLE',
            selectedAnswer: studentAnsList.join(', '),
            selectedAnswers: studentAnsList,
            correctAnswer: primaryCorrectAnswer,
            correctAnswers: expectedAnsList,
            isCorrect: true,
            marksObtained: q.marks || 1
          });
        } else {
          wrongAnswersCount++;
          const deduction = penaltyPerWrong;
          negativeMarksDeducted += deduction;
          objectiveScore -= deduction;
          evaluatedAnswers.push({
            questionId: q._id,
            questionType: isMulti ? 'MULTIPLE' : 'SINGLE',
            selectedAnswer: studentAnsList.join(', '),
            selectedAnswers: studentAnsList,
            correctAnswer: primaryCorrectAnswer,
            correctAnswers: expectedAnsList,
            isCorrect: false,
            marksObtained: deduction > 0 ? -deduction : 0
          });
        }
      }
    }

    objectiveScore = Math.max(0, parseFloat(objectiveScore.toFixed(2)));
    negativeMarksDeducted = parseFloat(negativeMarksDeducted.toFixed(2));
    const totalMarks = exam.totalMarks || questions.reduce((sum, q) => sum + (q.marks || 1), 0);
    const percentage = totalMarks > 0 ? parseFloat(((objectiveScore / totalMarks) * 100).toFixed(2)) : 0;

    let overallSubjectiveStatus = 'NONE';
    const isAsyncEvaluating = hasSubjective && subjectiveStatuses.includes('QUEUED_FOR_EVALUATION');

    if (hasSubjective) {
      if (isAsyncEvaluating) {
        overallSubjectiveStatus = 'QUEUED_FOR_EVALUATION';
      } else if (subjectiveStatuses.includes('MANUAL_REVIEW_REQUIRED')) {
        overallSubjectiveStatus = 'MANUAL_REVIEW_REQUIRED';
      } else if (subjectiveStatuses.includes('AUTO_GRADED_REVIEW_RECOMMENDED') || subjectiveStatuses.includes('FALLBACK_EVALUATION')) {
        overallSubjectiveStatus = 'REVIEW_RECOMMENDED';
      } else {
        overallSubjectiveStatus = 'ALL_AUTO_GRADED';
      }
    }

    const verificationId = 'GLB-VRF-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(4).toString('hex').toUpperCase();

    // Create Result Record
    const resultDoc = await Result.create({
      studentId,
      examId,
      attemptId: attempt._id,
      verificationId,
      answers: evaluatedAnswers,
      score: objectiveScore,
      totalMarks,
      percentage,
      correctAnswers: correctAnswersCount,
      wrongAnswers: wrongAnswersCount,
      unattempted: unattemptedCount,
      negativeMarksDeducted,
      timeTaken: timeTakenStr,
      warningCount: typeof warningCount === 'number' ? warningCount : (attempt.warningCount || 0),
      submissionReason: submissionReason || 'NORMAL',
      hasSubjectiveQuestions: hasSubjective,
      status: isAsyncEvaluating ? 'PARTIALLY_EVALUATED' : 'EVALUATED',
      subjectiveReviewStatus: overallSubjectiveStatus,
      submittedAt
    });

    // Mark attempt as SUBMITTED
    attempt.status = 'SUBMITTED';
    await attempt.save();

    // If async evaluation is queued, push job into EvaluationQueue
    if (isAsyncEvaluating) {
      evaluationQueue.enqueue({
        resultId: resultDoc._id,
        examId,
        studentId,
        io: req.app?.get('io')
      });
    }

    if (lockId) await distributedLock.release(lockKey, lockId);

    res.status(201).json({
      success: true,
      message: isAsyncEvaluating ? 'Exam submitted. Subjective answers queued for evaluation.' : 'Exam submitted and graded successfully.',
      resultId: resultDoc._id,
      data: resultDoc,
      isAsyncEvaluating
    });
  } catch (error) {
    if (lockId) await distributedLock.release(lockKey, lockId).catch(() => {});
    next(error);
  }

// @desc    Get current student's results (STUDENT ONLY)
// @route   GET /api/results/my-results
// @access  Private/Student
exports.getMyResults = async (req, res, next) => {
  try {
    const results = await Result.find({ studentId: req.user.id })
      .populate('examId', 'title description totalMarks passMarks duration')
      .sort({ submittedAt: -1 });

    res.status(200).json({
      success: true,
      count: results.length,
      data: results
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get result by ID with full question details & explanations
// @route   GET /api/results/:id
// @access  Private
exports.getResultById = async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid result ID format'
      });
    }

    const result = await Result.findById(req.params.id)
      .populate('examId', 'title description totalMarks passMarks duration createdBy')
      .populate('studentId', 'name email rollNumber enrollmentNumber branch semester section batch');

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Result not found'
      });
    }

    const isStudent = req.user.role === 'STUDENT';
    const isOwnerStudent = isStudent && result.studentId._id.toString() === req.user.id;
    const isStaff = ['ADMIN', 'TEACHER'].includes(req.user.role);

    // SECURITY: Student can only view their own result
    if (isStudent && !isOwnerStudent) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view another student\'s result'
      });
    }

    const questions = await Question.find({ examId: result.examId._id });
    const questionMap = new Map();
    questions.forEach(q => questionMap.set(q._id.toString(), q));

    const detailedAnswers = result.answers.map(ans => {
      const q = questionMap.get(ans.questionId.toString());
      const isSubj = ans.questionType === 'SUBJECTIVE' || (q && q.type === 'SUBJECTIVE');

      if (isSubj) {
        const baseSubj = {
          questionId: ans.questionId,
          questionText: q ? q.questionText : 'Question deleted',
          imageUrl: q ? (q.imageUrl || null) : null,
          options: [],
          questionType: 'SUBJECTIVE',
          selectedAnswer: ans.selectedAnswer || ans.answerText || '',
          answerText: ans.answerText || ans.selectedAnswer || '',
          isCorrect: ans.isCorrect,
          marksObtained: ans.marksObtained != null ? ans.marksObtained : (ans.awardedMarks || 0),
          awardedMarks: ans.awardedMarks != null ? ans.awardedMarks : (ans.marksObtained || 0),
          maximumMarks: ans.maximumMarks || (q ? q.marks : 1),
          totalQuestionMarks: q ? q.marks : (ans.maximumMarks || 1),
          evaluationStatus: ans.evaluationStatus || 'AUTO_GRADED',
          explanation: q ? q.explanation : ''
        };

        // If staff (Admin/Teacher), add complete subjective audit/evaluation metadata
        if (isStaff) {
          baseSubj.expectedAnswer = q ? (q.expectedAnswer || '') : (ans.correctAnswer || '');
          baseSubj.keywords = q ? (q.keywords || []) : [];
          baseSubj.keyConcepts = q ? (q.keyConcepts || []) : [];
          baseSubj.rubric = q ? (q.rubric || []) : [];
          baseSubj.evaluationScore = ans.evaluationScore || 0;
          baseSubj.confidenceScore = ans.confidenceScore || 0;
          baseSubj.keywordScore = ans.keywordScore || 0;
          baseSubj.conceptScore = ans.conceptScore || 0;
          baseSubj.semanticScore = ans.semanticScore || 0;
          baseSubj.aiScore = ans.aiScore || 0;
          baseSubj.matchedKeywords = ans.matchedKeywords || [];
          baseSubj.missingKeywords = ans.missingKeywords || [];
          baseSubj.matchedConcepts = ans.matchedConcepts || [];
          baseSubj.missingConcepts = ans.missingConcepts || [];
          baseSubj.incorrectClaims = ans.incorrectClaims || [];
          baseSubj.evaluationReason = ans.evaluationReason || '';
          baseSubj.evaluatedAt = ans.evaluatedAt || null;
          baseSubj.evaluatedBy = ans.evaluatedBy || '';
          baseSubj.evaluationVersion = ans.evaluationVersion || 'subjective-v1';
          baseSubj.originalAiSuggestedMarks = ans.originalAiSuggestedMarks != null ? ans.originalAiSuggestedMarks : ans.awardedMarks;
          baseSubj.overrideReason = ans.overrideReason || '';
        }

        return baseSubj;
      }

      // Objective (SINGLE / MULTIPLE)
      return {
        questionId: ans.questionId,
        questionText: q ? q.questionText : 'Question deleted',
        imageUrl: q ? (q.imageUrl || null) : null,
        options: q ? q.options : [],
        questionType: ans.questionType || (q ? q.type : 'SINGLE'),
        selectedAnswer: ans.selectedAnswer,
        selectedAnswers: (ans.selectedAnswers && ans.selectedAnswers.length > 0) 
          ? ans.selectedAnswers 
          : (ans.selectedAnswer ? [ans.selectedAnswer] : []),
        correctAnswer: ans.correctAnswer,
        correctAnswers: (ans.correctAnswers && ans.correctAnswers.length > 0)
          ? ans.correctAnswers
          : (q && q.correctAnswers && q.correctAnswers.length > 0)
          ? q.correctAnswers
          : (ans.correctAnswer ? [ans.correctAnswer] : []),
        isCorrect: ans.isCorrect,
        marksObtained: ans.marksObtained,
        totalQuestionMarks: q ? q.marks : 1,
        explanation: q ? q.explanation : ''
      };
    });

    res.status(200).json({
      success: true,
      data: {
        ...result.toObject(),
        answers: detailedAnswers
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Override subjective question evaluation / marks (Admin / Teacher only)
// @route   PATCH /api/results/:id/subjective-override
// @access  Private (ADMIN, TEACHER)
exports.overrideSubjectiveAnswer = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { questionId, marksAwarded, overrideReason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(questionId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid result ID or question ID format'
      });
    }

    const result = await Result.findById(id).populate('examId');
    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Result not found'
      });
    }

    if (!checkExamOwnershipOrAdmin(req.user, result.examId)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to override marks for this exam result'
      });
    }

    const targetAnswer = result.answers.find(a => a.questionId.toString() === questionId.toString());
    if (!targetAnswer) {
      return res.status(404).json({
        success: false,
        message: 'Target question not found in this exam result'
      });
    }

    const question = await Question.findById(questionId);
    const maxQMarks = question ? question.marks : (targetAnswer.maximumMarks || 5);

    const newMarks = Math.min(maxQMarks, Math.max(0, Number(marksAwarded) || 0));

    // Update answer
    targetAnswer.marksObtained = newMarks;
    targetAnswer.awardedMarks = newMarks;
    targetAnswer.evaluationStatus = 'TEACHER_OVERRIDDEN';
    targetAnswer.evaluatedBy = `TEACHER: ${req.user.name || req.user.email} (${req.user.id})`;
    targetAnswer.overrideReason = overrideReason ? String(overrideReason).trim() : 'Manual instructor review override';
    targetAnswer.isCorrect = newMarks >= (maxQMarks * 0.7);

    // Recalculate total score
    let newTotalScore = 0;
    result.answers.forEach(a => {
      newTotalScore += (a.marksObtained || 0);
    });

    result.score = Math.max(0, parseFloat(newTotalScore.toFixed(2)));
    if (result.totalMarks > 0) {
      result.percentage = parseFloat(((result.score / result.totalMarks) * 100).toFixed(2));
    }
    result.subjectiveReviewStatus = 'COMPLETED_BY_TEACHER';

    await result.save();

    res.status(200).json({
      success: true,
      message: 'Subjective marks overridden successfully',
      data: {
        resultId: result._id,
        score: result.score,
        percentage: result.percentage,
        updatedAnswer: targetAnswer
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all results across all students (Admin only)
// @route   GET /api/results/admin/all
// @access  Private/Admin
exports.getAllResultsAdmin = async (req, res, next) => {
  try {
    const results = await Result.find()
      .populate('examId', 'title totalMarks passMarks')
      .populate('studentId', 'name email')
      .sort({ submittedAt: -1 });

    res.status(200).json({
      success: true,
      count: results.length,
      data: results
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Download Result Report as PDF (Student own result, Admin any result)
// @route   GET /api/results/:id/pdf
// @access  Private
exports.downloadResultPdf = async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid result ID format'
      });
    }

    const result = await Result.findById(req.params.id)
      .populate('examId', 'title description totalMarks passMarks duration')
      .populate('studentId', 'name email');

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Result not found'
      });
    }

    // SECURITY: Student can only download their own result, Admin can download any
    if (req.user.role === 'STUDENT' && result.studentId._id.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to download this report'
      });
    }

    const questions = await Question.find({ examId: result.examId._id });

    const safeTitle = (result.examId?.title || 'Exam').replace(/[^a-zA-Z0-9-_]/g, '_');
    const safeStudent = (result.studentId?.name || 'Student').replace(/[^a-zA-Z0-9-_]/g, '_');
    const filename = `GLB-EXAMSPHERE-Report-${safeStudent}-${safeTitle}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Check PDF cache first
    const cachedPdf = await cacheService.getPdfBuffer(result._id);
    if (cachedPdf) {
      return res.send(cachedPdf);
    }

    try {
      generatePdfReport(result, questions, res);
    } catch (pdfErr) {
      console.error('PDF Generation Error:', pdfErr);
      if (!res.headersSent) {
        return res.status(500).json({ success: false, message: 'Failed to generate PDF report document' });
      }
      res.end();
    }
  } catch (error) {
    next(error);
  }
};
