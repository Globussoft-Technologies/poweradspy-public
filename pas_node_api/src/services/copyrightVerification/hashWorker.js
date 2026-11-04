'use strict';

/**
 * Compares image hashes against the blocked image hashes in worker threads, so
 * a big blocklist (10k+ hashes x hundreds of images) never blocks the API's
 * event loop. Only CPU work runs here: no SQL, ES or network calls.
 */

const { isMainThread, parentPort, workerData, Worker } = require('node:worker_threads');
const { decide, parseHash } = require('../../compliance/imagematch/matcher');

function compare(images, hashes, options) {
  const banned = { available: true, hashes };
  return images.map((image) => {
    const words = parseHash(image.phash);
    const d = decide(banned, { sha256: image.sha256, words }, options);
    return { action: d.action, kind: d.kind || null, distance: d.distance ?? null, blocklistId: d.entry?.id ?? null };
  });
}

if (!isMainThread && workerData?.copyrightMatch === true) {
  parentPort.postMessage(compare(workerData.images, workerData.hashes, workerData.options));
}

/**
 * @param images  [{ sha256, phash }]   hashes of the pending ads' images
 * @param hashes  blocklist.getImageHashes(network).hashes
 * @returns one { action: allow|review|reject, kind, distance, blocklistId } per image, same order
 */
async function matchBatch(images, hashes, options, workerCount) {
  if (!images.length) return [];
  if (!hashes.length) return images.map(() => ({ action: 'allow', kind: null, distance: null, blocklistId: null }));
  const count = Math.max(1, Math.min(workerCount, images.length));
  const size = Math.ceil(images.length / count);
  const workers = [];
  try {
    const jobs = [];
    for (let offset = 0; offset < images.length; offset += size) {
      const worker = new Worker(__filename, {
        workerData: { copyrightMatch: true, images: images.slice(offset, offset + size), hashes, options },
      });
      workers.push(worker);
      jobs.push(new Promise((resolve, reject) => {
        worker.once('message', resolve);
        worker.once('error', reject);
        worker.once('exit', (code) => reject(new Error(`copyright hash worker exited (code ${code})`)));
      }));
    }
    return (await Promise.all(jobs)).flat();
  } finally {
    await Promise.all(workers.map((w) => w.terminate()));
  }
}

module.exports = { matchBatch, compare };
