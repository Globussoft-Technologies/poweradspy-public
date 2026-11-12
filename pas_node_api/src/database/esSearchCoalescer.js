'use strict';

/**
 * Single-flight for Elasticsearch searches.
 *
 * All networks now share one ES cluster, so the same search often arrives
 * several times at once (many users opening the default "All networks" page,
 * the frontend re-requesting while a slow network is still running, etc.).
 * Each copy used to run on ES separately and compete for the same disk.
 *
 * This wrapper lets identical searches that are IN FLIGHT AT THE SAME TIME
 * share one ES request. Nothing is cached: as soon as the request finishes the
 * entry is removed, so the next search always goes to ES and sees fresh data.
 * Every caller gets exactly the response ES returned for that body.
 *
 * When more than one caller shares a response, each caller receives its own
 * deep copy of the response body, so a controller that mutates hits can never
 * affect another request.
 */
function createSearchCoalescer(searchFn, { maxKeyLength = 200000 } = {}) {
  const inFlight = new Map(); // key -> { promise, waiters }
  const stats = { started: 0, shared: 0 };

  // @elastic/elasticsearch 9 returns the response body itself. A { body, statusCode, meta }
  // envelope (v7 shape, or meta: true) holds non-cloneable connection objects in `meta`,
  // so only its body is copied.
  const cloneResponse = (res) => {
    if (!res || typeof res !== 'object') return res;
    if ('statusCode' in res && res.body && typeof res.body === 'object') {
      return { ...res, body: structuredClone(res.body) };
    }
    return structuredClone(res);
  };

  function coalescedSearch(params, options) {
    // Requests with transport options, callbacks or scroll contexts are never shared.
    if (options !== undefined || typeof params !== 'object' || params === null || params.scroll) {
      return searchFn(params, options);
    }
    let key;
    try { key = JSON.stringify(params); } catch (_) { return searchFn(params, options); }
    if (!key || key.length > maxKeyLength) return searchFn(params, options);

    let entry = inFlight.get(key);
    if (entry) {
      entry.waiters += 1;
      stats.shared += 1;
    } else {
      stats.started += 1;
      entry = { waiters: 1, promise: null };
      // Call ES right away (same tick as before); a synchronous throw becomes a rejection.
      let started;
      try { started = Promise.resolve(searchFn(params)); } catch (err) { started = Promise.reject(err); }
      entry.promise = started
        .finally(() => { if (inFlight.get(key) === entry) inFlight.delete(key); });
      inFlight.set(key, entry);
    }
    const current = entry;
    // Only copy when the response is actually shared.
    return current.promise.then((res) => (current.waiters > 1 ? cloneResponse(res) : res));
  }

  coalescedSearch.stats = () => ({ ...stats, inFlight: inFlight.size });
  return coalescedSearch;
}

module.exports = { createSearchCoalescer };
