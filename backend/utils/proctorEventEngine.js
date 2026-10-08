const mongoose = require('mongoose');
const ProctoringEvent = require('../models/ProctoringEvent');
const ProctoringSession = require('../models/ProctoringSession');
const ExamAttempt = require('../models/ExamAttempt');
const { evaluateEvent } = require('./warningEngine');

// List of allowed client-reported proctoring event types
const ALLOWED_EVENT_TYPES = new Set([
  // Session Lifecycle
  'SESSION_STARTED',
  'SESSION_RESUMED',
  'HEARTBEAT',
  'SOCKET_CONNECTED',
  'SOCKET_DISCONNECTED',
  'SESSION_ENDED',
  // Browser & Window State
  'TAB_HIDDEN',
  'TAB_VISIBLE',
  'WINDOW_BLUR',
  'WINDOW_FOCUS',
  'FULLSCREEN_ENTERED',
  'FULLSCREEN_EXITED',
  'PAGE_RELOADED',
  // Camera Lifecycle & Integrity
  'CAMERA_PERMISSION_GRANTED',
  'CAMERA_PERMISSION_DENIED',
  'CAMERA_UNAVAILABLE',
  'CAMERA_DISABLED',
  'CAMERA_STREAM_INTERRUPTED',
  'CAMERA_TRACK_ENDED',
  'CAMERA_PREVIEW_HIDDEN',
  'CAMERA_PREVIEW_TAMPERED',
  'CAMERA_CALIBRATION_COMPLETED',
  // Face Detection & Distance / Position
  'FACE_DETECTED',
  'FACE_LOST',
  'FACE_TOO_FAR',
  'FACE_TOO_CLOSE',
  'FACE_OUT_OF_FRAME',
  'MULTIPLE_FACES_DETECTED',
  'MULTIPLE_FACES_CLEARED',
  // Eye & Gaze Estimation
  'GAZE_CENTER',
  'GAZE_LEFT',
  'GAZE_RIGHT',
  'GAZE_UP',
  'GAZE_DOWN',
  'GAZE_AWAY',
  // Head Pose Estimation
  'HEAD_FORWARD',
  'HEAD_LEFT',
  'HEAD_RIGHT',
  'HEAD_UP',
  'HEAD_DOWN',
  'HEAD_AWAY',
  // Microphone Lifecycle
  'MIC_PERMISSION_GRANTED',
  'MIC_PERMISSION_DENIED',
  'MIC_UNAVAILABLE',
  'MIC_TRACK_ENDED',
  // Voice Activity Detection
  'VOICE_ACTIVITY_STARTED',
  'VOICE_ACTIVITY_STOPPED',
  'MOUTH_MOVEMENT_DETECTED'
]);

// Map default severity for events
const EVENT_SEVERITY_MAP = {
  FACE_LOST: 'MEDIUM',
  FACE_TOO_FAR: 'MEDIUM',
  FACE_TOO_CLOSE: 'MEDIUM',
  FACE_OUT_OF_FRAME: 'MEDIUM',
  MULTIPLE_FACES_DETECTED: 'HIGH',
  MULTIPLE_FACES_CLEARED: 'INFO',
  FACE_DETECTED: 'INFO',
  GAZE_AWAY: 'LOW',
  GAZE_CENTER: 'INFO',
  HEAD_AWAY: 'LOW',
  HEAD_FORWARD: 'INFO',
  TAB_HIDDEN: 'MEDIUM',
  TAB_VISIBLE: 'INFO',
  WINDOW_BLUR: 'LOW',
  WINDOW_FOCUS: 'INFO',
  FULLSCREEN_EXITED: 'HIGH',
  FULLSCREEN_ENTERED: 'INFO',
  VOICE_ACTIVITY_STARTED: 'LOW',
  VOICE_ACTIVITY_STOPPED: 'INFO',
  MOUTH_MOVEMENT_DETECTED: 'LOW',
  CAMERA_UNAVAILABLE: 'HIGH',
  CAMERA_DISABLED: 'HIGH',
  CAMERA_STREAM_INTERRUPTED: 'MEDIUM',
  CAMERA_PREVIEW_HIDDEN: 'HIGH',
  CAMERA_PREVIEW_TAMPERED: 'HIGH',
  CAMERA_CALIBRATION_COMPLETED: 'INFO',
  CAMERA_PERMISSION_DENIED: 'HIGH',
  MIC_UNAVAILABLE: 'MEDIUM',
  MIC_PERMISSION_DENIED: 'MEDIUM'
};

