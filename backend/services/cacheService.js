/**
 * Enterprise Cache Service for ExamSphere
 * Provides safe, high-speed read-through caching for Exam metadata and Question bundles
 * Strictly enforces that sensitive answers/rubrics/AI configurations are never leaked
 */

const redisManager = require('../config/redisClient');
const Question = require('../models/Question');
const Exam = require('../models/Exam');

class CacheService {
  constructor() {
    this.EXAM_TTL = 300; // 5 minutes
    this.QUESTIONS_TTL = 300; // 5 minutes
    this.PDF_TTL = 600; // 10 minutes
  }

  /**
   * Get sanitized questions for student exam taking (Cached)
   * Guaranteed ZERO leakage of correctAnswer, expectedAnswer, rubric, keywords, or evaluationConfig
   */
  async getSanitizedQuestions(examId) {
    const client = redisManager.getClient();
    const cacheKey = `cache:exam:${examId}:sanitized_questions`;

    try {
      const cached = await client.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (e) {
      // Ignore cache error, proceed to DB
    }

    // Fetch from MongoDB with strict negative projection
    const questions = await Question.find({ examId })
      .sort({ createdAt: 1 })
      .select('-correctAnswer -correctAnswers -explanation -expectedAnswer -keywords -keyConcepts -rubric -evaluationConfig')
      .lean();

    if (questions && questions.length > 0) {
      try {
        await client.set(cacheKey, JSON.stringify(questions), 'EX', this.QUESTIONS_TTL);
      } catch (e) {}
    }

    return questions;
  }

  /**
   * Get exam metadata (Cached)
   */
  async getExamMetadata(examId) {
    const client = redisManager.getClient();
    const cacheKey = `cache:exam:${examId}:meta`;

    try {
      const cached = await client.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (e) {}

    const exam = await Exam.findById(examId).lean();
    if (exam) {
      try {
        await client.set(cacheKey, JSON.stringify(exam), 'EX', this.EXAM_TTL);
      } catch (e) {}
    }
    return exam;
  }

  /**
   * Invalidate all cache entries for an exam when modified by Teacher or Admin
   */
  async invalidateExamCache(examId) {
    const client = redisManager.getClient();
    try {
      await client.del([
        `cache:exam:${examId}:sanitized_questions`,
        `cache:exam:${examId}:meta`
      ]);
    } catch (e) {
      console.warn('Cache invalidation notice:', e.message);
    }
  }

  /**
   * Cache rendered PDF report buffer
   */
  async getPdfBuffer(resultId) {
    const client = redisManager.getClient();
    const cacheKey = `cache:pdf:${resultId}`;
    try {
      const b64 = await client.get(cacheKey);
      if (b64) {
        return Buffer.from(b64, 'base64');
      }
    } catch (e) {}
    return null;
  }

  async setPdfBuffer(resultId, pdfBuffer) {
    if (!pdfBuffer) return;
    const client = redisManager.getClient();
    const cacheKey = `cache:pdf:${resultId}`;
    try {
      const b64 = pdfBuffer.toString('base64');
      await client.set(cacheKey, b64, 'EX', this.PDF_TTL);
    } catch (e) {}
  }

  async invalidatePdfCache(resultId) {
    const client = redisManager.getClient();
    try {
      await client.del(`cache:pdf:${resultId}`);
    } catch (e) {}
  }
}

module.exports = new CacheService();
