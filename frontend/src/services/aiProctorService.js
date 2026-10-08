/**
 * Real MediaPipe Tasks Vision AI Proctoring Service (GLB ExamSphere)
 *
 * Real Browser-Side Multi-Signal AI Telemetry:
 * - MediaPipe Tasks Vision FaceLandmarker (478 3D facial landmarks)
 *   ├── Real Face Presence & Multi-Face Count (0 -> FACE_LOST, >1 -> MULTIPLE_FACES_DETECTED)
 *   ├── Approximate Landmark-Based Head Orientation (HEAD_FORWARD, HEAD_LEFT, HEAD_RIGHT, HEAD_UP, HEAD_DOWN, HEAD_AWAY)
 *   ├── Normalized Eye / Iris Gaze Deviation (GAZE_CENTER, GAZE_LEFT, GAZE_RIGHT, GAZE_UP, GAZE_DOWN, GAZE_AWAY)
 *   ├── Face Bounding Box & Distance / Position Monitoring (FACE_TOO_FAR, FACE_TOO_CLOSE, FACE_OUT_OF_FRAME)
 *   ├── Non-Biometric Session Calibration (Baseline Geometry)
 *   └── Lip Aperture Mouth Movement (MOUTH_MOVEMENT_DETECTED)
 * - Web Audio API Vocal Frequency Band Voice Activity Detection (300Hz - 3400Hz)
 *
 * Privacy & Security Guarantees:
 * - 100% Browser-side inference with zero raw camera frames/video/audio uploaded
 * - Zero biometric face embeddings or templates created or stored
 * - Purely structured JSON telemetry with server-authoritative timestamps & cooldowns
 */

import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';

// Official MediaPipe Tasks Vision Asset & Model Paths
const WASM_CDN_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const FACE_LANDMARKER_LOCAL = '/models/face_landmarker.task';
const FACE_LANDMARKER_CDN = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

