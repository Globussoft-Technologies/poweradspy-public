import { describe, it, expect } from "vitest";
import { extract, resolveFields, DEFAULT_FIELDS } from "../../../core/blocklist/blocklist.extract.js";

const fields = resolveFields({});

describe("blocklist.extract > extract", () => {
  it("pulls the ad id, advertiser, urls and domains out of a TikTok payload", () => {
    const x = extract({
      ad_id: " 7569968978819874817 ",
      post_owner: "Acme  Corp",
      tiktok_account_name: "AcmeOfficial",
      tiktok_account_id: "acct-1",
      video_cover: "https://p16.tiktokcdn.com/cover.webp?sig=1",
      video_url: "https://v16.tiktokcdn.com/video/tos/a.mp4?x=1",
      destination_url: "https://shop.example.com/p?id=1",
      library_url: "https://ads.tiktok.com/business/creativecenter/topads/7569968978819874817/pc/en",
    }, fields);
    expect(x.adIds).toEqual(["7569968978819874817"]);
    expect(x.advertisers).toEqual(["acme corp", "acmeofficial", "acct-1"]);
    expect(x.urls).toEqual(expect.arrayContaining([
      "p16.tiktokcdn.com/cover.webp", "v16.tiktokcdn.com/video/tos/a.mp4", "shop.example.com/p",
    ]));
    expect(x.domains).toEqual(["shop.example.com", "example.com"]);
  });

  it("does not match on library_url (TikTok's own page, not the creative)", () => {
    const x = extract({ ad_id: "1", library_url: "https://ads.tiktok.com/x" }, fields);
    expect(x.urls).toEqual([]);
  });

  it("returns empty results for null, strings, arrays and empty objects", () => {
    for (const v of [null, undefined, "x", 5, [], {}]) {
      expect(extract(v, fields)).toMatchObject({ adIds: [], advertisers: [], urls: [], domains: [], rawAdId: null });
    }
  });

  it("ignores wrong-typed field values without throwing", () => {
    const x = extract({ ad_id: {}, post_owner: ["a"], video_cover: 7, destination_url: { a: 1 } }, fields);
    expect(x.adIds).toEqual([]);
    expect(x.advertisers).toEqual([]);
    expect(x.urls).toEqual([]);
  });
});

describe("blocklist.extract > resolveFields", () => {
  it("uses the defaults, then the configured override", () => {
    expect(resolveFields({}).adId).toEqual(DEFAULT_FIELDS.adId);
    const o = resolveFields({ adId: ["id"], advertiser: ["owner"] });
    expect(o.adId).toEqual(["id"]);
    expect(o.advertiser).toEqual(["owner"]);
    expect(o.imageUrls).toEqual(DEFAULT_FIELDS.imageUrls);
  });
  it("ignores malformed overrides", () => {
    expect(resolveFields({ adId: "ad_id", advertiser: [1, null] }).adId).toEqual(DEFAULT_FIELDS.adId);
    expect(resolveFields("nope").adId).toEqual(DEFAULT_FIELDS.adId);
  });
});
