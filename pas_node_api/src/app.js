'use strict';

const express = require('express');
const cookieParser = require('cookie-parser');
const config = require('./config');
const logger = require('./logger');
// const cacheStore = require('./cache/CacheStore');
const databaseManager = require('./database/DatabaseManager');
const networksConfig = require('./config/networks');
const serviceRegistry = require('./services/ServiceRegistry');
const HealthCheck = require('./health/HealthCheck');
const metricsDB = require('./metrics/MetricsDB');

// Middleware
const requestIdMiddleware = require('./middleware/requestId');
const { helmetMiddleware, corsMiddleware } = require('./middleware/security');
const compressionMiddleware = require('./middleware/compression');
const { globalLimiter, ipBlocklistMiddleware } = require('./middleware/rateLimiter');
const metricsMiddleware = require('./middleware/metricsMiddleware');
const { notFoundHandler, globalErrorHandler } = require('./middleware/errorHandler');
const { generateToken } = require('./middleware/auth');

// Admin
const adminRoutes = require('./admin/adminRoutes');

// Auth
const authRoutes = require('./auth/authRoutes');
const amemberAuth = require('./auth/amemberAuth');

// API Docs (Swagger UI — secured with admin credentials)
const mountSwagger = require('./docs/swaggerRoute');

// SDUI Service (ported from Go SDUI-Backend)
const { createSduiRouter } = require('./services/sdui/routes');

const log = logger.createChild('app');

async function createApp() {
  await metricsDB.init();

  const app = express();

  app.set('trust proxy', config.trustProxy || 1);

  app.use(requestIdMiddleware());

  // 2. Cookie parser (must be before authMiddleware reads req.cookies)
  app.use(cookieParser());

  // 3. Security headers
  app.use(helmetMiddleware());

  // 3. CORS
  app.use(corsMiddleware());

  // 4. Compression
  app.use(compressionMiddleware());

  // 5. Body parsing with size limits
  // `verify` stashes the raw request buffer so the insertion-auth middleware can
  // HMAC-verify the exact bytes (mirrors PHP php://input). Additive, non-breaking.
  app.use(express.json({
    limit: config.bodyLimit,
    verify: (req, _res, buf) => { req.rawBody = buf; },
  }));
  app.use(express.urlencoded({ extended: true, limit: config.bodyLimit }));

  // 6. IP Blocklist check (before rate limiter)
  app.use(ipBlocklistMiddleware);

  // 7. Rate limiting (100 req/min per IP from config.json)
  app.use(globalLimiter);

  // 8. Metrics collection
  app.use(metricsMiddleware());

  // 9. Request logging
  app.use(logger.requestMiddleware());

  // 10. Admin dashboard (must be before DB-dependent routes)
  if (config.admin.enabled !== false) {
    app.use('/admin', adminRoutes);
  }

  await databaseManager.connectAll(networksConfig);

  serviceRegistry.loadAll();


  serviceRegistry.injectDatabases();
  HealthCheck.register(app);

  // Register all network service routes under /api/v1/{network}/*
  serviceRegistry.registerRoutes(app);

  // Auth (login / logout / me / refresh)
  app.use('/api/v1/auth', authRoutes);

  // aMember login redirect (GET /loginpage/:encodedUsername)
  app.use('/', amemberAuth);

  // Common cross-network API
  app.use('/api/v1/common', require('./services/common/routes/commonRoutes'));

  // Email service — unsubscribe / resubscribe (public; aMember + SendGrid global suppression)
  app.use('/api/v1/email', require('./services/email/routes/emailRoutes'));


  // SDUI Service (ported from Go SDUI-Backend — kept on /api, no versioning yet)
  app.use('/api', createSduiRouter());

  // API Docs — secured Swagger UI at /api-docs
  mountSwagger(app);

  // Dev-only: Token generation + local session login (mirrors PHP localSessionLogin)
  if (config.isDev) {
    app.post('/dev/token', (req, res) => {
      const payload = req.body || { id: 'dev_user', role: 'admin' };
      const token = generateToken(payload);
      res.json({
        success: true,
        data: { token, expiresIn: config.jwt.expiresIn },
        meta: { warning: 'This endpoint is only available in development mode' },
      });
    });

    // GET /dev/local-login — mirrors PHP localSessionLogin with hardcoded user
    app.get('/dev/local-login', (req, res) => {
      const payload = {
        id: 281, user_id: 281,
        email: 'aishwarya@globussoft.in',
        name: 'Tadeu Porto', login: 'tadeuonbrand',
        userSubscriptionType: 36,
        subscriptions: { 4: '2029-12-22' },
        expiry_date: '2029-12-22',
        platformAccess: {
          Facebook: 1, Instagram: 1, YouTube: 1, Google: 1,
          GDN: 1, Native: 1, Reddit: 1, Quora: 1, Pinterest: 1, tiktok: 1,
        },
        user_country: 'India',
        role: 'user',
      };
      const token = generateToken(payload);
      res.cookie('authToken', token, { httpOnly: true, maxAge: 86400000, path: '/' });
      const frontendUrl = config.amember?.frontendUrl || 'http://localhost:5173';
      res.redirect(`${frontendUrl}?token=${token}`);
    });
  }


  // Dev-only: SSE test page
  if (config.isDev) {
    app.get('/sse-test', (req, res) => {
      res.sendFile(require('path').join(__dirname, '..', 'sse-test.html'));
    });
  }

  app.use(notFoundHandler);


  app.use(globalErrorHandler);

  log.info('Express app configured', {
    middleware: ['requestId', 'helmet', 'cors', 'compression', 'bodyParser', 'ipBlocklist', 'rateLimiter', 'metrics', 'requestLogger'],
    services: serviceRegistry.size,
    // cacheBackend: cacheStore.backend,
    environment: config.env,
    adminPanel: config.admin.enabled !== false ? '/admin' : 'disabled',
  });

  // Initialize push notification cron jobs (only on one worker to avoid duplicate jobs).
  // These crons (push + daily mail + keyword status) ARE the notification mechanism —
  // they poll and send directly in-process, so no separate notificationService is needed.
  if ((!process.env.WORKER_ID || process.env.WORKER_ID === '1') && config.notifications?.enabled !== false) {
    try {
      const {
        initPushNotificationCron,
        initDailyMailUpdateCron,
        initDailyResetCron,
        initUpdateKeywordStatusCron
      } = require('./jobs/pushNotificationCron');

      initPushNotificationCron();
      initDailyMailUpdateCron();
      initDailyResetCron();
      initUpdateKeywordStatusCron();

      log.info('✓ Push notification cron jobs initialized');
    } catch (error) {
      log.error('Failed to initialize push notification crons', { error: error.message });
    }
  }

  return app;
}

module.exports = createApp;
