const express = require('express');
const router = express.Router();
const {
  getAdminResults,
  exportAdminResults,
  createExportJob,
  getExportJobStatus,
  getExportHistory,
  downloadExportFile
} = require('../controllers/adminResultController');
const { protect } = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');

// All Admin Bulk Result endpoints require ADMIN authentication
router.use(protect);
router.use(authorizeRoles('ADMIN'));

router.get('/', getAdminResults);
router.get('/exports', getExportHistory);
router.get('/export', exportAdminResults);
router.post('/export', createExportJob);
router.get('/export/:jobId', getExportJobStatus);
router.get('/export/:jobId/download', downloadExportFile);

module.exports = router;
