'use strict';

const path = require('path');
const yaml = require('js-yaml');
const fs = require('fs');
const swaggerUi = require('swagger-ui-express');
const config = require('../config');

// Load swagger.yml from project root
const swaggerDoc = yaml.load(
  fs.readFileSync(path.resolve(process.cwd(), 'swagger.yml'), 'utf8')
);

/**
 * Basic-auth middleware — protects /api-docs with admin credentials from config.json.
 * Browser will show a native login prompt.
 */
function docsAuthMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';

  if (authHeader.startsWith('Basic ')) {
    const base64 = authHeader.slice('Basic '.length);
    const decoded = Buffer.from(base64, 'base64').toString('utf8');
    const [user, pass] = decoded.split(':');

    if (user === config.admin.username && pass === config.admin.password) {
      return next();
    }
  }

  // Trigger browser login prompt
  res.setHeader('WWW-Authenticate', 'Basic realm="API Docs"');
  return res.status(401).send('Unauthorized: Valid admin credentials required to view API docs.');
}

/**
 * Swagger UI options
 */
const swaggerOptions = {
  customSiteTitle: 'PAS API Docs',
  customCss: `
    .topbar { background-color: #1e293b !important; }
    .topbar-wrapper img { display: none; }
    .topbar-wrapper::after {
      content: 'PAS Node API v1';
      color: #e2e8f0;
      font-size: 18px;
      font-weight: 600;
      margin-left: 16px;
    }
    .swagger-ui .info .title { color: #6366f1; }
  `,
  swaggerOptions: {
    persistAuthorization: true,  // keeps Bearer token across page refreshes
    docExpansion: 'list',        // show tag list collapsed by default
    filter: true,                // enable search/filter bar
    tryItOutEnabled: true,       // enable Try it out by default
  },
};

module.exports = function mountSwagger(app) {
  app.use(
    '/api-docs',
    docsAuthMiddleware,
    swaggerUi.serve,
    swaggerUi.setup(swaggerDoc, swaggerOptions)
  );
};
