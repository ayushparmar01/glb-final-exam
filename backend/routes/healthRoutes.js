/**
 * Production Health & Observability Endpoints (ExamSphere)
 * /health -> Liveness probe
 * /ready  -> Readiness probe (Verifies MongoDB, Redis, and Queue health)
 * /metrics -> Real-time telemetry & performance metrics
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const redisManager = require('../config/redisClient');
const evaluationQueue = require('../queues/evaluationQueue');

// Liveness probe (Returns instant 200 OK if Node event loop is responsive)
router.get('/health', (req, res) => {
  const mem = process.memoryUsage();
  res.status(200).json({
    status: 'UP',
    uptimeSeconds: Math.floor(process.uptime()),
    pid: process.pid,
    memory: {
      rssMb: Math.round(mem.rss / 1024 / 1024),
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024)
    },
    timestamp: new Date().toISOString()
  });
});

// Readiness probe (Verifies Database and Core Subsystems)
router.get('/ready', async (req, res) => {
  const isDbConnected = mongoose.connection.readyState === 1;
  const isRedisOk = await redisManager.ping();
  const queueMetrics = evaluationQueue.getMetrics();

  const isReady = isDbConnected;
  const statusCode = isReady ? 200 : 503;

  res.status(statusCode).json({
    status: isReady ? 'READY' : 'NOT_READY',
    checks: {
      database: isDbConnected ? 'CONNECTED' : (mongoose.connection.readyState === 2 ? 'CONNECTING' : 'DISCONNECTED'),
      redis: isRedisOk ? (redisManager.isUsingRedis() ? 'CONNECTED_CLUSTER' : 'IN_MEMORY_FALLBACK') : 'DEGRADED',
      evaluationQueue: queueMetrics.circuitState === 'OPEN' ? 'CIRCUIT_OPEN_FALLBACK' : 'HEALTHY'
    },
    queue: {
      pendingJobs: queueMetrics.queueLength,
      activeWorkers: queueMetrics.activeWorkers
    },
    timestamp: new Date().toISOString()
  });
});

// Telemetry & Metrics endpoint (Safe for Prometheus / monitoring dashboards)
router.get('/metrics', async (req, res) => {
  const mem = process.memoryUsage();
  const queueMetrics = evaluationQueue.getMetrics();

  let activeAttemptsCount = 0;
  let totalResultsCount = 0;
  try {
    const ExamAttempt = require('../models/ExamAttempt');
    const Result = require('../models/Result');
    activeAttemptsCount = await ExamAttempt.countDocuments({ status: 'IN_PROGRESS' }).catch(() => 0);
    totalResultsCount = await Result.estimatedDocumentCount().catch(() => 0);
  } catch (e) {}

  res.status(200).json({
    process: {
      uptimeSeconds: Math.floor(process.uptime()),
      pid: process.pid,
      nodeVersion: process.version,
      memoryRssMb: Math.round(mem.rss / 1024 / 1024),
      memoryHeapUsedMb: Math.round(mem.heapUsed / 1024 / 1024)
    },
    system: {
      activeAttempts: activeAttemptsCount,
      totalResults: totalResultsCount,
      isRedisActive: redisManager.isUsingRedis()
    },
    evaluationQueue: queueMetrics,
    database: {
      readyState: mongoose.connection.readyState,
      host: mongoose.connection.host || 'local'
    },
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
