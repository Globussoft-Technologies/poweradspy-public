// In-memory TikTok blocklist, kept fresh by a background refresh.
//
// Startup:
//   1. load from the database                                  -> status ready
//   2. database unreachable: load the last saved copy on disk  -> status from_file
//   3. neither works                                           -> status unavailable
//      (the service then applies the configured fail mode)
//
// While running, a failed refresh keeps the last good list (status stale) and
// logs a warning; the next successful refresh returns it to ready. A refresh
// that returns zero rows after a non-empty list is treated as a failure unless
// emptyRefreshGuard is off. The list is refreshed in full: it is small, and a
// full read also picks up expiries and removals without extra bookkeeping.
import fs from "fs";
import path from "path";
import { NETWORK, STATUS } from "./blocklist.constants.js";
import { buildSnapshot } from "./blocklist.match.js";

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export class BlocklistCache {
  // deps: repository { loadActive(opts) }, config (see blocklist.service.js), log
  constructor({ repository, config, log }) {
    this.repository = repository;
    this.config = config;
    this.log = log;
    this.state = { status: STATUS.UNAVAILABLE, snapshot: null, loadedAt: null, lastError: null };
    this.timer = null;
    this.refreshing = false;
  }

  get() {
    return this.state;
  }

  async start() {
    await this.refresh();
    this.timer = setInterval(() => {
      this.refresh().catch((err) => this.log.error("blocklist refresh crashed", { error: err.message }));
    }, this.intervalMs());
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  // This process's refresh period: refreshSeconds plus a random 0..refreshJitterPercent %
  // of it, so several instances drift apart instead of all reading the database in the
  // same second. A missing or invalid percent means no jitter.
  intervalMs() {
    const baseMs = this.config.refreshSeconds * 1000;
    const percent = Number(this.config.refreshJitterPercent);
    const jitter = Number.isFinite(percent) && percent > 0 ? Math.floor(Math.random() * baseMs * (percent / 100)) : 0;
    return baseMs + jitter;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async refresh() {
    if (this.refreshing) return; // a slow refresh never overlaps the next one
    this.refreshing = true;
    const state = this.state;
    try {
      const rows = await withTimeout(
        this.repository.loadActive({ pageSize: this.config.pageSize }),
        this.config.loadTimeoutMs,
        "blocklist load"
      );

      if (rows.length === 0 && state.snapshot && state.snapshot.count > 0 && this.config.emptyRefreshGuard) {
        throw new Error("refresh returned 0 rows after a non-empty list; keeping the previous list");
      }

      const wasDown = state.status !== STATUS.READY;
      state.snapshot = buildSnapshot(rows, { compactMinLength: this.config.compactMinLength });
      state.status = STATUS.READY;
      state.loadedAt = Date.now();
      state.lastError = null;
      if (wasDown) this.log.info("blocklist loaded", { entries: state.snapshot.count, ignored: state.snapshot.ignored });
      await this.saveFile(rows);
    } catch (err) {
      await this.handleFailure(err);
    } finally {
      this.refreshing = false;
    }
  }

  async handleFailure(err) {
    const state = this.state;
    state.lastError = err.message;

    if (state.snapshot) {
      if (state.status === STATUS.READY) state.status = STATUS.STALE;
      this.log.warn("blocklist refresh failed; using the last good list", { status: state.status, error: err.message });
      return;
    }

    const saved = await this.loadFile();
    if (saved) {
      state.snapshot = buildSnapshot(saved.rows, { compactMinLength: this.config.compactMinLength });
      state.status = STATUS.FROM_FILE;
      state.loadedAt = saved.savedAt;
      this.log.warn("blocklist database unreachable; started from the saved copy on disk", {
        entries: state.snapshot.count, savedAt: new Date(saved.savedAt).toISOString(), error: err.message,
      });
      return;
    }

    state.status = STATUS.UNAVAILABLE;
    this.log.error("blocklist could not be loaded and no saved copy exists", { error: err.message });
  }

  // ─── Saved copy on disk ─────────────────────────────────────────────

  filePath() {
    return path.join(this.config.snapshot.dir, `blocklist-${NETWORK}.json`);
  }

  async saveFile(rows) {
    if (!this.config.snapshot.enabled) return;
    const file = this.filePath();
    try {
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      const body = JSON.stringify({
        network: NETWORK,
        savedAt: Date.now(),
        rows: rows.map((r) => ({ id: r.id, entry_type: r.entry_type, value: r.value })),
      });
      await fs.promises.writeFile(tmp, body, "utf8");
      await fs.promises.rename(tmp, file); // atomic swap: a reader never sees a half-written file
    } catch (err) {
      this.log.warn("could not save the blocklist copy to disk", { error: err.message });
    }
  }

  async loadFile() {
    if (!this.config.snapshot.enabled) return null;
    try {
      const parsed = JSON.parse(await fs.promises.readFile(this.filePath(), "utf8"));
      if (!parsed || parsed.network !== NETWORK || !Array.isArray(parsed.rows)) return null;
      return { rows: parsed.rows, savedAt: Number(parsed.savedAt) || Date.now() };
    } catch {
      return null;
    }
  }

  summary() {
    const s = this.state;
    return {
      status: s.status,
      entries: s.snapshot ? s.snapshot.count : 0,
      loadedAt: s.loadedAt ? new Date(s.loadedAt).toISOString() : null,
      lastError: s.lastError,
    };
  }
}