export class AIProctorService {
  constructor(options = {}) {
    this.options = {
      // Temporal Durations (sustained milliseconds before event confirmation)
      faceLostDurationMs: 2500,          // 2.5s continuous absence -> FACE_LOST
      multipleFacesDurationMs: 2000,     // 2.0s continuous extra faces -> MULTIPLE_FACES_DETECTED
      faceTooFarDurationMs: 2500,        // 2.5s continuous too far -> FACE_TOO_FAR
      faceTooCloseDurationMs: 2500,      // 2.5s continuous too close -> FACE_TOO_CLOSE
      faceOutOfFrameDurationMs: 2500,    // 2.5s continuous out of frame -> FACE_OUT_OF_FRAME
      gazeAwayDurationMs: 3000,          // 3.0s continuous gaze away -> GAZE_AWAY
      headAwayDurationMs: 3000,          // 3.0s continuous head turn -> HEAD_AWAY
      mouthMovementDurationMs: 2000,     // 2.0s sustained mouth opening/movement -> MOUTH_MOVEMENT_DETECTED
      voiceActivityDurationMs: 1500,     // 1.5s sustained audio -> VOICE_ACTIVITY_STARTED

      // Configurable Distance & Frame Proximity Thresholds
      tooFarAreaRatioThreshold: 0.10,    // < 10% of frame area -> TOO_FAR
      tooCloseAreaRatioThreshold: 0.65,  // > 65% of frame area -> TOO_CLOSE
      frameMarginMinThreshold: 0.02,     // 2% margin from frame edge
      frameMarginMaxThreshold: 0.98,     // 98% margin from frame edge

      // Inference Loop & Cooldowns
      inferenceIntervalMs: 100,          // ~10 inference FPS
      eventCooldownMs: 12000,            // 12s minimum cooldown between duplicate event emissions
      ...options
    };

    // Hardware & Media Streams
    this.videoElement = null;
    this.cameraStream = null;
    this.micStream = null;
    this.audioContext = null;
    this.audioAnalyser = null;
    this.audioDataArray = null;

    // MediaPipe Models & Inference Engine
    this.vision = null;
    this.faceLandmarker = null;
    this.isModelLoading = false;
    this.isInferring = false;
    this.inferenceTimer = null;
    this.vadTimer = null;
    this.isMonitoring = false;

    // Temporal Smoothing & Position History (Rolling window of 10 frames)
    this.positionHistory = [];
    this.maxPositionHistory = 10;

    // Non-Biometric Session Baseline Calibration
    this.baselineCalibration = {
      isCalibrated: false,
      baselineFaceArea: 0.25,
      baselineFaceCenter: { x: 0.5, y: 0.5 },
      calibrationSamples: []
    };

    // Authoritative Live Telemetry State
    this.currentState = {
      aiStatus: 'INITIALIZING',       // 'INITIALIZING' | 'READY' | 'AI_UNAVAILABLE'
      cameraStatus: 'UNKNOWN',        // 'ACTIVE' | 'BLOCKED' | 'UNAVAILABLE' | 'DISCONNECTED'
      micStatus: 'UNKNOWN',           // 'ACTIVE' | 'BLOCKED' | 'UNAVAILABLE' | 'DISCONNECTED'
      faceStatus: 'UNKNOWN',          // 'NO_FACE' | 'FACE_DETECTED' | 'MULTIPLE_FACES'
      faceCount: 0,
      positionQuality: 'GOOD',        // 'GOOD' | 'FACE TOO FAR' | 'FACE TOO CLOSE' | 'MOVE INTO FRAME' | 'FACE NOT DETECTED' | 'MULTIPLE FACES' | 'CAMERA ERROR'
      faceGeometry: {
        faceAreaRatio: 0,
        faceCenterX: 0.5,
        faceCenterY: 0.5,
        smoothedAreaRatio: 0
      },
      gazeStatus: 'GAZE_CENTER',      // 'GAZE_CENTER' | 'GAZE_LEFT' | 'GAZE_RIGHT' | 'GAZE_UP' | 'GAZE_DOWN' | 'GAZE_AWAY'
      headStatus: 'HEAD_FORWARD',     // 'HEAD_FORWARD' | 'HEAD_LEFT' | 'HEAD_RIGHT' | 'HEAD_UP' | 'HEAD_DOWN' | 'HEAD_AWAY'
      mouthMoving: false,
      voiceActive: false
    };

    // Temporal State Timers
    this.stateStartTimes = {
      faceAbsentSince: null,
      multipleFacesSince: null,
      faceTooFarSince: null,
      faceTooCloseSince: null,
      faceOutOfFrameSince: null,
      gazeAwaySince: null,
      headAwaySince: null,
      mouthMovementSince: null,
      voiceActiveSince: null
    };

    // Event Cooldown Tracking
    this.lastEmittedEvents = new Map();

    // Event & State Subscribers
    this.eventCallback = null;
    this.stateChangeCallback = null;
  }

  onEvent(callback) {
    this.eventCallback = callback;
  }

  onStateChange(callback) {
    this.stateChangeCallback = callback;
  }

  emitEvent(eventType, metadata = {}) {
    const now = Date.now();
    const eventKey = eventType;
    const lastTime = this.lastEmittedEvents.get(eventKey) || 0;

    // Enforce cooldown to prevent event spamming (minimum 12s)
    if (now - lastTime < this.options.eventCooldownMs) {
      return;
    }

    this.lastEmittedEvents.set(eventKey, now);

    if (this.eventCallback) {
      this.eventCallback({
        eventType,
        metadata,
        timestamp: new Date().toISOString()
      });
    }
  }

  notifyStateChange() {
    if (this.stateChangeCallback) {
      this.stateChangeCallback({ ...this.currentState });
    }
  }

