/**
 * Distributed Lock Service (ExamSphere)
 * Implements redlock / distributed mutex patterns for critical operations:
 * - Prevents race conditions on exam final submission (double clicks, retries)
 * - Prevents duplicate AI evaluation job processing
 */

const crypto = require('crypto');
const redisManager = require('../config/redisClient');

class DistributedLockService {
  constructor() {
    this.defaultTtlMs = 15000; // 15 seconds
  }

  /**
   * Acquire a distributed lock for a resource
   * @param {string} resourceKey - e.g. "submit:studentId:examId"
   * @param {number} ttlMs - Lock expiry in milliseconds
   * @returns {Promise<{ success: boolean, lockId: string }>}
   */
  async acquire(resourceKey, ttlMs = this.defaultTtlMs) {
    const lockId = crypto.randomBytes(16).toString('hex');
    const client = redisManager.getClient();
    const fullKey = `lock:${resourceKey}`;

    try {
      if (typeof client.acquireLock === 'function') {
        // InMemory fallback store
        const acquired = await client.acquireLock(fullKey, lockId, ttlMs);
        return { success: Boolean(acquired), lockId: acquired ? lockId : null };
      } else {
        // Real Redis client (SET key value NX PX ttlMs)
        const result = await client.set(fullKey, lockId, 'PX', ttlMs, 'NX');
        const success = result === 'OK' || result === true;
        return { success, lockId: success ? lockId : null };
      }
    } catch (err) {
      console.warn('Distributed lock acquire warning:', err.message);
      // In case of lock service failure, allow proceed to prevent blocking legitimate students
      return { success: true, lockId };
    }
  }

  /**
   * Release a distributed lock safely using lockId verification
   * @param {string} resourceKey
   * @param {string} lockId
   * @returns {Promise<boolean>}
   */
  async release(resourceKey, lockId) {
    if (!lockId) return false;
    const client = redisManager.getClient();
    const fullKey = `lock:${resourceKey}`;

    try {
      if (typeof client.releaseLock === 'function') {
        return await client.releaseLock(fullKey, lockId);
      } else {
        // Lua script for atomic check-and-delete in Redis
        const luaScript = `
          if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("del", KEYS[1])
          else
            return 0
          end
        `;
        if (typeof client.eval === 'function') {
          const res = await client.eval(luaScript, 1, fullKey, lockId);
          return res === 1;
        } else {
          const current = await client.get(fullKey);
          if (current === lockId) {
            await client.del(fullKey);
            return true;
          }
        }
      }
    } catch (err) {
      console.warn('Distributed lock release warning:', err.message);
    }
    return false;
  }
}

module.exports = new DistributedLockService();
