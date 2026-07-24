import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const expressPath = require.resolve('express');
function FakeRouter() {
  const router = {
    routes: {},
    post: vi.fn((path, ...handlers) => { router.routes[path] = handlers; }),
  };
  return router;
}
require.cache[expressPath] = {
  id: expressPath, filename: expressPath, loaded: true, exports: { Router: FakeRouter },
};

const errorPath = require.resolve('../../../../src/middleware/errorHandler');
require.cache[errorPath] = {
  id: errorPath, filename: errorPath, loaded: true,
  exports: { asyncHandler: (handler) => handler },
};
const authPath = require.resolve('../../../../src/middleware/insertionAuth');
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: { insertionAuth: (_req, _res, next) => next() },
};
const enabledPath = require.resolve('../../../../src/middleware/insertionEnabled');
require.cache[enabledPath] = {
  id: enabledPath, filename: enabledPath, loaded: true,
  exports: { insertionEnabled: () => (_req, _res, next) => next() },
};
const controllerPath = require.resolve('../../../../src/services/google/controllers/googleTransparencyAdsController');
const googleTransparencyAds = vi.fn(async () => ({ code: 200, status: 'ok' }));
require.cache[controllerPath] = {
  id: controllerPath, filename: controllerPath, loaded: true,
  exports: { googleTransparencyAds },
};

const createRoutes = require('../../../../src/services/google/routes/google18TransparencyInsertionRoutes');
const router = createRoutes({ db: {}, log: {} });

describe('Google Transparency route discriminator', () => {
  it('falls through the compatibility route when platform 18 is absent', () => {
    const next = vi.fn();
    router.routes['/insertion/gtAdsData'][0]({ body: { platform: 10 } }, {}, next);
    expect(next).toHaveBeenCalledWith('router');
  });

  it('continues into the new pipeline when a batch contains platform 18', () => {
    const next = vi.fn();
    router.routes['/insertion/gtAdsData'][0]({ body: [{ platform: 10 }, { platform: 18 }] }, {}, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('exposes only the existing gtAdsData insertion API', () => {
    expect(Object.keys(router.routes)).toEqual(['/insertion/gtAdsData']);
  });
});
