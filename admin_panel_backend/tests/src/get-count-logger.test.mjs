import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createRequire } from "node:module";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);

// Isolate writes to a temp dir; make sure logging is enabled for this suite.
const tmp = path.join(os.tmpdir(), `get-count-log-test-${process.pid}`);
process.env.GET_COUNT_LOG_DIR = tmp;
delete process.env.GET_COUNT_LOG_DISABLED;

const { logGetCount, pruneOldLogs, extractSource } = require("../../src/get-count-logger");

const todayStr = new Date().toISOString().slice(0, 10);
const dayFile = (d = todayStr) => path.join(tmp, `${d}.jsonl`);
const offsetDay = (n) => { const x = new Date(); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const clean = () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {} };

beforeEach(clean);
afterAll(clean);

describe("src/get-count-logger", () => {
  it("appends a JSONL entry with source, request and response", () => {
    const req = {
      headers: {
        "x-source": "ds-daily-report",
        "user-agent": "python-requests/2.31",
        "x-forwarded-for": "10.1.2.3, 7.7.7.7",
      },
      body: { network: "youtube", metric: "new", range: { from: "2026-06-15", to: "2026-06-15" } },
    };
    logGetCount({ req, status: 200, response: { code: 200, data: { total: 5401 } }, durationMs: 12 });

    expect(fs.existsSync(dayFile())).toBe(true);
    const lines = fs.readFileSync(dayFile(), "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const e = JSON.parse(lines[0]);
    expect(e.ip).toBe("10.1.2.3");               // first X-Forwarded-For hop
    expect(e.source).toBe("ds-daily-report");
    expect(e.userAgent).toBe("python-requests/2.31");
    expect(e.status).toBe(200);
    expect(e.durationMs).toBe(12);
    expect(e.request).toEqual(req.body);
    expect(e.response).toEqual({ code: 200, data: { total: 5401 } });
    expect(typeof e.ts).toBe("string");
  });

  it("appends one line per call (including error responses)", () => {
    const req = { headers: {}, body: { network: "facebook" } };
    logGetCount({ req, status: 400, response: { message: "bad" } });
    logGetCount({ req, status: 200, response: { code: 200 } });
    const lines = fs.readFileSync(dayFile(), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
  });

  it("does nothing when GET_COUNT_LOG_DISABLED=1", () => {
    process.env.GET_COUNT_LOG_DISABLED = "1";
    logGetCount({ req: { headers: {}, body: {} }, status: 200, response: {} });
    delete process.env.GET_COUNT_LOG_DISABLED;
    expect(fs.existsSync(dayFile())).toBe(false);
  });

  it("extractSource falls back to req.ip / socket when no XFF", () => {
    expect(extractSource({ ip: "1.2.3.4", headers: {} }).ip).toBe("1.2.3.4");
    expect(extractSource({ headers: {}, socket: { remoteAddress: "5.6.7.8" } }).ip).toBe("5.6.7.8");
  });

  it("pruneOldLogs keeps the most recent 7 days, deletes older, ignores non-log files", () => {
    fs.mkdirSync(tmp, { recursive: true });
    const mk = (name) => fs.writeFileSync(path.join(tmp, name), "x\n");
    mk(`${offsetDay(0)}.jsonl`);    // today        -> keep
    mk(`${offsetDay(-6)}.jsonl`);   // 6 days ago   -> keep (7-day window)
    mk(`${offsetDay(-7)}.jsonl`);   // 7 days ago   -> prune
    mk(`${offsetDay(-30)}.jsonl`);  // 30 days ago  -> prune
    mk("notes.txt");                // not a day-file -> untouched

    pruneOldLogs(tmp);

    expect(fs.existsSync(path.join(tmp, `${offsetDay(0)}.jsonl`))).toBe(true);
    expect(fs.existsSync(path.join(tmp, `${offsetDay(-6)}.jsonl`))).toBe(true);
    expect(fs.existsSync(path.join(tmp, `${offsetDay(-7)}.jsonl`))).toBe(false);
    expect(fs.existsSync(path.join(tmp, `${offsetDay(-30)}.jsonl`))).toBe(false);
    expect(fs.existsSync(path.join(tmp, "notes.txt"))).toBe(true);
  });
});