  /**
   * 1. Initialize MediaPipe Tasks Vision FaceLandmarker
   */
  async initModels() {
    if (this.faceLandmarker || this.isModelLoading) return;
    this.isModelLoading = true;

    try {
      this.vision = await FilesetResolver.forVisionTasks(WASM_CDN_URL);

      try {
        this.faceLandmarker = await FaceLandmarker.createFromOptions(this.vision, {
          baseOptions: {
            modelAssetPath: FACE_LANDMARKER_LOCAL,
            delegate: 'GPU'
          },
          runningMode: 'VIDEO',
          numFaces: 4,
          minFaceDetectionConfidence: 0.5,
          minFacePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: true
        });
      } catch (errLocal) {
        console.warn('Local MediaPipe model fallback to CDN:', errLocal.message);
        this.faceLandmarker = await FaceLandmarker.createFromOptions(this.vision, {
          baseOptions: {
            modelAssetPath: FACE_LANDMARKER_CDN,
            delegate: 'CPU'
          },
          runningMode: 'VIDEO',
          numFaces: 4,
          minFaceDetectionConfidence: 0.5,
          minFacePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: true
        });
      }

      this.currentState.aiStatus = 'READY';
      this.notifyStateChange();
    } catch (err) {
      console.warn('MediaPipe Tasks Vision unavailable:', err.message);
      this.currentState.aiStatus = 'AI_UNAVAILABLE';
      this.notifyStateChange();
    } finally {
      this.isModelLoading = false;
    }
  }

  /**
   * 2. Initialize Camera Feed
   */
  async initCamera(videoEl) {
    this.videoElement = videoEl;
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        this.currentState.cameraStatus = 'UNAVAILABLE';
        this.currentState.positionQuality = 'CAMERA ERROR';
        this.notifyStateChange();
        this.emitEvent('CAMERA_UNAVAILABLE', { reason: 'MediaDevices API unsupported' });
        return { success: false, error: 'Camera API not supported in browser' };
      }

