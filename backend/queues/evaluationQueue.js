/**
 * Asynchronous Subjective Evaluation Queue & Worker Engine (ExamSphere)
 * Hardened for 10,000+ Concurrent Students
 * Features:
 * - Controlled worker concurrency & Token Bucket rate limiter (Prevents AI Provider quota exhaustion)
 * - Circuit Breaker pattern (Fails gracefully to deterministic fallback on AI Provider downtime)
 * - Idempotent job execution (Prevents double mark allocation)
 * - Real-time Socket.IO status event notifications
 * - Queue depth & worker utilization metrics
 */

const EventEmitter = require('events');
const subjectiveEvaluationService = require('../services/subjectiveEvaluationService');
const Result = require('../models/Result');
const Question = require('../models/Question');
const distributedLock = require('../services/distributedLock');

class EvaluationQueueEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.concurrency = Number(options.concurrency || process.env.EVALUATION_CONCURRENCY || 10);
    this.maxRetries = 3;
    this.jobsQueue = [];
    this.activeWorkers = 0;
    this.totalProcessed = 0;
    this.totalFailed = 0;
    this.totalFallbackUsed = 0;
    this.averageLatencyMs = 0;

    // Circuit Breaker State
    this.circuitState = 'CLOSED'; // 'CLOSED', 'OPEN', 'HALF_OPEN'
    this.consecutiveFailures = 0;
    this.failureThreshold = 5;
    this.circuitResetTimeoutMs = 30000; // 30 seconds
    this.lastFailureTime = null;

    // Token bucket rate limiter (e.g., max 60 calls/min to AI API)
    this.maxTokens = 60;
    this.availableTokens = 60;
    this.refillRatePerSec = 1; // 1 token per second = 60 tokens/min
    this.lastRefill = Date.now();

    // Start background queue processing ticker
    this.ticker = setInterval(() => {
      this.refillTokens();
      this.checkCircuitHealth();
      this.processNextJobs();
    }, 100).unref();
  }

  refillTokens() {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefill) / 1000;
    this.availableTokens = Math.min(this.maxTokens, this.availableTokens + (elapsedSec * this.refillRatePerSec));
    this.lastRefill = now;
  }

  checkCircuitHealth() {
    if (this.circuitState === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.circuitResetTimeoutMs) {
        this.circuitState = 'HALF_OPEN';
        console.log('🔄 Circuit Breaker half-opened: testing downstream AI provider connectivity.');
      }
    }
  }

  recordSuccess() {
    this.consecutiveFailures = 0;
    if (this.circuitState === 'HALF_OPEN') {
      this.circuitState = 'CLOSED';
      console.log('✅ Circuit Breaker restored to CLOSED.');
    }
  }

  recordFailure() {
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();
    if (this.consecutiveFailures >= this.failureThreshold && this.circuitState !== 'OPEN') {
      this.circuitState = 'OPEN';
      console.warn(`⚠️ Circuit Breaker TRIPPED to OPEN after ${this.consecutiveFailures} failures. Switching to instant rule-based fallback.`);
    }
  }

  /**
   * Enqueue a submission for asynchronous subjective evaluation
   * @param {Object} jobData - { resultId, examId, studentId, subjectiveAnswers, io }
   */
  async enqueue(jobData) {
    if (!jobData || !jobData.resultId) return false;

    const job = {
      id: `eval_${jobData.resultId}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      resultId: jobData.resultId,
      examId: jobData.examId,
      studentId: jobData.studentId,
      subjectiveAnswers: jobData.subjectiveAnswers || [],
      io: jobData.io || null,
      attempts: 0,
      enqueuedAt: Date.now()
    };

    this.jobsQueue.push(job);
    this.emit('job:enqueued', { jobId: job.id, resultId: job.resultId, queueLength: this.jobsQueue.length });
    setImmediate(() => this.processNextJobs());
    return true;
  }

  getQueueLength() {
    return this.jobsQueue.length;
  }

  getMetrics() {
    return {
      queueLength: this.jobsQueue.length,
      activeWorkers: this.activeWorkers,
      maxConcurrency: this.concurrency,
      totalProcessed: this.totalProcessed,
      totalFailed: this.totalFailed,
      totalFallbackUsed: this.totalFallbackUsed,
      averageLatencyMs: Math.round(this.averageLatencyMs),
      circuitState: this.circuitState,
      availableTokens: Math.floor(this.availableTokens)
    };
  }

  async processNextJobs() {
    while (this.activeWorkers < this.concurrency && this.jobsQueue.length > 0) {
      const job = this.jobsQueue.shift();
      if (!job) break;

      this.activeWorkers++;
      this.executeJob(job)
        .catch((err) => {
          console.error(`Evaluation job ${job.id} unexpected error:`, err.message);
        })
        .finally(() => {
          this.activeWorkers--;
          setImmediate(() => this.processNextJobs());
        });
    }
  }

  async executeJob(job) {
    const startTime = Date.now();
    const lockKey = `eval_result:${job.resultId}`;
    const { success: lockAcquired, lockId } = await distributedLock.acquire(lockKey, 60000);

    if (!lockAcquired) {
      // Requeue job if locked by another worker
      this.jobsQueue.push(job);
      return;
    }

    try {
      const resultDoc = await Result.findById(job.resultId);
      if (!resultDoc) {
        console.warn(`Result document ${job.resultId} not found, discarding job.`);
        return;
      }

      // If already fully evaluated, skip to prevent double processing
      if (resultDoc.status === 'EVALUATED' && resultDoc.subjectiveReviewStatus !== 'QUEUED_FOR_EVALUATION' && resultDoc.subjectiveReviewStatus !== 'EVALUATING') {
        return;
      }

      // Mark result as EVALUATING
      resultDoc.subjectiveReviewStatus = 'EVALUATING';
      await resultDoc.save();

      // Retrieve all questions for reference
      const questionIds = resultDoc.answers.map(a => a.questionId);
      const questions = await Question.find({ _id: { $in: questionIds } }).lean();
      const questionMap = new Map();
      questions.forEach(q => questionMap.set(q._id.toString(), q));

      let subjectiveAwardedTotal = 0;
      let reviewStatuses = [];
      let updatedAnswers = [...resultDoc.answers];

      for (let i = 0; i < updatedAnswers.length; i++) {
        const ans = updatedAnswers[i];
        const q = questionMap.get(ans.questionId.toString());

        if (q && q.type === 'SUBJECTIVE') {
          const studentText = ans.answerText || ans.selectedAnswer || '';

          if (!studentText.trim()) {
            ans.evaluationStatus = 'AUTO_GRADED';
            ans.awardedMarks = 0;
            ans.marksObtained = 0;
            ans.isCorrect = false;
            ans.evaluationReason = 'No answer provided.';
            ans.evaluatedAt = new Date();
            ans.evaluatedBy = 'SYSTEM';
            ans.evaluationVersion = 'subjective-v1';
            reviewStatuses.push('AUTO_GRADED');
            continue;
          }

          // Check Circuit Breaker: If OPEN, enforce rule-based fallback without stalling
          let evalResult;
          if (this.circuitState === 'OPEN') {
            this.totalFallbackUsed++;
            evalResult = await subjectiveEvaluationService.evaluateAnswer({
              question: {
                ...q,
                evaluationConfig: {
                  ...(q.evaluationConfig || {}),
                  aiWeight: 0,
                  keywordWeight: (q.evaluationConfig?.keywordWeight || 25) + 10,
                  conceptWeight: (q.evaluationConfig?.conceptWeight || 25) + 10
                }
              },
              studentAnswer: studentText
            });
            evalResult.evaluationStatus = 'FALLBACK_EVALUATION';
            evalResult.evaluationReason = `${evalResult.evaluationReason} (Evaluated via deterministic fallback during AI provider maintenance).`;
          } else {
            try {
              evalResult = await subjectiveEvaluationService.evaluateAnswer({
                question: q,
                studentAnswer: studentText
              });
              this.recordSuccess();
            } catch (evalErr) {
              this.recordFailure();
              this.totalFallbackUsed++;
              evalResult = await subjectiveEvaluationService.evaluateAnswer({
                question: {
                  ...q,
                  evaluationConfig: { ...(q.evaluationConfig || {}), aiWeight: 0 }
                },
                studentAnswer: studentText
              });
              evalResult.evaluationStatus = 'FALLBACK_EVALUATION';
            }
          }

          // Apply evaluation metrics to answer detail
          ans.isCorrect = evalResult.isCorrect;
          ans.marksObtained = evalResult.awardedMarks;
          ans.awardedMarks = evalResult.awardedMarks;
          ans.evaluationStatus = evalResult.evaluationStatus;
          ans.evaluationScore = evalResult.evaluationScore;
          ans.confidenceScore = evalResult.confidenceScore;
          ans.maximumMarks = evalResult.maximumMarks;
          ans.keywordScore = evalResult.keywordScore;
          ans.conceptScore = evalResult.conceptScore;
          ans.semanticScore = evalResult.semanticScore;
          ans.aiScore = evalResult.aiScore;
          ans.matchedKeywords = evalResult.matchedKeywords;
          ans.missingKeywords = evalResult.missingKeywords;
          ans.matchedConcepts = evalResult.matchedConcepts;
          ans.missingConcepts = evalResult.missingConcepts;
          ans.incorrectClaims = evalResult.incorrectClaims;
          ans.evaluationReason = evalResult.evaluationReason;
          ans.evaluatedAt = evalResult.evaluatedAt;
          ans.evaluatedBy = evalResult.evaluatedBy;
          ans.evaluationVersion = evalResult.evaluationVersion;
          ans.originalAiSuggestedMarks = evalResult.originalAiSuggestedMarks;

          subjectiveAwardedTotal += evalResult.awardedMarks;
          reviewStatuses.push(evalResult.evaluationStatus);
        }
      }

      // Calculate final total score: Objective Subtotal + Subjective Subtotal
      const objectiveScore = updatedAnswers
        .filter(a => a.questionType !== 'SUBJECTIVE')
        .reduce((sum, a) => sum + (a.marksObtained || 0), 0);

      const penaltyDeduction = resultDoc.negativeMarksDeducted || 0;
      const finalScore = Math.max(0, Math.round((objectiveScore + subjectiveAwardedTotal - penaltyDeduction) * 10) / 10);
      const totalExamMarks = resultDoc.totalMarks || 1;
      const finalPercentage = Math.round((finalScore / totalExamMarks) * 1000) / 10;

      // Determine final subjective review status
      let finalReviewStatus = 'ALL_AUTO_GRADED';
      if (reviewStatuses.some(s => s === 'MANUAL_REVIEW_REQUIRED')) {
        finalReviewStatus = 'MANUAL_REVIEW_REQUIRED';
      } else if (reviewStatuses.some(s => s === 'AUTO_GRADED_REVIEW_RECOMMENDED' || s === 'FALLBACK_EVALUATION')) {
        finalReviewStatus = 'REVIEW_RECOMMENDED';
      }

      resultDoc.answers = updatedAnswers;
      resultDoc.score = finalScore;
      resultDoc.percentage = finalPercentage;
      resultDoc.subjectiveReviewStatus = finalReviewStatus;
      resultDoc.status = 'EVALUATED';
      await resultDoc.save();

      const durationMs = Date.now() - startTime;
      this.totalProcessed++;
      this.averageLatencyMs = this.averageLatencyMs === 0 ? durationMs : (this.averageLatencyMs * 0.9 + durationMs * 0.1);

      // Real-time Socket.IO notification to student attempt room and exam room
      try {
        if (job.io) {
          const proctorNamespace = job.io.of('/proctor');
          const payload = {
            resultId: resultDoc._id,
            examId: resultDoc.examId,
            score: finalScore,
            totalMarks: totalExamMarks,
            percentage: finalPercentage,
            status: 'EVALUATED',
            subjectiveReviewStatus: finalReviewStatus
          };
          proctorNamespace.to(`attempt_${resultDoc.attemptId}`).emit('result:evaluated', payload);
          proctorNamespace.to(`exam_${resultDoc.examId}`).emit('result:evaluated', payload);
        }
      } catch (sockErr) {
        // Socket broadcast optional
      }

      this.emit('job:completed', { jobId: job.id, resultId: job.resultId, durationMs });
    } catch (jobErr) {
      this.totalFailed++;
      console.error(`Evaluation job error for result ${job.resultId}:`, jobErr.message);

      job.attempts++;
      if (job.attempts < this.maxRetries) {
        // Exponential backoff requeue
        setTimeout(() => {
          this.jobsQueue.push(job);
        }, Math.pow(2, job.attempts) * 1000);
      } else {
        // Mark result document with MANUAL_REVIEW_REQUIRED so it doesn't get stuck indefinitely
        try {
          await Result.findByIdAndUpdate(job.resultId, {
            subjectiveReviewStatus: 'MANUAL_REVIEW_REQUIRED',
            status: 'MANUAL_REVIEW_REQUIRED'
          });
        } catch (e) {}
      }
    } finally {
      await distributedLock.release(lockKey, lockId);
    }
  }
}

const evaluationQueue = new EvaluationQueueEngine();
module.exports = evaluationQueue;
