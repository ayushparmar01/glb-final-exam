/**
 * Enterprise Sliding Window Rate Limiter Middleware for ExamSphere
 * Supports Redis-backed sliding window and high-performance in-memory fallback
 * Endpoint-specific rate limiting prevents exam lockouts during 10,000+ student concurrency
 */

const redisManager = require('../config/redisClient');

class DistributedRateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 60 * 1000;
    this.max = options.max || 100;
    this.message = options.message || 'Too many requests, please try again later.';
    this.statusCode = options.statusCode || 429;
    this.keyPrefix = options.keyPrefix || 'rl:';
    this.inMemoryHits = new Map();

    // In-memory periodic cleanup
    setInterval(() => {
      const now = Date.now();
      for (const [k, records] of this.inMemoryHits.entries()) {
        const valid = records.filter(ts => now - ts < this.windowMs);
        if (valid.length === 0) {
          this.inMemoryHits.delete(k);
        } else {
          this.inMemoryHits.set(k, valid);
        }
      }
    }, 60000).unref();
  }

  middleware() {
    return async (req, res, next) => {
      // In test mode, bypass rate limiters to facilitate fast test suites
      if (process.env.NODE_ENV === 'test') {
        return next();
      }

      // Extract client identifier (User ID if authenticated, else IP address)
      const userId = req.user?.id || req.user?._id;
      const clientIp = (
        req.headers['x-forwarded-for'] ||
        req.headers['x-real-ip'] ||
        req.socket?.remoteAddress ||
        'unknown'
      ).split(',')[0].trim();

      const identifier = userId ? `user:${userId}` : `ip:${clientIp}`;
      const routeKey = `${this.keyPrefix}:${identifier}:${req.baseUrl || ''}${req.path || ''}`;
      const now = Date.now();

      const client = redisManager.getClient();

      try {
        if (redisManager.isUsingRedis() && typeof client.eval === 'function') {
          // Redis sliding window using sorted sets (ZADD & ZREMRANGEBYSCORE)
          const clearBefore = now - this.windowMs;
          const luaScript = `
            redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
            local current = redis.call('ZCARD', KEYS[1])
            if current < tonumber(ARGV[2]) then
              redis.call('ZADD', KEYS[1], ARGV[3], ARGV[3])
              redis.call('PEXPIRE', KEYS[1], ARGV[4])
              return 1
            else
              return 0
            end
          `;
          const allowed = await client.eval(luaScript, 1, routeKey, clearBefore, this.max, now, this.windowMs);
          if (allowed !== 1) {
            res.setHeader('Retry-After', Math.ceil(this.windowMs / 1000));
            return res.status(this.statusCode).json({
              success: false,
              message: this.message,
              retryAfterSeconds: Math.ceil(this.windowMs / 1000)
            });
          }
          return next();
        }
      } catch (err) {
        // Fall through to in-memory sliding window
      }

      // In-Memory Sliding Window Fallback
      const timestamps = this.inMemoryHits.get(routeKey) || [];
      const validTimestamps = timestamps.filter(ts => now - ts < this.windowMs);

      if (validTimestamps.length >= this.max) {
        const oldestTimestamp = validTimestamps[0];
        const retryAfterSeconds = Math.ceil((this.windowMs - (now - oldestTimestamp)) / 1000);
        res.setHeader('Retry-After', Math.max(1, retryAfterSeconds));
        return res.status(this.statusCode).json({
          success: false,
          message: this.message,
          retryAfterSeconds: Math.max(1, retryAfterSeconds)
        });
      }

      validTimestamps.push(now);
      this.inMemoryHits.set(routeKey, validTimestamps);
      next();
    };
  }
}

// 1. Auth Limiter: login, register, google auth (60 requests per 15 mins)
const authLimiter = new DistributedRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 60,
  keyPrefix: 'rl:auth',
  message: 'Too many authentication attempts. Please try again after a few minutes.'
}).middleware();

// 2. Exam Start Limiter: (120 requests per minute per user/IP)
const examStartLimiter = new DistributedRateLimiter({
  windowMs: 60 * 1000,
  max: 120,
  keyPrefix: 'rl:exam_start',
  message: 'Exam session initialization rate limit reached. Please wait a moment.'
}).middleware();

// 3. Answer Save / Autosave Limiter: High throughput (300 requests per minute per user)
const answerSaveLimiter = new DistributedRateLimiter({
  windowMs: 60 * 1000,
  max: 300,
  keyPrefix: 'rl:ans_save',
  message: 'Autosave requests too frequent. Progress is safely buffered locally.'
}).middleware();

// 4. Exam Final Submission Limiter: (20 requests per minute per user)
const examSubmitLimiter = new DistributedRateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  keyPrefix: 'rl:exam_submit',
  message: 'Submission request in progress. Please do not repeatedly submit.'
}).middleware();

// 5. Proctor Telemetry Event Limiter: (120 requests per minute per student)
const proctorTelemetryLimiter = new DistributedRateLimiter({
  windowMs: 60 * 1000,
  max: 120,
  keyPrefix: 'rl:proctor',
  message: 'Proctor telemetry stream rate limit reached.'
}).middleware();

// 6. Sensitive Admin Actions Limiter: (120 requests per minute)
const sensitiveAdminLimiter = new DistributedRateLimiter({
  windowMs: 60 * 1000,
  max: 120,
  keyPrefix: 'rl:admin',
  message: 'Admin action rate limit reached. Please slow down.'
}).middleware();

// 7. General API Limiter: Generous (1200 requests per minute)
const generalApiLimiter = new DistributedRateLimiter({
  windowMs: 60 * 1000,
  max: 1200,
  keyPrefix: 'rl:gen',
  message: 'System API rate limit reached. Please wait a few seconds.'
}).middleware();

module.exports = {
  authLimiter,
  examStartLimiter,
  answerSaveLimiter,
  examSubmitLimiter,
  proctorTelemetryLimiter,
  sensitiveAdminLimiter,
  generalApiLimiter
};
