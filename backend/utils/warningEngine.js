const ProctoringWarning = require('../models/ProctoringWarning');
const ProctoringSession = require('../models/ProctoringSession');
const ExamAttempt = require('../models/ExamAttempt');

/**
 * Rules definitions with thresholds, deduplication, and factual messages
 */
const WARNING_RULES = {
  FACE_LOST: {
    warningType: 'FACE_ABSENT',
    message: 'Your face is not currently visible. Please remain in camera view.',
    severity: 'MEDIUM',
    cooldownMs: 10000
  },
  FACE_TOO_FAR: {
    warningType: 'FACE_TOO_FAR',
    message: 'You appear too far from the camera. Please sit closer to the camera.',
    severity: 'MEDIUM',
    cooldownMs: 15000
  },
  FACE_TOO_CLOSE: {
    warningType: 'FACE_TOO_CLOSE',
    message: 'You appear too close to the camera. Please sit back slightly.',
    severity: 'MEDIUM',
    cooldownMs: 15000
  },
  FACE_OUT_OF_FRAME: {
    warningType: 'FACE_OUT_OF_FRAME',
    message: 'Please keep your face centered in the camera frame.',
    severity: 'MEDIUM',
    cooldownMs: 15000
  },
  MULTIPLE_FACES_DETECTED: {
    warningType: 'MULTIPLE_FACES',
    message: 'Multiple faces were detected in camera view. Ensure only the candidate is visible.',
    severity: 'HIGH',
    cooldownMs: 12000
  },
  GAZE_AWAY: {
    warningType: 'GAZE_DEVIATION',
    message: 'Frequent gaze deviation detected. Please focus on your exam screen.',
    severity: 'LOW',
    cooldownMs: 15000
  },
  HEAD_AWAY: {
    warningType: 'HEAD_DEVIATION',
    message: 'Head movement away from screen detected. Please face forward.',
    severity: 'LOW',
    cooldownMs: 15000
  },
  TAB_HIDDEN: {
    warningType: 'TAB_SWITCH',
    message: 'Assessment tab lost focus. Please remain on the exam screen.',
    severity: 'MEDIUM',
    cooldownMs: 5000
  },
  WINDOW_BLUR: {
    warningType: 'WINDOW_FOCUS_LOST',
    message: 'Exam window lost focus. Please keep the exam active.',
    severity: 'LOW',
    cooldownMs: 5000
  },
  FULLSCREEN_EXITED: {
    warningType: 'FULLSCREEN_EXIT',
    message: 'Full-screen mode exited. Please return to full-screen immediately.',
    severity: 'HIGH',
    cooldownMs: 6000
  },
  VOICE_ACTIVITY_STARTED: {
    warningType: 'VOICE_DETECTED',
    message: 'Sustained microphone audio detected. Please maintain quiet exam conditions.',
    severity: 'LOW',
    cooldownMs: 12000
  },
  CAMERA_UNAVAILABLE: {
    warningType: 'CAMERA_OFFLINE',
    message: 'Camera stream interrupted. Camera is required for proctoring.',
    severity: 'HIGH',
    cooldownMs: 10000
  },
  CAMERA_DISABLED: {
    warningType: 'CAMERA_DISABLED',
    message: 'Camera video track was disabled. Please keep your camera active.',
    severity: 'HIGH',
    cooldownMs: 10000
  },
  CAMERA_STREAM_INTERRUPTED: {
    warningType: 'CAMERA_INTERRUPTED',
    message: 'Camera connection interrupted. Please restore camera access.',
    severity: 'MEDIUM',
    cooldownMs: 10000
  },
  CAMERA_PREVIEW_HIDDEN: {
    warningType: 'CAMERA_PREVIEW_HIDDEN',
    message: 'Camera preview is hidden or obstructed. The camera window must remain visible.',
    severity: 'HIGH',
    cooldownMs: 15000
  },
  CAMERA_PREVIEW_TAMPERED: {
    warningType: 'CAMERA_PREVIEW_TAMPERED',
    message: 'Camera window tampering detected. Please keep camera preview visible and unobstructed.',
    severity: 'HIGH',
    cooldownMs: 15000
  },
  MOUTH_MOVEMENT_DETECTED: {
    warningType: 'MOUTH_MOVEMENT',
    message: 'Mouth movement detected. Please maintain stillness during the assessment.',
    severity: 'LOW',
    cooldownMs: 15000
  },
  MIC_UNAVAILABLE: {
    warningType: 'MIC_OFFLINE',
    message: 'Microphone stream interrupted. Microphone is required for proctoring.',
    severity: 'MEDIUM',
    cooldownMs: 10000
  }
};

/**
 * In-memory cooldown tracker to prevent rapid spamming before DB writes
 * Map<attemptId:warningType, lastIssuedTimestamp>
 */
const cooldownCache = new Map();

/**
 * Evaluate an incoming proctoring event and generate a warning if justified
 */
async function evaluateEvent(eventDoc) {
  if (!eventDoc || !eventDoc.eventType) return null;

  const rule = WARNING_RULES[eventDoc.eventType];
  if (!rule) return null;

  const cacheKey = `${eventDoc.attemptId}:${rule.warningType}`;
  const now = Date.now();
  const lastIssued = cooldownCache.get(cacheKey) || 0;

  if (now - lastIssued < rule.cooldownMs) {
    return null; // Deduplicated within cooldown
  }

  // Check if an ACTIVE warning of this type already exists in the database within cooldown
  const existingActive = await ProctoringWarning.findOne({
    attemptId: eventDoc.attemptId,
    warningType: rule.warningType,
    status: 'ACTIVE',
    issuedAt: { $gte: new Date(now - rule.cooldownMs) }
  });

  if (existingActive) {
    return null; // Deduplicated
  }

  // Create new warning
  const warning = await ProctoringWarning.create({
    sessionId: eventDoc.sessionId,
    attemptId: eventDoc.attemptId,
    examId: eventDoc.examId,
    studentId: eventDoc.studentId,
    eventId: eventDoc._id,
    warningType: rule.warningType,
    message: rule.message,
    severity: rule.severity,
    status: 'ACTIVE',
    issuedAt: new Date()
  });

  cooldownCache.set(cacheKey, now);

  // Clean old cooldown cache entries periodically
  if (cooldownCache.size > 2000) {
    const threshold = now - 60000;
    for (const [k, ts] of cooldownCache.entries()) {
      if (ts < threshold) cooldownCache.delete(k);
    }
  }

  // Increment authoritative warning count on ProctoringSession & ExamAttempt
  try {
    const totalActiveWarnings = await ProctoringWarning.countDocuments({
      attemptId: eventDoc.attemptId,
      status: { $in: ['ACTIVE', 'ACKNOWLEDGED'] }
    });

    await ProctoringSession.findByIdAndUpdate(eventDoc.sessionId, {
      warningCount: totalActiveWarnings,
      $inc: { violationCount: 1 }
    });

    await ExamAttempt.findByIdAndUpdate(eventDoc.attemptId, {
      warningCount: totalActiveWarnings
    });
  } catch (err) {
    console.warn('Warning counter update error:', err.message);
  }

  return warning;
}

module.exports = {
  WARNING_RULES,
  evaluateEvent
};
