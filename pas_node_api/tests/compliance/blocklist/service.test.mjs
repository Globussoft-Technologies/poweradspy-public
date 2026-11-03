import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { BlocklistService } = require("../../../src/compliance/blocklist/service");
const { buildSnapshot } = require("../../../src/compliance/blocklist/match");
import { makeConfig } from "./helpers.mjs";
const { STATUS } = require("../../../src/compliance/blocklist/constants");

const silent = { info() {}, warn: vi.fn(), error: vi.fn() };

function makeService({ rowsByNetwork = {}, status = STATUS.READY, raw = {} } = {}) {
  const config = makeConfig({ enabled: true, ...raw });
  const states = new Map();
  for (const [network, rows] of Object.entries(rowsByNetwork)) {
    states.set(network, { status, snapshot: status === STATUS.UNAVAILABLE ? null : buildSnapshot(rows) });
  }
  const cache = { networks: [...states.keys()], manages: (n) => states.has(n), get: (n) => states.get(n) || null, summary: () => ({}) };
  const attempts = { record: vi.fn(), queue: [], dropped: 0 };
  return { service: new BlocklistService({ config, cache, attempts, log: silent }), attempts, config };
}

const rows = [
  { id: 1, entry_type: "ad_id", value: "1234" },
  { id: 2, entry_type: "advertiser", value: "Bad Co" },
  { id: 3, entry_type: "image_url", value: "https://cdn.x.com/bad.jpg?sig=1" },
  { id: 4, entry_type: "domain", value: "blocked.com" },
  { id: 5, entry_type: "image_hash", value: "abc123" },
];

describe("compliance/blocklist > guard matching", () => {
  const { service, attempts } = makeService({ rowsByNetwork: { reddit: rows } });
  const guard = (ad) => service.guard(ad, "reddit", { source: "t" });

  it("allows a clean ad", () => {
    expect(guard({ ad_id: "9", post_owner: "Good Co", image_url: "https://cdn.x.com/ok.jpg" })).toBeNull();
  });
  it("rejects a blocked ad id, even sent as a number", () => {
    expect(guard({ ad_id: 1234 })).toMatchObject({ code: 422, status: "rejected" });
  });
  it("rejects a blocked advertiser regardless of case and spacing", () => {
    expect(guard({ ad_id: "9", post_owner: "  bad   CO " })).toMatchObject({ code: 422 });
  });
  it("rejects a blocked url in the main image, thumbnail, owner image or carousel", () => {
    for (const field of ["image_video_url", "image_url", "thumbnail_url", "post_owner_image"]) {
      expect(guard({ ad_id: "9", [field]: "http://www.cdn.x.com/bad.jpg" })).toMatchObject({ code: 422 });
    }
    expect(guard({ ad_id: "9", other_multimedia: "https://a.com/1.jpg||,https://cdn.x.com/bad.jpg" })).toMatchObject({ code: 422 });
  });
  it("rejects a blocked domain and its subdomains, but not a look-alike", () => {
    expect(guard({ ad_id: "9", destination_url: "https://shop.blocked.com/p" })).toMatchObject({ code: 422 });
    expect(guard({ ad_id: "9", destination_url: "https://notblocked.com/p" })).toBeNull();
    expect(guard({ ad_id: "9", destination_url: "https://blocked.com.evil.io/p" })).toBeNull();
  });
  it("does not match on prefixes or partial names", () => {
    expect(guard({ ad_id: "12345" })).toBeNull();
    expect(guard({ ad_id: "123" })).toBeNull();
    expect(guard({ ad_id: "9", post_owner: "Bad" })).toBeNull();
    expect(guard({ ad_id: "9", post_owner: "Bad Co Ltd" })).toBeNull();
  });
  it("does not block on the reddit discovering user", () => {
    expect(guard({ ad_id: "9", reddit_id: "Bad Co" })).toBeNull();
  });
  it("ignores entry types it does not own (image_hash)", () => {
    expect(guard({ ad_id: "abc123", image_url: "abc123" })).toBeNull();
  });
  it("reveals nothing about which entry or complaint matched", () => {
    const r = guard({ ad_id: "1234" });
    expect(JSON.stringify(r)).not.toMatch(/1234|oracle|complaint|blocklist/i);
  });
  it("records an attempt with identifiers only", () => {
    attempts.record.mockClear();
    guard({ ad_id: "1234", post_owner: "Someone", ad_text: "SECRET BODY TEXT" });
    expect(attempts.record).toHaveBeenCalledTimes(1);
    const row = attempts.record.mock.calls[0][0];
    expect(row).toMatchObject({ network: "reddit", platform_ad_id: "1234", blocklist_id: 1, match_type: "ad_id", source: "t" });
    expect(JSON.stringify(row)).not.toContain("SECRET BODY TEXT");
  });
  it("survives junk payloads", () => {
    for (const v of [null, undefined, "x", 5, [], {}]) expect(() => guard(v)).not.toThrow();
  });
});

