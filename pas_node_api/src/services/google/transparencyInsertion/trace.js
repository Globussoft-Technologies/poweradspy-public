'use strict';

const config = require('../../../config');

function compact(value, depth = 0) {
  if (value === undefined) return undefined;
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return value.length > 800 ? `${value.slice(0, 800)}…[truncated]` : value;
  }
  if (depth >= 4) return '[nested]';
  if (Array.isArray(value)) return value.slice(0, 25).map((item) => compact(item, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !/(secret|password|token|signature|authorization)/i.test(key))
        .map(([key, item]) => [key, compact(item, depth + 1)])
        .filter(([, item]) => item !== undefined)
    );
  }
  return String(value);
}

function createTransparencyTrace(log, payload, context = {}) {
  const enabled = config.insertion.transparencyDebug === true && typeof log?.info === 'function';
  const startedAt = Date.now();
  let step = 0;
  const adId = payload?.ad_id || 'unknown-ad';

  return (event, details = {}) => {
    if (!enabled) return;
    step += 1;
    const record = compact({
      trace: 'google-transparency-platform-18',
      step,
      event,
      ad_id: adId,
      request_id: context.requestId || null,
      batch_index: context.index ?? null,
      elapsed_ms: Date.now() - startedAt,
      ...details,
    });
    log.info(
      `[GT18 TRACE ${String(step).padStart(2, '0')}] ${event} ${JSON.stringify(record)}`
    );
  };
}

module.exports = { createTransparencyTrace, compact };