      let stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 30 } },
          audio: false
        });
      } catch (e1) {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }

      this.cameraStream = stream;
      this.currentState.cameraStatus = 'ACTIVE';

      if (this.videoElement) {
        this.videoElement.srcObject = stream;
        this.videoElement.muted = true;
        await this.videoElement.play().catch(() => {});
      }

      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          this.currentState.cameraStatus = 'DISCONNECTED';
          this.currentState.positionQuality = 'CAMERA ERROR';
          this.notifyStateChange();
          this.emitEvent('CAMERA_STREAM_INTERRUPTED', { reason: 'Camera track ended' });
        };
      }

      this.emitEvent('CAMERA_PERMISSION_GRANTED');
      this.notifyStateChange();
      return { success: true };
    } catch (err) {
      const isDenied = err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError';
      this.currentState.cameraStatus = isDenied ? 'BLOCKED' : 'UNAVAILABLE';
      this.currentState.positionQuality = 'CAMERA ERROR';
      this.notifyStateChange();
      this.emitEvent(isDenied ? 'CAMERA_PERMISSION_DENIED' : 'CAMERA_UNAVAILABLE', { error: err.message });
      return { success: false, error: isDenied ? 'Camera permission was denied' : err.message };
    }
  }

  /**
   * 3. Initialize Microphone & Voice Activity Detection
   */
  async initMicrophone() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        this.currentState.micStatus = 'UNAVAILABLE';
        this.notifyStateChange();
        this.emitEvent('MIC_UNAVAILABLE', { reason: 'MediaDevices API unsupported' });
        return { success: false, error: 'Microphone API not supported' };
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this.micStream = stream;
      this.currentState.micStatus = 'ACTIVE';

      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          this.audioContext = new AudioCtx();
          const source = this.audioContext.createMediaStreamSource(stream);
          this.audioAnalyser = this.audioContext.createAnalyser();
          this.audioAnalyser.fftSize = 256;
          this.audioAnalyser.smoothingTimeConstant = 0.8;
          source.connect(this.audioAnalyser);
          this.audioDataArray = new Uint8Array(this.audioAnalyser.frequencyBinCount);

          this.startVoiceActivityDetection();
        }
      } catch (audioErr) {
        console.warn('Web Audio setup notice:', audioErr.message);
      }

      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.onended = () => {
          this.currentState.micStatus = 'DISCONNECTED';
          this.notifyStateChange();
          this.emitEvent('MIC_TRACK_ENDED');
        };
      }

      this.emitEvent('MIC_PERMISSION_GRANTED');
      this.notifyStateChange();
      return { success: true };
    } catch (err) {
      const isDenied = err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError';
      this.currentState.micStatus = isDenied ? 'BLOCKED' : 'UNAVAILABLE';
      this.notifyStateChange();
      this.emitEvent(isDenied ? 'MIC_PERMISSION_DENIED' : 'MIC_UNAVAILABLE', { error: err.message });
      return { success: false, error: isDenied ? 'Microphone permission was denied' : err.message };
    }
  }

  /**
   * 4. Web Audio Voice Activity Detection (300Hz - 3400Hz vocal band)
   */
  startVoiceActivityDetection() {
    if (this.vadTimer) clearInterval(this.vadTimer);

    this.vadTimer = setInterval(() => {
      if (!this.audioAnalyser || !this.audioDataArray || !this.audioContext) return;

      this.audioAnalyser.getByteFrequencyData(this.audioDataArray);

      const sampleRate = this.audioContext.sampleRate || 44100;
      const fftSize = this.audioAnalyser.fftSize || 256;
      const binResolution = sampleRate / fftSize;

      const startBin = Math.max(0, Math.floor(300 / binResolution));
      const endBin = Math.min(this.audioDataArray.length, Math.ceil(3400 / binResolution));
      const vocalBinCount = Math.max(1, endBin - startBin);

      let sum = 0;
      for (let i = startBin; i < endBin; i++) {
        sum += this.audioDataArray[i];
      }
      const averageVolume = sum / vocalBinCount;
      const isSpeaking = averageVolume > 35;

      const now = Date.now();
      if (isSpeaking) {
        if (!this.stateStartTimes.voiceActiveSince) {
          this.stateStartTimes.voiceActiveSince = now;
        } else if (now - this.stateStartTimes.voiceActiveSince > this.options.voiceActivityDurationMs) {
          if (!this.currentState.voiceActive) {
            this.currentState.voiceActive = true;
            this.notifyStateChange();
            this.emitEvent('VOICE_ACTIVITY_STARTED', {
              volumeLevel: Math.round(averageVolume),
              mouthMovement: Boolean(this.currentState.mouthMoving)
            });
          }
        }
      } else {
        this.stateStartTimes.voiceActiveSince = null;
        if (this.currentState.voiceActive) {
          this.currentState.voiceActive = false;
          this.notifyStateChange();
          this.emitEvent('VOICE_ACTIVITY_STOPPED');
        }
      }
    }, 300);
  }

  /**
   * 5. Start Inference Loop (~10 FPS, non-overlapping)
   */
  startMonitoring() {
    if (this.isMonitoring) return;
    this.isMonitoring = true;

    this.initModels().catch(() => {});

    this.inferenceTimer = setInterval(() => {
      this.runInferenceTick();
    }, this.options.inferenceIntervalMs);
  }

  /**
   * 6. Real-time Inference Tick (FaceLandmarker)
   */
  async runInferenceTick() {
    if (!this.isMonitoring || this.isInferring) return;

    const video = this.videoElement;
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      return;
    }

    if (!this.faceLandmarker) {
      return;
    }

    this.isInferring = true;
    const now = Date.now();
    const timestampMs = performance.now();

    try {
      const faceResult = this.faceLandmarker.detectForVideo(video, timestampMs);
      const faceLandmarks = faceResult.faceLandmarks || [];
      const faceCount = faceLandmarks.length;

      this.processFaceDetection(faceCount, now);

      if (faceCount === 1) {
        const landmarks = faceLandmarks[0];
        this.processFacePositionAndDistance(landmarks, now);
        this.processHeadPose(landmarks, now);
        this.processGazeEstimation(landmarks, now);
        this.processMouthMovement(landmarks, now);
      }
    } catch (err) {
      console.warn('MediaPipe inference frame notice:', err.message);
    } finally {
      this.isInferring = false;
    }
  }

  /**
   * 7. Real Face Count Processing (0 -> FACE_LOST, >1 -> MULTIPLE_FACES)
   */
  processFaceDetection(count, now) {
    this.currentState.faceCount = count;

    if (count === 0) {
      this.stateStartTimes.multipleFacesSince = null;
      this.stateStartTimes.faceTooFarSince = null;
      this.stateStartTimes.faceTooCloseSince = null;
      this.stateStartTimes.faceOutOfFrameSince = null;

      if (!this.stateStartTimes.faceAbsentSince) {
        this.stateStartTimes.faceAbsentSince = now;
      } else if (now - this.stateStartTimes.faceAbsentSince > this.options.faceLostDurationMs) {
        if (this.currentState.faceStatus !== 'NO_FACE') {
          this.currentState.faceStatus = 'NO_FACE';
          this.currentState.positionQuality = 'FACE NOT DETECTED';
          this.notifyStateChange();
          this.emitEvent('FACE_LOST', { faceCount: 0 });
        }
      }
    } else if (count >= 2) {
      this.stateStartTimes.faceAbsentSince = null;
      if (!this.stateStartTimes.multipleFacesSince) {
        this.stateStartTimes.multipleFacesSince = now;
      } else if (now - this.stateStartTimes.multipleFacesSince > this.options.multipleFacesDurationMs) {
        if (this.currentState.faceStatus !== 'MULTIPLE_FACES') {
          this.currentState.faceStatus = 'MULTIPLE_FACES';
          this.currentState.positionQuality = 'MULTIPLE FACES';
          this.notifyStateChange();
          this.emitEvent('MULTIPLE_FACES_DETECTED', { faceCount: count });
        }
      }
    } else {
      // Exactly 1 Face
      const wasMultiple = this.currentState.faceStatus === 'MULTIPLE_FACES';
      this.stateStartTimes.faceAbsentSince = null;
      this.stateStartTimes.multipleFacesSince = null;

      if (this.currentState.faceStatus !== 'FACE_DETECTED') {
        this.currentState.faceStatus = 'FACE_DETECTED';
        this.notifyStateChange();
        this.emitEvent('FACE_DETECTED', { faceCount: 1 });
        if (wasMultiple) {
          this.emitEvent('MULTIPLE_FACES_CLEARED');
        }
      }
    }
  }

  /**
   * 8. Face Bounding Box, Temporal Smoothing, and Distance / Position Monitoring
   */
  processFacePositionAndDistance(landmarks, now) {
    if (!landmarks || landmarks.length < 468) return;

    // Calculate Bounding Box across all facial landmarks
    let minX = 1.0, maxX = 0.0, minY = 1.0, maxY = 0.0;
    for (let i = 0; i < landmarks.length; i++) {
      const pt = landmarks[i];
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }

    const faceWidth = Math.max(0.01, maxX - minX);
    const faceHeight = Math.max(0.01, maxY - minY);
    const rawAreaRatio = faceWidth * faceHeight;
    const rawCenterX = (minX + maxX) / 2;
    const rawCenterY = (minY + maxY) / 2;

    // Add to rolling history buffer for temporal smoothing
    this.positionHistory.push({
      area: rawAreaRatio,
      centerX: rawCenterX,
      centerY: rawCenterY,
      minX,
      maxX,
      minY,
      maxY
    });

    if (this.positionHistory.length > this.maxPositionHistory) {
      this.positionHistory.shift();
    }

    // Compute temporal smoothed values
    const histLen = this.positionHistory.length;
    let sumArea = 0, sumCenterX = 0, sumCenterY = 0;
    for (let i = 0; i < histLen; i++) {
      sumArea += this.positionHistory[i].area;
      sumCenterX += this.positionHistory[i].centerX;
      sumCenterY += this.positionHistory[i].centerY;
    }
    const smoothedArea = sumArea / histLen;
    const smoothedCenterX = sumCenterX / histLen;
    const smoothedCenterY = sumCenterY / histLen;

    this.currentState.faceGeometry = {
      faceAreaRatio: parseFloat(rawAreaRatio.toFixed(3)),
      faceCenterX: parseFloat(rawCenterX.toFixed(3)),
      faceCenterY: parseFloat(rawCenterY.toFixed(3)),
      smoothedAreaRatio: parseFloat(smoothedArea.toFixed(3))
    };

    // If calibration in progress, collect sample
    if (this.baselineCalibration.calibrationSamples.length < 20 && !this.baselineCalibration.isCalibrated) {
      this.baselineCalibration.calibrationSamples.push({ area: smoothedArea, centerX: smoothedCenterX, centerY: smoothedCenterY });
      if (this.baselineCalibration.calibrationSamples.length === 20) {
        let avgCalArea = 0, avgCalX = 0, avgCalY = 0;
        this.baselineCalibration.calibrationSamples.forEach(s => {
          avgCalArea += s.area;
          avgCalX += s.centerX;
          avgCalY += s.centerY;
        });
        this.baselineCalibration.baselineFaceArea = avgCalArea / 20;
        this.baselineCalibration.baselineFaceCenter = { x: avgCalX / 20, y: avgCalY / 20 };
        this.baselineCalibration.isCalibrated = true;
        this.emitEvent('CAMERA_CALIBRATION_COMPLETED', {
          baselineArea: parseFloat(this.baselineCalibration.baselineFaceArea.toFixed(3)),
          baselineCenter: this.baselineCalibration.baselineFaceCenter
        });
      }
    }

    // Evaluate Position Zones
    const isTooFar = smoothedArea < this.options.tooFarAreaRatioThreshold;
    const isTooClose = smoothedArea > this.options.tooCloseAreaRatioThreshold;
    const isOutOfFrame = (
      minX < this.options.frameMarginMinThreshold ||
      maxX > this.options.frameMarginMaxThreshold ||
      minY < this.options.frameMarginMinThreshold ||
      maxY > this.options.frameMarginMaxThreshold ||
      smoothedCenterX < 0.18 ||
      smoothedCenterX > 0.82 ||
      smoothedCenterY < 0.15 ||
      smoothedCenterY > 0.85
    );

    // 1. Distance: Too Far
    if (isTooFar) {
      this.stateStartTimes.faceTooCloseSince = null;
      this.stateStartTimes.faceOutOfFrameSince = null;
      if (!this.stateStartTimes.faceTooFarSince) {
        this.stateStartTimes.faceTooFarSince = now;
      } else if (now - this.stateStartTimes.faceTooFarSince > this.options.faceTooFarDurationMs) {
        this.currentState.positionQuality = 'FACE TOO FAR';
        this.notifyStateChange();
        this.emitEvent('FACE_TOO_FAR', {
          faceAreaRatio: parseFloat(smoothedArea.toFixed(3)),
          threshold: this.options.tooFarAreaRatioThreshold
        });
      }
    }
    // 2. Distance: Too Close
    else if (isTooClose) {
      this.stateStartTimes.faceTooFarSince = null;
      this.stateStartTimes.faceOutOfFrameSince = null;
      if (!this.stateStartTimes.faceTooCloseSince) {
        this.stateStartTimes.faceTooCloseSince = now;
      } else if (now - this.stateStartTimes.faceTooCloseSince > this.options.faceTooCloseDurationMs) {
        this.currentState.positionQuality = 'FACE TOO CLOSE';
        this.notifyStateChange();
        this.emitEvent('FACE_TOO_CLOSE', {
          faceAreaRatio: parseFloat(smoothedArea.toFixed(3)),
          threshold: this.options.tooCloseAreaRatioThreshold
        });
      }
    }
    // 3. Boundary / Frame Position: Out of Frame
    else if (isOutOfFrame) {
      this.stateStartTimes.faceTooFarSince = null;
      this.stateStartTimes.faceTooCloseSince = null;
      if (!this.stateStartTimes.faceOutOfFrameSince) {
        this.stateStartTimes.faceOutOfFrameSince = now;
      } else if (now - this.stateStartTimes.faceOutOfFrameSince > this.options.faceOutOfFrameDurationMs) {
        this.currentState.positionQuality = 'MOVE INTO FRAME';
        this.notifyStateChange();
        this.emitEvent('FACE_OUT_OF_FRAME', {
          centerX: parseFloat(smoothedCenterX.toFixed(3)),
          centerY: parseFloat(smoothedCenterY.toFixed(3)),
          minX: parseFloat(minX.toFixed(3)),
          maxX: parseFloat(maxX.toFixed(3))
        });
      }
    }
    // 4. Normal / Good Position
    else {
      this.stateStartTimes.faceTooFarSince = null;
      this.stateStartTimes.faceTooCloseSince = null;
      this.stateStartTimes.faceOutOfFrameSince = null;
      if (this.currentState.positionQuality !== 'GOOD') {
        this.currentState.positionQuality = 'GOOD';
        this.notifyStateChange();
      }
    }
  }

  /**
   * 9. Landmark-Based Head Orientation (Yaw & Pitch)
   */
  processHeadPose(landmarks, now) {
    if (!landmarks || landmarks.length < 468) return;

    const nose = landmarks[1];
    const forehead = landmarks[10];
    const chin = landmarks[152];
    const leftCheek = landmarks[234];
    const rightCheek = landmarks[454];

    // Normalized Horizontal Yaw Ratio
    const distNoseToLeft = Math.abs(nose.x - leftCheek.x);
    const distNoseToRight = Math.abs(rightCheek.x - nose.x);
    const yawRatio = (distNoseToLeft - distNoseToRight) / (distNoseToLeft + distNoseToRight + 1e-6);

    // Normalized Vertical Pitch Ratio
    const distNoseToTop = Math.abs(nose.y - forehead.y);
    const distNoseToBottom = Math.abs(chin.y - nose.y);
    const pitchRatio = (distNoseToTop - distNoseToBottom) / (distNoseToTop + distNoseToBottom + 1e-6);

    // Head Orientation Classification
    let detectedHead = 'HEAD_FORWARD';
    if (yawRatio > 0.38) {
      detectedHead = 'HEAD_RIGHT';
    } else if (yawRatio < -0.38) {
      detectedHead = 'HEAD_LEFT';
    } else if (pitchRatio > 0.40) {
      detectedHead = 'HEAD_DOWN';
    } else if (pitchRatio < -0.40) {
      detectedHead = 'HEAD_UP';
    }

    const isAway = detectedHead !== 'HEAD_FORWARD';

    if (isAway) {
      if (!this.stateStartTimes.headAwaySince) {
        this.stateStartTimes.headAwaySince = now;
      } else if (now - this.stateStartTimes.headAwaySince > this.options.headAwayDurationMs) {
        if (this.currentState.headStatus !== detectedHead) {
          this.currentState.headStatus = detectedHead;
          this.notifyStateChange();
          this.emitEvent('HEAD_AWAY', {
            orientation: detectedHead,
            yawRatio: parseFloat(yawRatio.toFixed(3)),
            pitchRatio: parseFloat(pitchRatio.toFixed(3))
          });
        }
      }
    } else {
      this.stateStartTimes.headAwaySince = null;
      if (this.currentState.headStatus !== 'HEAD_FORWARD') {
        this.currentState.headStatus = 'HEAD_FORWARD';
        this.notifyStateChange();
        this.emitEvent('HEAD_FORWARD');
      }
    }
  }

  /**
   * 10. Eye / Iris Gaze Estimation from Iris Landmarks
   */
  processGazeEstimation(landmarks, now) {
    if (!landmarks || landmarks.length < 478) return;

    const leftIris = landmarks[468];
    const leftOuter = landmarks[33];
    const leftInner = landmarks[133];
    const leftTop = landmarks[159];
    const leftBottom = landmarks[145];

    const rightIris = landmarks[473];
    const rightInner = landmarks[362];
    const rightOuter = landmarks[263];
    const rightTop = landmarks[386];
    const rightBottom = landmarks[374];

    // Horizontal Eye Ratio
    const leftEyeWidth = Math.abs(leftInner.x - leftOuter.x) + 1e-6;
    const leftIrisXRatio = (leftIris.x - leftOuter.x) / leftEyeWidth;

    const rightEyeWidth = Math.abs(rightOuter.x - rightInner.x) + 1e-6;
    const rightIrisXRatio = (rightIris.x - rightInner.x) / rightEyeWidth;

    const avgIrisX = (leftIrisXRatio + rightIrisXRatio) / 2;

    // Vertical Eye Ratio
    const leftEyeHeight = Math.abs(leftBottom.y - leftTop.y) + 1e-6;
    const leftIrisYRatio = (leftIris.y - leftTop.y) / leftEyeHeight;

    const rightEyeHeight = Math.abs(rightBottom.y - rightTop.y) + 1e-6;
    const rightIrisYRatio = (rightIris.y - rightTop.y) / rightEyeHeight;

    const avgIrisY = (leftIrisYRatio + rightIrisYRatio) / 2;

    // Gaze Direction Classification
    let detectedGaze = 'GAZE_CENTER';
    if (avgIrisX > 0.65) {
      detectedGaze = 'GAZE_RIGHT';
    } else if (avgIrisX < 0.35) {
      detectedGaze = 'GAZE_LEFT';
    } else if (avgIrisY > 0.70) {
      detectedGaze = 'GAZE_DOWN';
    } else if (avgIrisY < 0.30) {
      detectedGaze = 'GAZE_UP';
    }

    const isAway = detectedGaze !== 'GAZE_CENTER';

    if (isAway) {
      if (!this.stateStartTimes.gazeAwaySince) {
        this.stateStartTimes.gazeAwaySince = now;
      } else if (now - this.stateStartTimes.gazeAwaySince > this.options.gazeAwayDurationMs) {
        if (this.currentState.gazeStatus !== detectedGaze) {
          this.currentState.gazeStatus = detectedGaze;
          this.notifyStateChange();
          this.emitEvent('GAZE_AWAY', {
            direction: detectedGaze,
            irisX: parseFloat(avgIrisX.toFixed(3)),
            irisY: parseFloat(avgIrisY.toFixed(3))
          });
        }
      }
    } else {
      this.stateStartTimes.gazeAwaySince = null;
      if (this.currentState.gazeStatus !== 'GAZE_CENTER') {
        this.currentState.gazeStatus = 'GAZE_CENTER';
        this.notifyStateChange();
        this.emitEvent('GAZE_CENTER');
      }
    }
  }

  /**
   * 11. Lip Aperture Mouth Movement Telemetry
   */
  processMouthMovement(landmarks, now) {
    if (!landmarks || landmarks.length < 292) return;

    const upperLip = landmarks[13];
    const lowerLip = landmarks[14];
    const leftCorner = landmarks[61];
    const rightCorner = landmarks[291];

    const lipHeight = Math.hypot(upperLip.x - lowerLip.x, upperLip.y - lowerLip.y);
    const mouthWidth = Math.hypot(leftCorner.x - rightCorner.x, leftCorner.y - rightCorner.y);
    const mouthApertureRatio = lipHeight / (mouthWidth + 1e-6);

    const isMouthOpen = mouthApertureRatio > 0.26;

    if (isMouthOpen) {
      if (!this.stateStartTimes.mouthMovementSince) {
        this.stateStartTimes.mouthMovementSince = now;
      } else if (now - this.stateStartTimes.mouthMovementSince > this.options.mouthMovementDurationMs) {
        if (!this.currentState.mouthMoving) {
          this.currentState.mouthMoving = true;
          this.notifyStateChange();
          this.emitEvent('MOUTH_MOVEMENT_DETECTED', {
            mouthApertureRatio: parseFloat(mouthApertureRatio.toFixed(3)),
            correlatedVoice: Boolean(this.currentState.voiceActive)
          });
        }
      }
    } else {
      this.stateStartTimes.mouthMovementSince = null;
      if (this.currentState.mouthMoving) {
        this.currentState.mouthMoving = false;
        this.notifyStateChange();
      }
    }
  }

  /**
   * 12. Graceful Resource Cleanup
   */
  stopAll() {
    this.isMonitoring = false;
    this.isInferring = false;

    if (this.inferenceTimer) {
      clearInterval(this.inferenceTimer);
      this.inferenceTimer = null;
    }

    if (this.vadTimer) {
      clearInterval(this.vadTimer);
      this.vadTimer = null;
    }

    if (this.cameraStream) {
      try {
        this.cameraStream.getTracks().forEach((track) => track.stop());
      } catch (e) {}
      this.cameraStream = null;
    }

    if (this.micStream) {
      try {
        this.micStream.getTracks().forEach((track) => track.stop());
      } catch (e) {}
      this.micStream = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        this.audioContext.close();
      } catch (e) {}
      this.audioContext = null;
    }

    if (this.faceLandmarker) {
      try {
        this.faceLandmarker.close();
      } catch (e) {}
      this.faceLandmarker = null;
    }

    this.currentState.cameraStatus = 'DISCONNECTED';
    this.currentState.micStatus = 'DISCONNECTED';
    this.currentState.faceStatus = 'UNKNOWN';
    this.currentState.positionQuality = 'GOOD';
    this.currentState.gazeStatus = 'GAZE_CENTER';
    this.currentState.headStatus = 'HEAD_FORWARD';
    this.currentState.mouthMoving = false;
    this.currentState.voiceActive = false;
  }
}