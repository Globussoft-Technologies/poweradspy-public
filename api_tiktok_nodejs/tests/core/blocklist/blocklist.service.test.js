import { describe, it, expect, vi, afterEach } from "vitest";
import {
  Blocklist, buildSettings, init, guard, status, shutdown, _setForTests,
} from "../../../core/blocklist/blocklist.service.js";
import { buildSnapshot } from "../../../core/blocklist/blocklist.match.js";
import { STATUS } from "../../../core/blocklist/blocklist.constants.js";

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function make({ rows = [], status: st = STATUS.READY, raw = {} } = {}) {
  const config = buildSettings({ enabled: true, ...raw });
  const state = { status: st, snapshot: st === STATUS.UNAVAILABLE ? null : buildSnapshot(rows) };
  const cache = { get: () => state, summary: () => ({}) };
  const attempts = { record: vi.fn(), queue: [], dropped: 0 };
  return { bl: new Blocklist({ config, cache, attempts, log }), attempts };
}

const rows = [
  { id: 1, entry_type: "ad_id", value: "1234" },
  { id: 2, entry_type: "advertiser", value: "Bad Co" },
  { id: 3, entry_type: "image_url", value: "https://p16.tiktokcdn.com/bad.webp?sig=1" },
  { id: 4, entry_type: "domain", value: "blocked.com" },
  { id: 5, entry_type: "image_hash", value: "abc123" },
];

afterEach(() => _setForTests(null));

describe("blocklist.service > guard matching", () => {
  const { bl, attempts } = make({ rows });
  const check = (ad) => bl.guard(ad, "t");

  it("allows a clean ad", () => {
    expect(check({ ad_id: "9", post_owner: "Good Co", video_cover: "https://x.com/ok.webp" })).toBeNull();
  });
  it("rejects a blocked ad id, even sent as a number", () => {
    expect(check({ ad_id: 1234 })).toMatchObject({ statusCode: 422, body: { status: "failed" } });
  });
  it("rejects a blocked advertiser by owner name or account name", () => {
    expect(check({ ad_id: "9", post_owner: "  bad   CO " })).toMatchObject({ statusCode: 422 });
    expect(check({ ad_id: "9", tiktok_account_name: "BAD CO" })).toMatchObject({ statusCode: 422 });
  });
  it("rejects a blocked cover url regardless of the signed query", () => {
    expect(check({ ad_id: "9", video_cover: "http://www.p16.tiktokcdn.com/bad.webp?x-signature=other" })).toMatchObject({ statusCode: 422 });
  });
  it("rejects a blocked domain and its subdomains, but not a look-alike", () => {
    expect(check({ ad_id: "9", destination_url: "https://shop.blocked.com/p" })).toMatchObject({ statusCode: 422 });
    expect(check({ ad_id: "9", destination_url: "https://notblocked.com/p" })).toBeNull();
    expect(check({ ad_id: "9", destination_url: "https://blocked.com.evil.io/p" })).toBeNull();
  });
  it("does not match on prefixes or partial names", () => {
    expect(check({ ad_id: "12345" })).toBeNull();
    expect(check({ ad_id: "123" })).toBeNull();
    expect(check({ ad_id: "9", post_owner: "Bad" })).toBeNull();
  });
  it("ignores entry types it does not own (image_hash)", () => {
    expect(check({ ad_id: "abc123" })).toBeNull();
  });
  it("reveals nothing about which entry or complaint matched", () => {
    expect(JSON.stringify(check({ ad_id: "1234" }))).not.toMatch(/1234|oracle|complaint|blocklist/i);
  });
  it("records an attempt with identifiers only", () => {
    attempts.record.mockClear();
    check({ ad_id: "1234", post_owner: "Someone", ad_title: "SECRET BODY TEXT" });
    expect(attempts.record).toHaveBeenCalledTimes(1);
    const row = attempts.record.mock.calls[0][0];
    expect(row).toMatchObject({ network: "tiktok", platform_ad_id: "1234", blocklist_id: 1, match_type: "ad_id", source: "t" });
    expect(JSON.stringify(row)).not.toContain("SECRET BODY TEXT");
  });
  it("survives junk payloads", () => {
    for (const v of [null, undefined, "x", 5, [], {}]) expect(() => check(v)).not.toThrow();
  });
  it("can switch a rule off and use a configured response", () => {
    const off = make({ rows, raw: { rules: { adId: false }, response: { code: 451, message: "No." } } }).bl;
    expect(off.guard({ ad_id: "1234" })).toBeNull();
    expect(off.guard({ ad_id: "9", post_owner: "Bad Co" })).toMatchObject({ statusCode: 451, body: { message: "No." } });
  });
  it("does nothing when disabled", () => {
    const bl = new Blocklist({ config: buildSettings({ enabled: false }), log });
    expect(bl.guard({ ad_id: "1234" })).toBeNull();
  });
});

