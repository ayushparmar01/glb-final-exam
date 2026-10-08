const Question = require('../models/Question');
const Exam = require('../models/Exam');
const mongoose = require('mongoose');
const { extractTextFromPdf, parseQuestionsFromText, extractQuestionsWithGemini } = require('../utils/pdfParser');
const subjectiveEvaluationService = require('../services/subjectiveEvaluationService');

// Recalculate exam total marks
const updateExamTotalMarks = async (examId) => {
  const questions = await Question.find({ examId });
  const totalMarks = questions.reduce((sum, q) => sum + (q.marks || 1), 0);
  await Exam.findByIdAndUpdate(examId, { totalMarks });
};

// Helper to check if a user is allowed to modify questions for an exam
const checkExamOwnership = (user, exam) => {
  if (user.role === 'ADMIN') return true;
  if (user.role === 'TEACHER') {
    const creatorId = exam.createdBy ? exam.createdBy.toString() : '';
    return creatorId === user.id.toString();
  }
  return false;
};

// Helper to sanitize keywords / concepts arrays
const sanitizeStringArray = (arr) => {
  if (!arr) return [];
  if (typeof arr === 'string') {
    return arr.split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
  }
  if (Array.isArray(arr)) {
    return arr.map(s => String(s).trim()).filter(Boolean);
  }
  return [];
};

