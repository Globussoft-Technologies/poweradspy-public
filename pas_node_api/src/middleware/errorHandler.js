'use strict';

const logger = require('../logger');
const log = logger.createChild('error-handler');

/**
 * Structured application error — thrown from controllers/middleware.
 * statusCode flows through to globalErrorHandler → HTTP response.
 */
class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

/**
 * 404 Not Found middleware
 */
function notFoundHandler(req, res, next) {
  res.status(404).json({
    code: 404,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
}

/**
 * Global Error Handling middleware
 */
function globalErrorHandler(err, req, res, next) {
  // Log the error
  log.error('Unhandled Exception caught by Global Error Handler', {
    error: err.message,
    stack: err.stack,
    method: req.method,
    url: req.originalUrl,
    body: process.env.NODE_ENV === 'development' ? req.body : undefined,
  });

  // Default to 500 server error
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  res.status(statusCode).json({
    code: statusCode,
    message: process.env.NODE_ENV === 'development' ? message : 'An unexpected error occurred',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}

/**
 * Wrapper for async route handlers to catch promise rejections
 * and pass them to the global error handler.
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = {
  AppError,
  notFoundHandler,
  globalErrorHandler,
  asyncHandler,
};
