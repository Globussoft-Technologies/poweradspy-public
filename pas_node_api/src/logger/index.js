'use strict';

const { AsyncLocalStorage } = require('async_hooks');
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const config = require('../config');

// ─── Request Context Store ───────────────────────────────
// Stores { requestId } for the lifetime of each async request chain.
// Zero disk usage — purely in-memory, freed when request ends.
const requestContext = new AsyncLocalStorage();

// ─── Custom Format ───────────────────────────────────────
// Inject requestId from async context into every log entry automatically.
const injectRequestId = winston.format((info) => {
  const ctx = requestContext.getStore();
  if (ctx && ctx.requestId && !info.requestId) {
    info.requestId = ctx.requestId;
  }
  return info;
});

const buildLogFormat = () => {
  const baseFormat = winston.format.combine(
    injectRequestId(),
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.errors({ stack: true })
  );

  if (config.isDev) {
    return winston.format.combine(
      baseFormat,
      winston.format.colorize(),
      winston.format.printf(({ timestamp, level, message, service, requestId, responseTime, statusCode, method, url, stack, ...meta }) => {
        let line = `${timestamp} ${level}`;
        if (service) line += ` [${service}]`;
        if (requestId) line += ` [${String(requestId).slice(0, 8)}]`;
        if (method && url) line += ` ${method} ${url}`;
        line += `: ${message}`;
        if (statusCode) line += ` → ${statusCode}`;
        if (responseTime) line += ` (${responseTime}ms)`;
        if (stack) line += `\n${stack}`;
        const extraKeys = Object.keys(meta).filter(k => k !== 'splat' && k !== 'env');
        if (extraKeys.length > 0) {
          const extras = {};
          extraKeys.forEach(k => { extras[k] = meta[k]; });
          line += ` ${JSON.stringify(extras)}`;
        }
        return line;
      })
    );
  }

  // Production: structured JSON for machine parsing
  return winston.format.combine(
    baseFormat,
    winston.format.json()
  );
};

// ─── Transports ─────────────────────────────────────────
const buildTransports = () => {
  const transports = [
    new winston.transports.Console({
      format: config.isDev
        ? winston.format.combine(
            injectRequestId(),
            winston.format.colorize(),
            winston.format.printf(({ timestamp, level, message, service, requestId, method, url, statusCode, responseTime, error }) => {
              let line = `${timestamp} ${level}`;
              if (service) line += ` [${service}]`;
              if (requestId) line += ` [${String(requestId).slice(0, 8)}]`;
              if (method && url) line += ` ${method} ${url}`;
              line += `: ${message}`;
              if (statusCode) line += ` \u2192 ${statusCode}`;
              if (responseTime) line += ` (${responseTime}ms)`;
              if (error && message !== error) line += ` - ${error}`;
              return line;
            })
          )
        : winston.format.json(),
    }),
  ];

  // File transports with daily rotation
  // const logDir = path.resolve(config.log.dir);
  const logDir = path.resolve(config.log?.dir || 'logs');

  transports.push(
    new DailyRotateFile({
      dirname: logDir,
      filename: 'error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: config.log.errorLogMaxSize || '20m',
      maxFiles: config.log.errorLogMaxDays || '30d',
      zippedArchive: config.log.zippedArchive !== false,
    })
  );

  transports.push(
    new DailyRotateFile({
      dirname: logDir,
      filename: 'combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: config.log.combinedLogMaxSize || '50m',
      maxFiles: config.log.combinedLogMaxDays || '14d',
      zippedArchive: config.log.zippedArchive !== false,
    })
  );

  return transports;
};

// ─── Create Main Logger ─────────────────────────────────
const logger = winston.createLogger({
  level: config.log.level,
  defaultMeta: { env: config.env },
  format: buildLogFormat(),
  transports: buildTransports(),
  exitOnError: false,
});

/**
 * Create a child logger for a specific service/network.
 */
logger.createChild = (serviceName, extraMeta = {}) => {
  return logger.child({ service: serviceName, ...extraMeta });
};

/**
 * Express request logging middleware.
 * Wraps each request in an AsyncLocalStorage context so ALL logs
 * from that request (in any service/route) automatically include the requestId.
 */
logger.requestMiddleware = () => {
  return (req, res, next) => {
    const start = Date.now();

    // Run the entire request inside the async context
    requestContext.run({ requestId: req.requestId }, () => {
      res.on('finish', () => {
        const responseTime = Date.now() - start;
        const logData = {
          method: req.method,
          url: req.originalUrl,
          statusCode: res.statusCode,
          responseTime,
          requestId: req.requestId,
          ip: req.ip,
          contentLength: res.get('Content-Length'),
          userAgent: req.get('User-Agent'),
        };

        if (res.statusCode >= 500) {
          logger.error(`${req.method} ${req.originalUrl} failed`, logData);
        } else if (res.statusCode >= 400) {
          logger.warn(`${req.method} ${req.originalUrl} client error`, logData);
        } else {
          logger.http(`${req.method} ${req.originalUrl} completed`, logData);
        }
      });

      next();
    });
  };
};

// Add 'http' as custom level if not present
if (!logger.levels.http) {
  logger.levels = {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    debug: 4,
  };
  winston.addColors({
    error: 'red',
    warn: 'yellow',
    info: 'green',
    http: 'cyan',
    debug: 'gray',
  });
}

module.exports = logger;