describe("blocklist.service > fail mode", () => {
  it("fail closed: no list rejects with 503", () => {
    const { bl } = make({ status: STATUS.UNAVAILABLE });
    expect(bl.guard({ ad_id: "1" })).toMatchObject({ statusCode: 503 });
  });
  it("fail open: no list lets the ad through", () => {
    const { bl } = make({ status: STATUS.UNAVAILABLE, raw: { failMode: "open" } });
    expect(bl.guard({ ad_id: "1" })).toBeNull();
  });
  it("a stale or from-file list is still enforced", () => {
    for (const st of [STATUS.STALE, STATUS.FROM_FILE]) {
      expect(make({ rows, status: st }).bl.guard({ ad_id: "1234" })).toMatchObject({ statusCode: 422 });
    }
  });
  it("an unexpected error follows the fail mode instead of crashing", () => {
    const closed = make({ rows }).bl;
    closed.cache.get = () => { throw new Error("boom"); };
    expect(closed.guard({ ad_id: "1" })).toMatchObject({ statusCode: 503 });
    const open = make({ rows, raw: { failMode: "open" } }).bl;
    open.cache.get = () => { throw new Error("boom"); };
    expect(open.guard({ ad_id: "1" })).toBeNull();
  });
});

describe("blocklist.service > buildSettings", () => {
  it("is off by default, fails closed, and has safe numbers", () => {
    const c = buildSettings(undefined, {});
    expect(c).toMatchObject({
      enabled: false, failMode: "closed", refreshSeconds: 30, loadTimeoutMs: 5000, pageSize: 5000,
      emptyRefreshGuard: true, response: { code: 422 }, unavailable: { code: 503 },
      attempts: { batchSize: 100, flushSeconds: 5, maxQueue: 10000 },
      rules: { adId: true, advertiser: true, url: true, domain: true }, fields: {},
    });
    expect(c.snapshot.dir).toMatch(/compliance-blocklist$/);
  });
  it("env overrides enabled, failMode and refresh", () => {
    const c = buildSettings({ enabled: false, failMode: "closed" }, { BLOCKLIST_ENABLED: "true", BLOCKLIST_FAIL_MODE: "open", BLOCKLIST_REFRESH_SECONDS: "60" });
    expect(c).toMatchObject({ enabled: true, failMode: "open", refreshSeconds: 60 });
  });
  it("any failMode other than 'open' means closed", () => {
    expect(buildSettings({ failMode: "banana" }).failMode).toBe("closed");
    expect(buildSettings({ failMode: "OPEN" }).failMode).toBe("open");
  });
  it("clamps bad numbers instead of trusting them", () => {
    const c = buildSettings({
      refreshSeconds: -5, loadTimeoutMs: 1, pageSize: "x", response: { code: 200 }, unavailable: { code: 200 },
      attempts: { batchSize: 99999, flushSeconds: 0, maxQueue: 1 },
    });
    expect(c).toMatchObject({ refreshSeconds: 5, loadTimeoutMs: 500, pageSize: 5000, response: { code: 400 }, unavailable: { code: 500 } });
    expect(c.attempts).toEqual({ batchSize: 1000, flushSeconds: 1, maxQueue: 100 });
  });
});

describe("blocklist.service > init and module functions", () => {
  it("is a no-op before init and when disabled", async () => {
    expect(guard({ ad_id: "1234" })).toBeNull();
    expect(status()).toEqual({ enabled: false });
    await init({ config: buildSettings({ enabled: false }), log });
    expect(status()).toMatchObject({ enabled: false });
    expect(guard({ ad_id: "1234" })).toBeNull();
  });

  it("starts from the database and rejects a blocked ad", async () => {
    const repository = { loadActive: vi.fn(async () => rows), insertAttempts: vi.fn(async () => ({})) };
    await init({ config: buildSettings({ enabled: true, snapshot: { enabled: false } }), repository, log });
    expect(status().list).toMatchObject({ status: "ready", entries: 4 });
    expect(guard({ ad_id: "1234" })).toMatchObject({ statusCode: 422 });
    expect(guard({ ad_id: "ok" })).toBeNull();
    await shutdown();
    expect(repository.insertAttempts).toHaveBeenCalledTimes(1); // pending attempt flushed on shutdown
  });

  it("when the database is down and no copy exists, fail closed rejects with 503", async () => {
    const repository = { loadActive: vi.fn(async () => { throw new Error("db down"); }), insertAttempts: vi.fn() };
    await init({ config: buildSettings({ enabled: true, snapshot: { enabled: false } }), repository, log });
    expect(status().list.status).toBe("unavailable");
    expect(guard({ ad_id: "x" })).toMatchObject({ statusCode: 503 });
    await shutdown();
  });

  it("when startup itself crashes, follows the fail mode instead of silently allowing", async () => {
    // A config with no attempts section makes attempts.start() throw inside init().
    const crashing = (failMode) => {
      const config = buildSettings({ enabled: true, failMode });
      config.attempts = null;
      return config;
    };
    const repository = { loadActive: async () => rows, insertAttempts: vi.fn(async () => ({})) };

    await init({ config: crashing("closed"), repository, log });
    expect(status()).toMatchObject({ enabled: true, failMode: "closed", startupError: expect.any(String) });
    expect(guard({ ad_id: "x" })).toMatchObject({ statusCode: 503 });
    await shutdown();

    _setForTests(null);
    await init({ config: crashing("open"), repository, log });
    expect(guard({ ad_id: "x" })).toBeNull();
    await shutdown();
  });
});