// @desc    Add question to exam (SINGLE, MULTIPLE, SUBJECTIVE)
// @route   POST /api/exams/:examId/questions
// @access  Private (ADMIN, TEACHER)
exports.addQuestion = async (req, res, next) => {
  try {
    const { examId } = req.params;
    const {
      questionText,
      options,
      correctAnswer,
      correctAnswers,
      type,
      marks,
      explanation,
      imageUrl,
      expectedAnswer,
      keywords,
      keyConcepts,
      rubric,
      evaluationConfig
    } = req.body;

    if (!mongoose.Types.ObjectId.isValid(examId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid exam ID format'
      });
    }

    const exam = await Exam.findById(examId);
    if (!exam) {
      return res.status(404).json({
        success: false,
        message: 'Exam not found'
      });
    }

    if (!checkExamOwnership(req.user, exam)) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to add questions to another instructor\'s exam'
      });
    }

    const cleanText = questionText ? String(questionText).trim() : '';
    if (!cleanText) {
      return res.status(400).json({
        success: false,
        message: 'Please provide question text'
      });
    }

    const qType = type === 'SUBJECTIVE' ? 'SUBJECTIVE' : (type === 'MULTIPLE' ? 'MULTIPLE' : 'SINGLE');

    let cleanOptions = [];
    let finalCorrectAnswer = '';
    let finalCorrectAnswers = [];

    if (qType === 'SUBJECTIVE') {
      // Subjective questions don't require multiple choice options
      cleanOptions = [];
      finalCorrectAnswer = expectedAnswer ? String(expectedAnswer).trim() : '';
      finalCorrectAnswers = [];
    } else {
      // Objective questions (SINGLE / MULTIPLE) require at least 2 options
      if (!Array.isArray(options) || options.length < 2) {
        return res.status(400).json({
          success: false,
          message: 'Objective questions must have an options array with at least 2 options'
        });
      }

      cleanOptions = options.map((opt) => String(opt).trim()).filter(Boolean);
      if (cleanOptions.length < 2) {
        return res.status(400).json({
          success: false,
          message: 'Question must have at least 2 non-empty options'
        });
      }

      if (qType === 'SINGLE') {
        const cleanCorrect = correctAnswer ? String(correctAnswer).trim() : '';
        if (!cleanCorrect || !cleanOptions.includes(cleanCorrect)) {
          return res.status(400).json({
            success: false,
            message: 'Please provide a valid correct answer matching one of the options'
          });
        }
        finalCorrectAnswer = cleanCorrect;
        finalCorrectAnswers = [cleanCorrect];
      } else {
        const rawAnswers = Array.isArray(correctAnswers) ? correctAnswers.map((a) => String(a).trim()) : [];
        const validAnswers = rawAnswers.filter((a) => cleanOptions.includes(a));
        if (validAnswers.length === 0) {
          return res.status(400).json({
            success: false,
            message: 'Please select at least one valid correct option for multi-select question'
          });
        }
        finalCorrectAnswer = validAnswers[0] || '';
        finalCorrectAnswers = validAnswers;
      }
    }

    const cleanKeywords = sanitizeStringArray(keywords);
    const cleanConcepts = sanitizeStringArray(keyConcepts);

    const question = await Question.create({
      examId,
      questionText: cleanText,
      options: cleanOptions,
      type: qType,
      correctAnswer: finalCorrectAnswer,
      correctAnswers: finalCorrectAnswers,
      expectedAnswer: expectedAnswer ? String(expectedAnswer).trim() : '',
      keywords: cleanKeywords,
      keyConcepts: cleanConcepts,
      rubric: Array.isArray(rubric) ? rubric : [],
      evaluationConfig: evaluationConfig && typeof evaluationConfig === 'object' ? evaluationConfig : {},
      marks: Math.max(0.5, Number(marks) || 1),
      explanation: explanation ? String(explanation).trim() : '',
      imageUrl: imageUrl ? String(imageUrl).trim() : null
    });

    await updateExamTotalMarks(examId);

    res.status(201).json({
      success: true,
      message: 'Question added successfully',
      data: question
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all questions for an exam (Admin/Teacher mode - includes correctAnswer & subjective metadata)
// @route   GET /api/exams/:examId/questions
// @access  Private (ADMIN, TEACHER)
exports.getQuestionsForExamAdmin = async (req, res, next) => {
  try {
    const { examId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(examId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid exam ID format'
      });
    }

    const exam = await Exam.findById(examId);
    if (!exam) {
      return res.status(404).json({
        success: false,
        message: 'Exam not found'
      });
    }

    if (!checkExamOwnership(req.user, exam)) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to view questions for another instructor\'s exam'
      });
    }

    const questions = await Question.find({ examId }).sort({ createdAt: 1 });

    res.status(200).json({
      success: true,
      count: questions.length,
      data: questions
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update single question
// @route   PUT /api/questions/:id
// @access  Private (ADMIN, TEACHER)
exports.updateQuestion = async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid question ID format'
      });
    }

    let question = await Question.findById(req.params.id);

    if (!question) {
      return res.status(404).json({
        success: false,
        message: 'Question not found'
      });
    }

    const exam = await Exam.findById(question.examId);
    if (exam && !checkExamOwnership(req.user, exam)) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to modify questions for another instructor\'s exam'
      });
    }

    const {
      questionText,
      options,
      correctAnswer,
      correctAnswers,
      type,
      marks,
      explanation,
      imageUrl,
      expectedAnswer,
      keywords,
      keyConcepts,
      rubric,
      evaluationConfig
    } = req.body;

    if (type !== undefined) {
      question.type = type === 'SUBJECTIVE' ? 'SUBJECTIVE' : (type === 'MULTIPLE' ? 'MULTIPLE' : 'SINGLE');
    }

    if (questionText !== undefined) {
      const cleanText = String(questionText).trim();
      if (!cleanText) return res.status(400).json({ success: false, message: 'Question text cannot be empty' });
      question.questionText = cleanText;
    }

    if (question.type === 'SUBJECTIVE') {
      if (options !== undefined) {
        question.options = [];
      }
      if (expectedAnswer !== undefined) {
        question.expectedAnswer = String(expectedAnswer).trim();
        question.correctAnswer = String(expectedAnswer).trim();
      }
      if (keywords !== undefined) {
        question.keywords = sanitizeStringArray(keywords);
      }
      if (keyConcepts !== undefined) {
        question.keyConcepts = sanitizeStringArray(keyConcepts);
      }
      if (rubric !== undefined) {
        question.rubric = Array.isArray(rubric) ? rubric : [];
      }
      if (evaluationConfig !== undefined) {
        question.evaluationConfig = {
          ...question.evaluationConfig?.toObject?.() || {},
          ...evaluationConfig
        };
      }
    } else {
      // SINGLE or MULTIPLE
      if (options !== undefined) {
        if (!Array.isArray(options) || options.length < 2) {
          return res.status(400).json({
            success: false,
            message: 'Question must have at least 2 options'
          });
        }
        question.options = options.map((opt) => String(opt).trim()).filter(Boolean);
      }

      if (question.type === 'SINGLE') {
        if (correctAnswer !== undefined) {
          const cleanCorrect = String(correctAnswer).trim();
          if (!question.options.includes(cleanCorrect)) {
            return res.status(400).json({
              success: false,
              message: 'Correct answer must match one of the options'
            });
          }
          question.correctAnswer = cleanCorrect;
          question.correctAnswers = [cleanCorrect];
        }
      } else {
        if (correctAnswers !== undefined) {
          const cleanCorrects = Array.isArray(correctAnswers) ? correctAnswers.map((a) => String(a).trim()) : [];
          const validAnswers = cleanCorrects.filter((a) => question.options.includes(a));
          if (validAnswers.length === 0) {
            return res.status(400).json({
              success: false,
              message: 'Please select at least one valid correct option for multi-select question'
            });
          }
          question.correctAnswers = validAnswers;
          question.correctAnswer = validAnswers[0] || '';
        }
      }
    }

    if (marks !== undefined) question.marks = Math.max(0.5, Number(marks) || 1);
    if (explanation !== undefined) question.explanation = String(explanation).trim();
    if (imageUrl !== undefined) question.imageUrl = imageUrl ? String(imageUrl).trim() : null;

    await question.save();
    await updateExamTotalMarks(question.examId);

    res.status(200).json({
      success: true,
      message: 'Question updated successfully',
      data: question
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete single question
// @route   DELETE /api/questions/:id
// @access  Private (ADMIN, TEACHER)
exports.deleteQuestion = async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid question ID format'
      });
    }

    const question = await Question.findById(req.params.id);

    if (!question) {
      return res.status(404).json({
        success: false,
        message: 'Question not found'
      });
    }

    const exam = await Exam.findById(question.examId);
    if (exam && !checkExamOwnership(req.user, exam)) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to delete questions from another instructor\'s exam'
      });
    }

    const examId = question.examId;
    await question.deleteOne();
    await updateExamTotalMarks(examId);

    res.status(200).json({
      success: true,
      message: 'Question deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Extract questions from uploaded PDF
// @route   POST /api/exams/:examId/questions/extract-pdf
// @access  Private (ADMIN, TEACHER)
exports.extractQuestionsFromPdf = async (req, res, next) => {
  try {
    const { examId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(examId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid exam ID format'
      });
    }

    const exam = await Exam.findById(examId);
    if (!exam) {
      return res.status(404).json({
        success: false,
        message: 'Exam not found'
      });
    }

    if (!checkExamOwnership(req.user, exam)) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to import questions into another instructor\'s exam'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Please upload a PDF file'
      });
    }

    const { useAi, geminiApiKey } = req.body;
    let questions = [];
    let methodUsed = 'local';
    let rawText = '';

    try {
      rawText = await extractTextFromPdf(req.file.buffer);
    } catch (parseErr) {
      return res.status(400).json({
        success: false,
        message: `Could not read PDF text: ${parseErr.message}`
      });
    }

    if (!rawText || rawText.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No readable text could be extracted from this PDF. It might be scanned as images.'
      });
    }

    const shouldTryAi = (useAi === 'true' || useAi === true) && (geminiApiKey || process.env.GEMINI_API_KEY);

    if (shouldTryAi) {
      try {
        questions = await extractQuestionsWithGemini(rawText, geminiApiKey);
        methodUsed = 'gemini-ai';
      } catch (aiErr) {
        console.warn('Gemini extraction notice, falling back to regex parser:', aiErr.message);
        questions = parseQuestionsFromText(rawText);
        methodUsed = 'local-fallback';
      }
    } else {
      questions = parseQuestionsFromText(rawText);
    }

    res.status(200).json({
      success: true,
      count: questions.length,
      methodUsed,
      data: questions,
      previewText: rawText.slice(0, 400)
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Batch add multiple questions to an exam
// @route   POST /api/exams/:examId/questions/batch
// @access  Private (ADMIN, TEACHER)
exports.batchAddQuestions = async (req, res, next) => {
  try {
    const { examId } = req.params;
    const { questions } = req.body;

    if (!mongoose.Types.ObjectId.isValid(examId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid exam ID format'
      });
    }

    const exam = await Exam.findById(examId);
    if (!exam) {
      return res.status(404).json({
        success: false,
        message: 'Exam not found'
      });
    }

    if (!checkExamOwnership(req.user, exam)) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to batch add questions to another instructor\'s exam'
      });
    }

    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an array of questions'
      });
    }

    const formattedQuestions = [];
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.questionText || !String(q.questionText).trim()) {
        return res.status(400).json({
          success: false,
          message: `Question #${i + 1} is missing question text`
        });
      }

      const qType = q.type === 'SUBJECTIVE' ? 'SUBJECTIVE' : (q.type === 'MULTIPLE' ? 'MULTIPLE' : 'SINGLE');

      if (qType === 'SUBJECTIVE') {
        formattedQuestions.push({
          examId,
          questionText: String(q.questionText).trim(),
          options: [],
          type: 'SUBJECTIVE',
          correctAnswer: q.expectedAnswer ? String(q.expectedAnswer).trim() : '',
          correctAnswers: [],
          expectedAnswer: q.expectedAnswer ? String(q.expectedAnswer).trim() : '',
          keywords: sanitizeStringArray(q.keywords),
          keyConcepts: sanitizeStringArray(q.keyConcepts),
          rubric: Array.isArray(q.rubric) ? q.rubric : [],
          evaluationConfig: q.evaluationConfig && typeof q.evaluationConfig === 'object' ? q.evaluationConfig : {},
          marks: Math.max(0.5, Number(q.marks) || 1),
          explanation: q.explanation ? String(q.explanation).trim() : '',
          imageUrl: q.imageUrl ? String(q.imageUrl).trim() : null
        });
      } else {
        if (!Array.isArray(q.options) || q.options.length < 2) {
          return res.status(400).json({
            success: false,
            message: `Question #${i + 1} must have at least 2 options`
          });
        }
        const cleanOptions = q.options.map((opt) => String(opt).trim()).filter(Boolean);
        if (cleanOptions.length < 2) {
          return res.status(400).json({
            success: false,
            message: `Question #${i + 1} must have at least 2 valid options`
          });
        }

        const cleanCorrect = String(q.correctAnswer || '').trim();
        if (!cleanCorrect || !cleanOptions.includes(cleanCorrect)) {
          return res.status(400).json({
            success: false,
            message: `Question #${i + 1} ("${String(q.questionText).slice(0, 30)}...") does not have a valid correct answer matching one of its options`
          });
        }

        formattedQuestions.push({
          examId,
          questionText: String(q.questionText).trim(),
          options: cleanOptions,
          type: 'SINGLE',
          correctAnswer: cleanCorrect,
          correctAnswers: [cleanCorrect],
          marks: Math.max(0.5, Number(q.marks) || 1),
          explanation: q.explanation ? String(q.explanation).trim() : '',
          imageUrl: q.imageUrl ? String(q.imageUrl).trim() : null
        });
      }
    }

    const inserted = await Question.insertMany(formattedQuestions);
    await updateExamTotalMarks(examId);

    res.status(201).json({
      success: true,
      message: `Successfully imported ${inserted.length} questions into exam!`,
      count: inserted.length,
      data: inserted
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Test / Preview AI Subjective Answer Evaluation (Teacher preview in Question editor)
// @route   POST /api/questions/evaluate-preview
// @access  Private (ADMIN, TEACHER)
exports.evaluateSubjectivePreview = async (req, res, next) => {
  try {
    const { questionText, maxMarks, expectedAnswer, keywords, keyConcepts, rubric, studentAnswer, evaluationConfig } = req.body;

    if (!questionText || !String(questionText).trim()) {
      return res.status(400).json({
        success: false,
        message: 'Please provide questionText for preview evaluation'
      });
    }

    const questionMock = {
      questionText,
      marks: Number(maxMarks) || 5,
      expectedAnswer: expectedAnswer || '',
      keywords: sanitizeStringArray(keywords),
      keyConcepts: sanitizeStringArray(keyConcepts),
      rubric: Array.isArray(rubric) ? rubric : [],
      evaluationConfig: evaluationConfig || {}
    };

    const evaluationResult = await subjectiveEvaluationService.evaluateAnswer({
      question: questionMock,
      studentAnswer: studentAnswer || ''
    });

    res.status(200).json({
      success: true,
      message: 'Subjective preview evaluation completed',
      data: evaluationResult
    });
  } catch (error) {
    next(error);
  }
};
