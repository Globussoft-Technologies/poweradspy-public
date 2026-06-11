'use strict';

const cluster = require('cluster');
const os = require('os');
const config = require('./config');

// ═══════════════════════════════════════════════════════════
// CLUSTER MANAGER
// Entry point for the application.
// Master process forks workers and manages their lifecycle.
// Each worker runs a full Express server instance.
// ═══════════════════════════════════════════════════════════

const numWorkers = config.cluster.workers || os.cpus().length;

if (cluster.isPrimary && config.cluster.enabled) {
  // ─── MASTER PROCESS ───────────────────────────────────
  const logger = require('./logger');
  const log = logger.createChild('master');

  log.info('═══════════════════════════════════════════════════');
  log.info('   PAS-NODE-TRANSFER — API Gateway Starting');
  log.info('═══════════════════════════════════════════════════');
  log.info(`Master PID: ${process.pid}`);
  log.info(`Environment: ${config.env}`);
  log.info(`CPU Cores: ${os.cpus().length}`);
  log.info(`Spawning ${numWorkers} workers...`);
  log.info('═══════════════════════════════════════════════════');

  // Track worker restart counts for back-off
  const workerRestarts = new Map();
  const MAX_RESTARTS = config.cluster.maxRestarts;
  const RESTART_WINDOW = config.cluster.restartWindowMs;

  // Fork workers
  for (let i = 0; i < numWorkers; i++) {
    const worker = cluster.fork({ WORKER_ID: i + 1 });
    log.info(`Worker ${worker.id} spawned (PID: ${worker.process.pid})`);
  }

  // Handle worker exit
  cluster.on('exit', (worker, code, signal) => {
    const workerId = worker.id;
    log.warn(`Worker ${workerId} (PID: ${worker.process.pid}) exited`, {
      code,
      signal,
      killed: worker.exitedAfterDisconnect,
    });

    // Don't restart if it was a graceful shutdown
    if (worker.exitedAfterDisconnect) return;

    // Rate-limit restarts
    const now = Date.now();
    const restarts = workerRestarts.get(workerId) || [];

    // Remove old restart records
    const recentRestarts = restarts.filter(t => now - t < RESTART_WINDOW);
    recentRestarts.push(now);
    workerRestarts.set(workerId, recentRestarts);

    if (recentRestarts.length >= MAX_RESTARTS) {
      log.error(`Worker ${workerId} has restarted ${MAX_RESTARTS} times in ${RESTART_WINDOW / 1000}s. NOT restarting.`);
      return;
    }

    // Restart with back-off delay
    const delay = Math.min(recentRestarts.length * 1000, config.cluster.maxRestartDelayMs);
    log.info(`Restarting worker ${workerId} in ${delay}ms (restart #${recentRestarts.length})`);

    setTimeout(() => {
      const newWorker = cluster.fork({ WORKER_ID: workerId });
      log.info(`Worker ${workerId} restarted (new PID: ${newWorker.process.pid})`);
    }, delay);
  });

  // Graceful shutdown
  const shutdown = (signal) => {
    log.info(`Master received ${signal}. Gracefully shutting down...`);

    for (const id in cluster.workers) {
      cluster.workers[id].disconnect();
    }

    // Force kill after timeout
    setTimeout(() => {
      log.error('Forcefully shutting down after timeout');
      process.exit(1);
    }, config.cluster.gracefulShutdownTimeoutMs);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

} else {
  // ─── WORKER PROCESS ───────────────────────────────────
  const createApp = require('./app');
  const logger = require('./logger');
  // const cacheStore = require('./cache/CacheStore');
  const databaseManager = require('./database/DatabaseManager');

  const workerId = process.env.WORKER_ID || 'single';
  const log = logger.createChild(`worker-${workerId}`);

  // createApp is async (database connections)
  (async () => {
    try {
      const app = await createApp();

      const server = app.listen(config.port, config.host, () => {
        log.info(`Worker ${workerId} listening on ${config.host}:${config.port} (PID: ${process.pid})`);
      });

      // Configure server timeouts for high throughput (all values from config.json)
      server.keepAliveTimeout = config.serverTimeouts.keepAliveTimeoutMs;
      server.headersTimeout = config.serverTimeouts.headersTimeoutMs;
      server.maxHeadersCount = config.serverTimeouts.maxHeadersCount;
      server.timeout = config.serverTimeouts.requestTimeoutMs;

      // Graceful worker shutdown
      const gracefulShutdown = async (signal) => {
        log.debug(`Worker ${workerId} received ${signal}. Closing connections...`);

        server.close(async () => {
          log.debug(`Worker ${workerId} HTTP server closed`);

          // Disconnect cache (Redis + SQLite)
          // await cacheStore.disconnect();

          // Disconnect all databases
          await databaseManager.disconnectAll();

          log.debug(`Worker ${workerId} cleanup complete. Exiting.`);
          process.exit(0);
        });

        // Force exit if graceful shutdown takes too long
        setTimeout(() => {
          log.error(`Worker ${workerId} forced exit after timeout`);
          process.exit(1);
        }, config.serverTimeouts.workerGracefulShutdownMs);
      };

      process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
      process.on('SIGINT', () => gracefulShutdown('SIGINT'));

      // Catch unhandled errors (prevent worker crash)
      process.on('uncaughtException', (err) => {
        log.error('Uncaught Exception', { error: err.message, stack: err.stack });
        gracefulShutdown('uncaughtException');
      });

      process.on('unhandledRejection', (reason) => {
        log.error('Unhandled Rejection', { reason: reason?.message || reason, stack: reason?.stack });
      });

    } catch (err) {
      log.error(`Worker ${workerId} failed to start`, { error: err.message, stack: err.stack });
      process.exit(1);
    }
  })();
}
