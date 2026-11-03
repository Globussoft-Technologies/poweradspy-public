import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { extract } = require("../../../src/compliance/blocklist/extract");
const { resolveFields, DEFAULT_FIELDS } = require("../../../src/compliance/blocklist/extract");

const fields = resolveFields("reddit", {});

describe("compliance/blocklist > extract", () => {
  it("pulls ad id, advertiser, urls and domains out of a payload", () => {
    const x = extract({
      ad_id: " 99 ",
      post_owner: "Acme  Corp",
      image_video_url: "https://cdn.x.com/a.jpg?s=1",
      thumbnail_url: "https://cdn.x.com/t.jpg",
      post_owner_image: "https://cdn.x.com/o.jpg",
      destination_url: "https://shop.example.com/p?id=1",
    }, fields);
    expect(x.adIds).toEqual(["99"]);
    expect(x.advertisers).toEqual(["acme corp"]);
    expect(x.urls).toEqual(expect.arrayContaining(["cdn.x.com/a.jpg", "cdn.x.com/t.jpg", "cdn.x.com/o.jpg", "shop.example.com/p"]));
    expect(x.domains).toEqual(["shop.example.com", "example.com"]);
    expect(x.rawAdId).toBe("99");
    expect(x.rawAdvertiser).toBe("acme corp");
  });

  it("splits other_multimedia on ||, then || then |", () => {
    const a = extract({ other_multimedia: "https://x.com/1.jpg||,https://x.com/2.jpg" }, fields);
    const b = extract({ other_multimedia: "https://x.com/1.jpg||https://x.com/2.jpg" }, fields);
    const c = extract({ other_multimedia: "https://x.com/1.jpg|https://x.com/2.jpg" }, fields);
    for (const x of [a, b, c]) expect(x.urls).toEqual(["x.com/1.jpg", "x.com/2.jpg"]);
  });

  it("reads the image field names other networks use", () => {
    const cases = {
      pinterest: { ad_image: "https://p.com/i.jpg", ad_video: "https://p.com/v.mp4" },
      youtube: { thumbnail: "https://y.com/t.jpg", othermedia: "https://y.com/a.jpg||https://y.com/b.jpg" },
      gdn: { image_url_original: "https://g.com/o.jpg" },
      google: { ad_image: "https://g.com/a.jpg", video_url_original: "https://g.com/v.mp4", othermultimedia: "https://g.com/m.jpg" },
    };
    const expected = {
      pinterest: ["p.com/i.jpg", "p.com/v.mp4"],
      youtube: ["y.com/t.jpg", "y.com/a.jpg", "y.com/b.jpg"],
      gdn: ["g.com/o.jpg"],
      google: ["g.com/a.jpg", "g.com/v.mp4", "g.com/m.jpg"],
    };
    for (const [network, ad] of Object.entries(cases)) {
      expect(extract(ad, resolveFields(network, {})).urls.sort()).toEqual(expected[network].sort());
    }
  });

  it("does not treat reddit_id (the discovering user) as the advertiser", () => {
    const x = extract({ ad_id: "1", reddit_id: "some_user" }, fields);
    expect(x.advertisers).toEqual([]);
  });

  it("returns empty results for null, strings, arrays and empty objects", () => {
    for (const v of [null, undefined, "x", 5, [], {}]) {
      const x = extract(v, fields);
      expect(x).toMatchObject({ adIds: [], advertisers: [], urls: [], domains: [], rawAdId: null, rawAdvertiser: null });
    }
  });

  it("ignores wrong-typed field values without throwing", () => {
    const x = extract({ ad_id: {}, post_owner: ["a"], image_url: 7, other_multimedia: { a: 1 } }, fields);
    expect(x.adIds).toEqual([]);
    expect(x.advertisers).toEqual([]);
    expect(x.urls).toEqual([]);
  });

  it("caps the number of urls for a huge carousel", () => {
    const many = Array.from({ length: 1000 }, (_, i) => `https://x.com/${i}.jpg`).join("||");
    expect(extract({ other_multimedia: many }, fields).urls.length).toBeLessThanOrEqual(200);
  });
});

describe("compliance/blocklist > resolveFields", () => {
  it("uses defaults, then '*', then the network override", () => {
    expect(resolveFields("reddit", {}).adId).toEqual(DEFAULT_FIELDS.adId);
    const o = { "*": { adId: ["id"] }, reddit: { adId: ["rid"], advertiser: ["owner"] } };
    expect(resolveFields("quora", o).adId).toEqual(["id"]);
    expect(resolveFields("reddit", o).adId).toEqual(["rid"]);
    expect(resolveFields("reddit", o).advertiser).toEqual(["owner"]);
  });
  it("ignores malformed overrides", () => {
    const o = { reddit: { adId: "ad_id", advertiser: [1, null] } };
    expect(resolveFields("reddit", o).adId).toEqual(DEFAULT_FIELDS.adId);
  });
});
