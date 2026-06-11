'use strict';

const helmet = require('helmet');
const cors = require('cors');
const config = require('../config');

function helmetMiddleware() {
  return helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,  // allow cross-origin fetches (React frontend on different origin)
    crossOriginOpenerPolicy: false,
  });
}

function corsMiddleware() {
  const origin = config.cors.origin;
  return cors({
    // '*' with credentials:true is invalid in browsers — reflect the request origin instead
    origin: origin === '*' ? true : origin,
    methods: config.cors.methods,
    allowedHeaders: [...(config.cors.allowedHeaders || []), 'Cookie', 'If-None-Match', 'X-Sdui-Client-Version'],
    exposedHeaders: ['ETag'],
    credentials: true,
  });
}

module.exports = {
  helmetMiddleware,
  corsMiddleware,
};
