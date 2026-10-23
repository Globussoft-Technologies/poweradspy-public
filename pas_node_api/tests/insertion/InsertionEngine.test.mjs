import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const engine = require("../../src/insertion/InsertionEngine");
const logger = require("../../src/logger");
const networks = require("../../src/config/networks");

describe("insertion/InsertionEngine > run", () => {
  it("returns batch:false and index 0 for a single ad", async () => {
    const processOne = vi.fn(async () => ({ code: 200, status: "ok" }));
    const out = await engine.run({ ad_id: "a1" }, processOne);
    expect(out).toEqual({ batch: false, result: { code: 200, status: "ok", index: 0 } });
  });

  it("returns batch:true with per-ad results in input order", async () => {
    const processOne = vi.fn(async (ad, index) => ({ code: 200, ad_id: ad.ad_id, index }));
    const out = await engine.run([{ ad_id: "a1" }, { ad_id: "a2" }], processOne);
    expect(out.batch).toBe(true);
    expect(out.results).toEqual([
      { code: 200, ad_id: "a1", index: 0 },
      { code: 200, ad_id: "a2", index: 1 },
    ]);
    expect(out.summary).toEqual({ total: 2, ok: 2, failed: 0 });
  });

  it("counts 4xx results as failed", async () => {
    const processOne = vi.fn(async () => ({ code: 400, status: "rejected", message: "bad" }));
    const out = await engine.run([{ ad_id: "a1" }, { ad_id: "a2" }], processOne);
    expect(out.summary).toEqual({ total: 2, ok: 0, failed: 2 });
    expect(out.results[0]).toMatchObject({ code: 400, index: 0 });
  });

  it("isolates a thrown error to a single ad result", async () => {
    const processOne = vi.fn(async (ad) => {
      if (ad.ad_id === "boom") throw new Error("boom");
      return { code: 200 };
    });
    const out = await engine.run([{ ad_id: "ok" }, { ad_id: "boom" }], processOne);
    expect(out.results[0]).toMatchObject({ code: 200, index: 0 });
    expect(out.results[1]).toMatchObject({
      code: 500,
      status: "server_error",
      index: 1,
      message: "The ad could not be processed due to an unexpected server error.",
    });
    expect(out.summary).toEqual({ total: 2, ok: 1, failed: 1 });
  });

  it("rejects a configured post owner case-insensitively before the pipeline runs", async () => {
    const original = networks.google.insertion.rejectedPostOwnerNames;
    networks.google.insertion.rejectedPostOwnerNames = ["  Acme   CORP  "];
    const processOne = vi.fn(async () => ({ code: 200, status: "ok" }));

    try {
      const out = await engine.run(
        { ad_id: "blocked", post_owner: "acme corp" },
        processOne,
        { network: "google" }
      );

      expect(processOne).not.toHaveBeenCalled();
      expect(out.result).toMatchObject({
        code: 422,
        status: "rejected",
        field: "post_owner",
        index: 0,
      });
    } finally {
      networks.google.insertion.rejectedPostOwnerNames = original;
    }
  });

  it("keeps reject lists isolated per network and uses exact-name matching", async () => {
    const original = networks.facebook.insertion.rejectedPostOwnerNames;
    networks.facebook.insertion.rejectedPostOwnerNames = ["Acme"];
    const processOne = vi.fn(async () => ({ code: 200, status: "ok" }));

    try {
      const otherNetwork = await engine.run(
        { ad_id: "allowed-1", post_owner: "ACME" },
        processOne,
        { network: "instagram" }
      );
      const partialName = await engine.run(
        { ad_id: "allowed-2", post_owner: "Acme Store" },
        processOne,
        { network: "facebook" }
      );

      expect(otherNetwork.result.code).toBe(200);
      expect(partialName.result.code).toBe(200);
      expect(processOne).toHaveBeenCalledTimes(2);
    } finally {
      networks.facebook.insertion.rejectedPostOwnerNames = original;
    }
  });

  it("rejects a configured keyword anywhere in the ad text, as a whole word", async () => {
    const original = networks.facebook.insertion.rejectedKeywords;
    networks.facebook.insertion.rejectedKeywords = ["Twinkling  Tree"];
    const processOne = vi.fn(async () => ({ code: 200, status: "ok" }));
    try {
      const blocked = await engine.run(
        { ad_id: "k1", post_owner: "Someone", ad_text: "Shop the new TWINKLING tree collection!" },
        processOne,
        { network: "facebook" }
      );
      expect(blocked.result).toMatchObject({ code: 422, status: "rejected", field: "ad_text" });

      networks.facebook.insertion.rejectedKeywords = ["tree"];
      const wordInsideOtherWord = await engine.run(
        { ad_id: "k2", ad_text: "Main street sale" },
        processOne,
        { network: "facebook" }
      );
      const mediaFieldOnly = await engine.run(
        { ad_id: "k3", ad_text: "hello", image_url: "https://cdn.x/tree.jpg" },
        processOne,
        { network: "facebook" }
      );
      expect(wordInsideOtherWord.result.code).toBe(200);
      expect(mediaFieldOnly.result.code).toBe(200);
      expect(processOne).toHaveBeenCalledTimes(2);
    } finally {
      networks.facebook.insertion.rejectedKeywords = original;
    }
  });

  it("rejects a configured domain anywhere in the ad's URL fields", async () => {
    const original = networks.google.insertion.rejectedDomains;
    networks.google.insertion.rejectedDomains = ["https://www.TwinklingTree.com/"];
    const processOne = vi.fn(async () => ({ code: 200, status: "ok" }));
    try {
      const blocked = await engine.run(
        { ad_id: "d1", destination_url: "https://shop.twinklingtree.com/sale?x=1" },
        processOne,
        { network: "google" }
      );
      const textOnly = await engine.run(
        { ad_id: "d2", ad_text: "visit twinklingtree.com" },
        processOne,
        { network: "google" }
      );
      expect(blocked.result).toMatchObject({ code: 422, status: "rejected", field: "destination_url" });
      expect(textOnly.result.code).toBe(200); // domain list checks URL/domain fields only
    } finally {
      networks.google.insertion.rejectedDomains = original;
    }
  });

  it("applies the global insertion.rejectedKeywords list to every network", async () => {
    const config = require("../../src/config");
    const spy = vi.spyOn(config, "getRawFileConfig").mockReturnValue({ insertion: { rejectedKeywords: ["casino"], rejectedDomains: [] } });
    const processOne = vi.fn(async () => ({ code: 200, status: "ok" }));
    try {
      const out = await engine.run({ ad_id: "g1", title: "Best Casino bonus" }, processOne, { network: "pinterest" });
      expect(out.result).toMatchObject({ code: 422, status: "rejected", field: "title" });
      expect(processOne).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("classifies real payload fields: text / url / media / meta", () => {
    const { fieldKind } = require("../../src/insertion/helpers/postOwnerRejection");
    for (const k of ["ad_text", "ad_title", "newsfeed_description", "call_to_action", "post_owner", "image_ocr", "display_link", "social_media_text", "headline"]) {
      expect([k, fieldKind(k)]).toEqual([k, "text"]);
    }
    for (const k of ["destination_url", "ad_url", "redirect_urls", "outgoing_url_json", "target_site", "final_url", "ad_url_new", "cta_link"]) {
      expect([k, fieldKind(k)]).toEqual([k, "url"]);
    }
    for (const k of ["image_video_url", "image_url", "post_owner_image", "thumbnail_url", "new_nas_image_url", "nas_video_url", "other_multimedia", "ad_image_video"]) {
      expect([k, fieldKind(k)]).toEqual([k, "media"]);
    }
    for (const k of ["ad_id", "post_date", "target_keyword", "domain_registered_date", "lander_status", "lander_domain_age", "redirect_status", "days_running", "country", "ip_address"]) {
      expect([k, fieldKind(k)]).toEqual([k, "meta"]);
    }
  });

  it("does not scan metadata or nested media for keywords/domains", async () => {
    const original = networks.facebook.insertion.rejectedKeywords;
    const originalDomains = networks.facebook.insertion.rejectedDomains;
    networks.facebook.insertion.rejectedKeywords = ["tree"];
    networks.facebook.insertion.rejectedDomains = ["tree"];
    const processOne = vi.fn(async () => ({ code: 200, status: "ok" }));
    try {
      const out = await engine.run({
        ad_id: "m1",
        ad_text: "hello",
        target_keyword: "tree",                                  // crawler input, not ad content
        domain_registered_date: "tree",                          // metadata despite "domain"
        other_multimedia: [{ url: "https://cdn/tree.jpg", title: "tree" }], // nested media stays media
      }, processOne, { network: "facebook" });
      expect(out.result.code).toBe(200);
    } finally {
      networks.facebook.insertion.rejectedKeywords = original;
      networks.facebook.insertion.rejectedDomains = originalDomains;
    }
  });

  it("never applies the deny-lists to delete flows", async () => {
    const original = networks.quora.insertion.rejectedKeywords;
    networks.quora.insertion.rejectedKeywords = ["blocked"];
    const processOne = vi.fn(async () => ({ code: 200, status: "ok" }));
    try {
      const out = await engine.run(
        { ad_id: "x", ad_text: "blocked word" },
        processOne,
        { network: "quora", applyPostOwnerRejection: false }
      );
      expect(out.result.code).toBe(200);
    } finally {
      networks.quora.insertion.rejectedKeywords = original;
    }
  });
});

describe("insertion/InsertionEngine > rejection logging", () => {
  let warnSpy;
  let infoSpy;

  beforeEach(() => {
    warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    infoSpy = vi.spyOn(logger.insertionRejections, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs rejections via the fallback insertionRejections logger when no request log is passed", async () => {
    const processOne = vi.fn(async () => ({ code: 422, status: "rejected", message: "missing field", field: "ad_id" }));
    await engine.run({ ad_id: "x" }, processOne, { network: "facebook" });
    expect(infoSpy).toHaveBeenCalledTimes(1);
    const payload = infoSpy.mock.calls[0][1];
    expect(payload).toMatchObject({
      ad_id: "x",
      network: "facebook",
      code: 422,
      status: "rejected",
      reason: "missing field",
      field: "ad_id",
    });
  });

  it("logs via request-scoped logger.warn when opts.log is provided", async () => {
    const reqLog = { warn: vi.fn(() => {}) };
    const processOne = vi.fn(async () => ({ code: 400, status: "rejected", message: "bad" }));
    await engine.run({ ad_id: "y" }, processOne, { network: "instagram", log: reqLog });
    expect(reqLog.warn).toHaveBeenCalledTimes(1);
    expect(reqLog.warn.mock.calls[0][1]).toMatchObject({ ad_id: "y", network: "instagram", code: 400 });
    expect(warnSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it("logs thrown errors via insertionRejections logger", async () => {
    const processOne = vi.fn(async () => { throw new Error("db down"); });
    await engine.run({ ad_id: "z" }, processOne, { network: "gdn" });
    expect(infoSpy).toHaveBeenCalledTimes(1);
    const payload = infoSpy.mock.calls[0][1];
    expect(payload).toMatchObject({ ad_id: "z", network: "gdn", code: 500, status: "server_error", reason: "db down" });
  });
});
