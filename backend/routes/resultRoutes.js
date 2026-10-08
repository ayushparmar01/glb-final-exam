const express = require('express');
const router = express.Router();
const {
  submitExam,
  getMyResults,
  getResultById,
  getAllResultsAdmin,
  saveExamProgress,
  downloadResultPdf,
  overrideSubjectiveAnswer
} = require('../controllers/resultController');
const { protect } = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');
const { validateObjectId } = require('../middleware/validator');

router.use(protect);

// Student routes
router.post('/submit', authorizeRoles('STUDENT'), submitExam);
router.patch('/attempts/:examId/save', authorizeRoles('STUDENT'), validateObjectId('examId'), saveExamProgress);
router.get('/my-results', authorizeRoles('STUDENT'), getMyResults);

// Teacher / Admin subjective marks override
router.patch('/:id/subjective-override', authorizeRoles('ADMIN', 'TEACHER'), validateObjectId('id'), overrideSubjectiveAnswer);

// Shared routes (Access verified in controller)
router.get('/:id', validateObjectId('id'), getResultById);
router.get('/:id/pdf', validateObjectId('id'), downloadResultPdf);

const {
  getAdminResults,
  exportAdminResults
} = require('../controllers/adminResultController');

// Admin routes
router.get('/admin/all', authorizeRoles('ADMIN'), getAllResultsAdmin);
router.get('/admin/results', authorizeRoles('ADMIN'), getAdminResults);
router.get('/admin/export', authorizeRoles('ADMIN'), exportAdminResults);

module.exports = router;