describe("compliance/blocklist > scoping", () => {
  it("only applies to networks it manages, and keeps networks separate", () => {
    const { service } = makeService({
      rowsByNetwork: { reddit: [{ id: 1, entry_type: "ad_id", value: "1" }], quora: [] },
    });
    expect(service.guard({ ad_id: "1" }, "reddit")).toMatchObject({ code: 422 });
    expect(service.guard({ ad_id: "1" }, "quora")).toBeNull();     // another network's entry
    expect(service.guard({ ad_id: "1" }, "facebook")).toBeNull();  // not managed
    expect(service.guard({ ad_id: "1" }, undefined)).toBeNull();
  });
  it("does nothing when disabled", () => {
    const config = makeConfig({ enabled: false });
    const service = new BlocklistService({ config, log: silent });
    expect(service.guard({ ad_id: "1" }, "reddit")).toBeNull();
  });
  it("can switch a rule off in config", () => {
    const { service } = makeService({ rowsByNetwork: { reddit: rows }, raw: { rules: { adId: false } } });
    expect(service.guard({ ad_id: "1234" }, "reddit")).toBeNull();
    expect(service.guard({ ad_id: "9", post_owner: "Bad Co" }, "reddit")).toMatchObject({ code: 422 });
  });
  it("uses the configured response code and message", () => {
    const { service } = makeService({
      rowsByNetwork: { reddit: rows }, raw: { response: { code: 451, message: "Nope." } },
    });
    expect(service.guard({ ad_id: "1234" }, "reddit")).toMatchObject({ code: 451, message: "Nope." });
  });
});

describe("compliance/blocklist > fail mode", () => {
  it("fail closed: a network with no list rejects with 503 and stores nothing", () => {
    const { service } = makeService({ rowsByNetwork: { reddit: [] }, status: STATUS.UNAVAILABLE });
    expect(service.guard({ ad_id: "1" }, "reddit")).toMatchObject({ code: 503, status: "server_error" });
  });
  it("fail open: a network with no list lets the ad through", () => {
    const { service } = makeService({ rowsByNetwork: { reddit: [] }, status: STATUS.UNAVAILABLE, raw: { failMode: "open" } });
    expect(service.guard({ ad_id: "1" }, "reddit")).toBeNull();
  });
  it("a stale or from-file list is still enforced", () => {
    for (const status of [STATUS.STALE, STATUS.FROM_FILE]) {
      const { service } = makeService({ rowsByNetwork: { reddit: rows }, status });
      expect(service.guard({ ad_id: "1234" }, "reddit")).toMatchObject({ code: 422 });
    }
  });
  it("an unexpected error follows the fail mode instead of crashing", () => {
    const closed = makeService({ rowsByNetwork: { reddit: rows } }).service;
    closed.match = () => { throw new Error("boom"); };
    expect(closed.guard({ ad_id: "1" }, "reddit")).toMatchObject({ code: 503 });

    const open = makeService({ rowsByNetwork: { reddit: rows }, raw: { failMode: "open" } }).service;
    open.match = () => { throw new Error("boom"); };
    expect(open.guard({ ad_id: "1" }, "reddit")).toBeNull();
  });
});