/**
 * Ingest, validate, persist, and process a proctoring event
 *
 * @param {Object} params
 * @param {string} params.attemptId
 * @param {string} params.studentId
 * @param {string} params.eventType
 * @param {Object} [params.metadata]
 * @param {Object} [io] Socket.IO instance for real-time broadcast
 * @returns {Promise<{ event: Object, warning: Object|null }>}
 */
async function processProctoringEvent({ attemptId, studentId, eventType, metadata = {} }, io = null) {
  if (!attemptId || !mongoose.Types.ObjectId.isValid(attemptId)) {
    const err = new Error('Invalid attempt ID format');
    err.statusCode = 400;
    throw err;
  }

  if (!ALLOWED_EVENT_TYPES.has(eventType)) {
    const err = new Error(`Unknown or unauthorized proctoring event type: '${eventType}'`);
    err.statusCode = 400;
    throw err;
  }

  // Metadata safety: ensure metadata is an object and under 10KB
  const safeMetadata = typeof metadata === 'object' && metadata !== null ? metadata : {};
  const metadataString = JSON.stringify(safeMetadata);
  if (metadataString.length > 10240) {
    const err = new Error('Event metadata payload exceeds maximum allowed size (10KB)');
    err.statusCode = 400;
    throw err;
  }

  // Fetch verified active attempt
  const attempt = await ExamAttempt.findById(attemptId);
  if (!attempt) {
    const err = new Error('Exam attempt not found');
    err.statusCode = 404;
    throw err;
  }

  // Verify ownership
  if (attempt.studentId.toString() !== studentId.toString()) {
    const err = new Error('Ownership verification failed: Attempt does not belong to student');
    err.statusCode = 403;
    throw err;
  }

  // Fetch or find active ProctoringSession
  let session = await ProctoringSession.findOne({ attemptId });
  if (!session) {
    session = await ProctoringSession.create({
      attemptId: attempt._id,
      examId: attempt.examId,
      studentId: attempt.studentId,
      status: 'ACTIVE',
      startedAt: new Date(),
      connectedAt: new Date(),
      lastHeartbeatAt: new Date()
    });
  }

  const severity = EVENT_SEVERITY_MAP[eventType] || 'INFO';
  const serverTimestamp = new Date();

  // Create immutable event document
  const eventDoc = await ProctoringEvent.create({
    sessionId: session._id,
    attemptId: attempt._id,
    examId: attempt.examId,
    studentId: attempt.studentId,
    eventType,
    severity,
    metadata: safeMetadata,
    serverTimestamp
  });

  // Evaluate for rule-based automated warning creation
  const warning = await evaluateEvent(eventDoc);

  // Real-time broadcast via Socket.IO if configured
  if (io) {
    try {
      const payload = {
        eventId: eventDoc._id,
        sessionId: session._id,
        attemptId: attempt._id,
        examId: attempt.examId,
        studentId: attempt.studentId,
        eventType,
        severity,
        metadata: safeMetadata,
        serverTimestamp,
        warning: warning ? {
          warningId: warning._id,
          warningType: warning.warningType,
          message: warning.message,
          severity: warning.severity
        } : null
      };

      const proctorNs = io.of('/proctor');
      proctorNs.to(`attempt_${attempt._id}`).emit('proctor:event', payload);
      proctorNs.to(`exam_${attempt.examId}`).emit('proctor:event', payload);
      proctorNs.to('admin_monitors').emit('proctor:event', payload);
    } catch (sockErr) {
      console.warn('Socket proctor event broadcast error:', sockErr.message);
    }
  }

  return { event: eventDoc, warning };
}

module.exports = {
  ALLOWED_EVENT_TYPES,
  EVENT_SEVERITY_MAP,
  processProctoringEvent
};
