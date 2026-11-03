// Buffers rejected-attempt rows and writes them in batches, outside the request
// path. A rejection never waits for, or fails because of, this log.
//
// Failures are handled by kind:
//   - the database is down / unreachable: the rows are kept (up to maxQueue, then
//     the newest are dropped with a counter) and retried on the next flush;
//   - a DATA error (a value the table rejects: bad characters, too long, a NOT
//     NULL column left empty): retrying can never succeed, and one such row would
//     otherwise block every later row. The batch is written row by row; the rows
//     the table accepts are stored, the others are dropped, logged and counted.
// Rows already written are never queued again.
const DATA_ERRNOS = new Set([1048, 1264, 1265, 1292, 1364, 1366, 1406]);
const DATA_CODES = new Set([
  "ER_BAD_NULL_ERROR", "ER_WARN_DATA_OUT_OF_RANGE", "WARN_DATA_TRUNCATED", "ER_TRUNCATED_WRONG_VALUE",
  "ER_NO_DEFAULT_FOR_FIELD", "ER_TRUNCATED_WRONG_VALUE_FOR_FIELD", "ER_DATA_TOO_LONG",
]);

// Sequelize wraps the driver error in `parent` / `original`.
export function isDataError(err) {
  const e = err?.original || err?.parent || err;
  return DATA_ERRNOS.has(e?.errno) || DATA_CODES.has(e?.code);
}

export class BlockedAttemptLogger {
  // deps: repository { insertAttempts(rows) }, config.attempts, log
  constructor({ repository, config, log }) {
    this.repository = repository;
    this.config = config;
    this.log = log;
    this.queue = [];
    this.dropped = 0; // rows lost because the queue was full
    this.rejected = 0; // rows the table refused (data errors)
    this.timer = null;
    this.flushing = null;
  }

  start() {
    this.timer = setInterval(() => {
      this.flush().catch(() => {});
    }, this.config.attempts.flushSeconds * 1000);
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  // Queue one row. Synchronous and never throws.
  record(row) {
    if (this.queue.length >= this.config.attempts.maxQueue) {
      this.dropped += 1;
      return;
    }
    this.queue.push(row);
    if (this.queue.length >= this.config.attempts.batchSize) this.flush().catch(() => {});
  }

  flush() {
    if (!this.flushing) {
      this.flushing = this.doFlush().finally(() => { this.flushing = null; });
    }
    return this.flushing;
  }

  // Put rows back at the front of the queue, as far as maxQueue allows.
  requeue(rows) {
    const room = Math.max(0, this.config.attempts.maxQueue - this.queue.length);
    this.queue.unshift(...rows.slice(0, room));
    this.dropped += Math.max(0, rows.length - room);
  }

  async doFlush() {
    if (!this.queue.length) return;
    const rows = this.queue.splice(0, this.queue.length);
    let written = 0; // rows already stored; they must never be written twice
    try {
      const size = this.config.attempts.batchSize;
      for (let i = 0; i < rows.length; i += size) {
        const chunk = rows.slice(i, i + size);
        await this.repository.insertAttempts(chunk);
        written += chunk.length;
      }
    } catch (err) {
      const pending = rows.slice(written);
      if (isDataError(err)) {
        await this.writeOneByOne(pending, err);
      } else {
        this.requeue(pending);
        this.log.warn("could not write blocked attempts; will retry", { rows: pending.length, error: err.message });
      }
    }
  }

  // Isolate the row(s) the table refuses: store the rest, drop and log the bad ones.
  async writeOneByOne(rows, cause) {
    for (let i = 0; i < rows.length; i += 1) {
      try {
        await this.repository.insertAttempts([rows[i]]);
      } catch (err) {
        if (isDataError(err)) {
          this.rejected += 1;
          this.log.error("dropped a blocked-attempt row the table refused", {
            platform_ad_id: rows[i].platform_ad_id ?? null, error: err.message,
          });
        } else {
          // the database went away part-way through: keep the rest for the next flush
          this.requeue(rows.slice(i));
          this.log.warn("could not write blocked attempts; will retry", { rows: rows.length - i, error: err.message });
          return;
        }
      }
    }
    this.log.warn("a blocked-attempt batch contained rows the table refused; the others were stored", { error: cause.message });
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush().catch(() => {});
  }
}
