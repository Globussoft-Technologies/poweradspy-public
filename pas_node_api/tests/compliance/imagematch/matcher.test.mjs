import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
const require = createRequire(import.meta.url);

const { decide } = require("../../../src/compliance/imagematch/matcher");
const { parseHash, toHex, hammingDistance } = require("../../../src/compliance/imagematch/matcher");
const { buildImageHashes } = require("../../../src/compliance/blocklist/match");

const V = "sscd-simhash-v1";
const sha = (c) => c.repeat(64);

/** A hash `bits` bits away from `base` (flips the lowest bits of the words in turn). */
function away(baseHex, bits) {
  const w = parseHash(baseHex);
  for (let i = 0; i < bits; i += 1) w[i % 8] ^= 1 << Math.floor(i / 8);
  return w;
}
const BASE = "460e931b54bbbb9667c97c9459eed7c8f2439b62c259c021fefb559058f57304";

const row = (id, shaChar, phash = BASE, algo = V) => ({ id, image_sha256: sha(shaChar), image_phash: phash, image_phash_algo: algo });
const banned = (rows, over = {}) => ({ available: true, status: "ready", hashes: buildImageHashes(rows), ...over });
const opts = (perceptual = {}) => ({ hashVersion: V, perceptual: { enabled: true, rejectDistance: 10, reviewDistance: 30, ...perceptual } });
const img = (shaChar, words) => ({ sha256: sha(shaChar), words });

describe("imagematch/matcher > the list cannot be trusted", () => {
  it("returns 'unavailable' for a missing, unavailable or malformed list, so the caller applies its fail mode", () => {
    for (const bad of [null, undefined, {}, { available: false, hashes: [] }, { available: true }, { available: true, hashes: "x" }]) {
      expect(decide(bad, img("a", parseHash(BASE)), opts())).toEqual({ action: "unavailable" });
    }
  });

  it("allows everything when the list is empty", () => {
    expect(decide(banned([]), img("a", parseHash(BASE)), opts())).toEqual({ action: "allow", kind: null, distance: null, entry: null });
  });
});

describe("imagematch/matcher > exact copies (sha256)", () => {
  it("rejects an image whose sha256 is on the list, with the banned entry", () => {
    const out = decide(banned([row(1, "a")]), img("a", null), opts());
    expect(out).toMatchObject({ action: "reject", kind: "sha256", distance: null, entry: { id: 1 } });
  });

  it("an exact copy is rejected even when near-copy matching is off or the version differs", () => {
    const list = banned([row(1, "a", BASE, "other-v9")]);
    expect(decide(list, img("a", null), { hashVersion: V, perceptual: { enabled: false } })).toMatchObject({ action: "reject", kind: "sha256" });
    expect(decide(list, img("a", parseHash(BASE)), opts())).toMatchObject({ action: "reject", kind: "sha256" });
    expect(decide(list, img("a", null), {})).toMatchObject({ action: "reject", kind: "sha256" });
  });

  it("an exact copy wins over a nearer-looking perceptual match", () => {
    const list = banned([row(1, "a", "f".repeat(64)), row(2, "b", BASE)]);
    expect(decide(list, img("a", parseHash(BASE)), opts())).toMatchObject({ action: "reject", kind: "sha256", entry: { id: 1 } });
  });

  it("matches a banned image that has no perceptual hash", () => {
    const list = banned([{ id: 3, image_sha256: sha("c"), image_phash: null, image_phash_algo: null }]);
    expect(decide(list, img("c", null), opts())).toMatchObject({ action: "reject", kind: "sha256", entry: { id: 3 } });
  });

  it("does not match a different sha256, and ignores a missing or non-string one", () => {
    const list = banned([row(1, "a")]);
    for (const image of [img("b", null), { words: null }, { sha256: undefined }, { sha256: 5 }, null, undefined]) {
      expect(decide(list, image, { hashVersion: V, perceptual: { enabled: false } }).action).toBe("allow");
    }
  });
});

describe("imagematch/matcher > near copies (perceptual hash)", () => {
  const list = banned([row(1, "a")]);

  it("rejects within rejectDistance, reviews within reviewDistance, allows beyond", () => {
    expect(decide(list, img("z", away(BASE, 0)), opts())).toMatchObject({ action: "reject", kind: "phash", distance: 0, entry: { id: 1 } });
    expect(decide(list, img("z", away(BASE, 10)), opts())).toMatchObject({ action: "reject", kind: "phash", distance: 10 });
    expect(decide(list, img("z", away(BASE, 11)), opts())).toMatchObject({ action: "review", kind: "phash", distance: 11, entry: { id: 1 } });
    expect(decide(list, img("z", away(BASE, 30)), opts())).toMatchObject({ action: "review", distance: 30 });
    expect(decide(list, img("z", away(BASE, 31)), opts())).toMatchObject({ action: "allow", kind: null, distance: 31, entry: null });
  });

  it("the distance it reports is the real number of different bits", () => {
    const words = away(BASE, 17);
    expect(hammingDistance(words, parseHash(BASE))).toBe(17);
    expect(decide(list, img("z", words), opts()).distance).toBe(17);
  });

  it("with the defaults (both distances 0) only an identical hash is rejected", () => {
    const o = { hashVersion: V, perceptual: { enabled: true, rejectDistance: 0, reviewDistance: 0 } };
    expect(decide(list, img("z", away(BASE, 0)), o).action).toBe("reject");
    expect(decide(list, img("z", away(BASE, 1)), o).action).toBe("allow");
  });

  it("a reviewDistance below rejectDistance is treated as equal to it (never reviews less than it rejects)", () => {
    const o = opts({ rejectDistance: 20, reviewDistance: 5 });
    expect(decide(list, img("z", away(BASE, 20)), o).action).toBe("reject");
    expect(decide(list, img("z", away(BASE, 21)), o).action).toBe("allow");
  });

  it("picks the closest banned image, so the nearest entry is reported when reviewing", () => {
    const list2 = banned([row(1, "a", toHex(away(BASE, 25))), row(2, "b", toHex(away(BASE, 12)))]);
    expect(decide(list2, img("z", parseHash(BASE)), opts())).toMatchObject({ action: "review", distance: 12, entry: { id: 2 } });
  });

  it("is off unless enabled is exactly true: an exact copy is still caught, a near copy is not", () => {
    for (const enabled of [false, undefined, "true", 1]) {
      const o = { hashVersion: V, perceptual: { enabled, rejectDistance: 256, reviewDistance: 256 } };
      expect(decide(list, img("z", away(BASE, 0)), o).action).toBe("allow");
    }
    expect(decide(list, img("z", away(BASE, 0)), { hashVersion: V }).action).toBe("allow");
  });

  it("allows an image with no perceptual hash, and an options object with no hash version", () => {
    expect(decide(list, img("z", null), opts()).action).toBe("allow");
    expect(decide(list, img("z", parseHash(BASE)), { perceptual: { enabled: true, rejectDistance: 256 } }).action).toBe("allow");
  });

  it("never compares hashes of different versions", () => {
    const other = banned([row(1, "a", BASE, "sscd-simhash-v2")]);
    expect(decide(other, img("z", parseHash(BASE)), opts()).action).toBe("allow");
    // the configured version is matched case-insensitively
    expect(decide(list, img("z", parseHash(BASE)), { ...opts(), hashVersion: "SSCD-SimHash-V1" }).action).toBe("reject");
  });

  it("ignores banned images without a perceptual hash or version when comparing", () => {
    const mixed = banned([
      { id: 1, image_sha256: sha("a"), image_phash: null, image_phash_algo: null },
      row(2, "b", BASE, V),
    ]);
    expect(decide(mixed, img("z", parseHash(BASE)), opts())).toMatchObject({ action: "reject", entry: { id: 2 } });
  });

  it("does not change the hashes it is given", () => {
    const words = away(BASE, 3);
    const copy = Uint32Array.from(words);
    const l = banned([row(1, "a")]);
    const before = Uint32Array.from(l.hashes[0].phash);
    decide(l, img("z", words), opts());
    expect([...words]).toEqual([...copy]);
    expect([...l.hashes[0].phash]).toEqual([...before]);
  });

  it("sees a new list (a refreshed array) and not the old one", () => {
    const first = banned([row(1, "a")]);
    const second = banned([row(2, "b")]);
    expect(decide(first, img("b", null), opts()).action).toBe("allow");
    expect(decide(second, img("b", null), opts())).toMatchObject({ action: "reject", entry: { id: 2 } });
    expect(decide(first, img("a", null), opts())).toMatchObject({ action: "reject", entry: { id: 1 } });
  });

  it("stays fast with many banned images (the comparison is in memory)", () => {
    const rows = Array.from({ length: 20000 }, (_, i) => row(i + 1, (i % 16).toString(16), toHex(away(BASE, (i % 200) + 40))));
    const big = banned(rows);
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 20; i += 1) decide(big, img("z", parseHash(BASE)), opts({ rejectDistance: 5, reviewDistance: 20 }));
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    expect(ms / 20).toBeLessThan(50); // generous bound: a few ms in practice for 20,000 banned images
  });
});

describe("imagematch hash arithmetic", () => {
const { cleanHex, parseHash, toHex, popcount32, hammingDistance, BITS } = require("../../../src/compliance/imagematch/matcher");

// A real answer from the service (sscd-simhash-v1, 256 bits).
const SAMPLE = "460e931b54bbbb9667c97c9459eed7c8f2439b62c259c021fefb559058f57304";

const bigPopcount = (n) => n.toString(2).split("").filter((c) => c === "1").length;

describe("imagematch/hash > parseHash and toHex", () => {
  it("reads the service's 64-hex hash as 8 words and writes it back unchanged", () => {
    const words = parseHash(SAMPLE);
    expect(words).toBeInstanceOf(Uint32Array);
    expect(words.length).toBe(8);
    expect(words[0]).toBe(0x460e931b);
    expect(words[7]).toBe(0x58f57304);
    expect(toHex(words)).toBe(SAMPLE);
  });

  it("accepts upper case and surrounding spaces, and gives back lower case", () => {
    expect(toHex(parseHash(`  ${SAMPLE.toUpperCase()}\n`))).toBe(SAMPLE);
    expect(cleanHex(` ${SAMPLE.toUpperCase()} `)).toBe(SAMPLE);
  });

  it("keeps words above 2^31 as positive numbers", () => {
    const words = parseHash("f".repeat(64));
    expect([...words].every((w) => w === 0xffffffff)).toBe(true);
    expect(toHex(words)).toBe("f".repeat(64));
  });

  it("keeps leading zeros", () => {
    const hex = "0000000a" + "00000000".repeat(6) + "00000001";
    expect(toHex(parseHash(hex))).toBe(hex);
  });

  it("rejects anything that is not exactly 64 hex characters", () => {
    for (const bad of [
      null, undefined, "", "abc", 123, {}, [], SAMPLE.slice(1), `${SAMPLE}0`, "g".repeat(64),
      `${SAMPLE.slice(0, 63)}z`, "9223372036854775809", // a decimal 64-bit hash from the old design
    ]) {
      expect(parseHash(bad)).toBeNull();
      expect(cleanHex(bad)).toBe("");
    }
  });

  it("toHex returns '' for anything that is not 8 words", () => {
    for (const bad of [null, undefined, [], new Uint32Array(4), new Uint32Array(9), "x"]) expect(toHex(bad)).toBe("");
  });
});

describe("imagematch/hash > popcount32", () => {
  it("counts the set bits of a 32-bit word", () => {
    expect(popcount32(0)).toBe(0);
    expect(popcount32(1)).toBe(1);
    expect(popcount32(0xffffffff)).toBe(32);
    expect(popcount32(0x80000000)).toBe(1);
    expect(popcount32(0xaaaaaaaa)).toBe(16);
    expect(popcount32(0x0f0f0f0f)).toBe(16);
  });

  it("agrees with a plain bit count for many random words, including negative inputs", () => {
    for (let i = 0; i < 2000; i += 1) {
      const v = randomBytes(4).readUInt32BE(0);
      expect(popcount32(v)).toBe(bigPopcount(BigInt(v)));
      expect(popcount32(v | 0)).toBe(bigPopcount(BigInt(v))); // the same bits as a signed int
    }
  });
});

describe("imagematch/hash > hammingDistance", () => {
  it("is 0 for the same hash and 256 for opposite hashes", () => {
    expect(hammingDistance(parseHash(SAMPLE), parseHash(SAMPLE))).toBe(0);
    expect(hammingDistance(parseHash("0".repeat(64)), parseHash("f".repeat(64)))).toBe(BITS);
    expect(BITS).toBe(256);
  });

  it("counts single bit differences, in the first and in the last word", () => {
    const base = parseHash(SAMPLE);
    const first = Uint32Array.from(base); first[0] ^= 1;
    const last = Uint32Array.from(base); last[7] ^= 0x80000000;
    expect(hammingDistance(base, first)).toBe(1);
    expect(hammingDistance(base, last)).toBe(1);
    expect(hammingDistance(first, last)).toBe(2);
  });

  it("is symmetric and agrees with a BigInt calculation for random pairs", () => {
    for (let i = 0; i < 300; i += 1) {
      const a = randomBytes(32).toString("hex");
      const b = randomBytes(32).toString("hex");
      const expected = bigPopcount(BigInt(`0x${a}`) ^ BigInt(`0x${b}`));
      const pa = parseHash(a);
      const pb = parseHash(b);
      expect(hammingDistance(pa, pb)).toBe(expected);
      expect(hammingDistance(pb, pa)).toBe(expected);
    }
  });

  it("does not change its inputs", () => {
    const a = parseHash(SAMPLE);
    const b = parseHash("f".repeat(64));
    const copyA = Uint32Array.from(a);
    hammingDistance(a, b);
    expect([...a]).toEqual([...copyA]);
  });

  it("is Infinity (never a match) when either side is missing or not 8 words", () => {
    const ok = parseHash(SAMPLE);
    for (const bad of [null, undefined, new Uint32Array(7), [], "x"]) {
      expect(hammingDistance(ok, bad)).toBe(Infinity);
      expect(hammingDistance(bad, ok)).toBe(Infinity);
    }
  });
});
});

describe("imagematch image URL", () => {
const { toFetchableUrl } = require("../../../src/compliance/imagematch/sources");

const BASE = "https://media.globussoft.com/pas-dev/stream";

describe("imagematch/url > toFetchableUrl", () => {
  it("joins the CDN base and a stored NAS path with exactly one slash", () => {
    const want = "https://media.globussoft.com/pas-dev/stream/fb/adImage/202610/134193.jpeg";
    const results = [
      toFetchableUrl("fb/adImage/202610/134193.jpeg", BASE),
      toFetchableUrl("/fb/adImage/202610/134193.jpeg", BASE),
      toFetchableUrl("fb/adImage/202610/134193.jpeg", `${BASE}/`),
      toFetchableUrl("//fb/adImage/202610/134193.jpeg", `${BASE}//`),
    ];
    for (const r of results) {
      expect(r).toBe(want);
      expect(r).not.toMatch(/[^:]\/\//); // no double slash after the scheme: it is a 404 on that CDN
    }
  });

  it("keeps an absolute URL as it is", () => {
    expect(toFetchableUrl("https://cdn.example.com/a/b.jpg?x=1", BASE)).toBe("https://cdn.example.com/a/b.jpg?x=1");
    expect(toFetchableUrl("http://cdn.example.com/a.png", "")).toBe("http://cdn.example.com/a.png");
  });

  it("drops the old prefixes that are not part of the CDN path", () => {
    for (const stored of [
      "/PowerAdspy/n2/fb/adImage/1.jpg", "PowerAdspy-Dev/fb/adImage/1.jpg", "/pas-dev/stream/fb/adImage/1.jpg",
      "pas-prod/stream/fb/adImage/1.jpg",
    ]) {
      expect(toFetchableUrl(stored, BASE)).toBe(`${BASE}/fb/adImage/1.jpg`);
    }
  });

  it("keeps /PowerAdspy/fb/<folder>/<year>/<file> as it is, as the services do", () => {
    expect(toFetchableUrl("/PowerAdspy/fb/adImage/2024/1.jpg", BASE)).toBe(`${BASE}/PowerAdspy/fb/adImage/2024/1.jpg`);
    expect(toFetchableUrl("PowerAdspy/fb/thumb/1.jpg", BASE)).toBe(`${BASE}/PowerAdspy/fb/thumb/1.jpg`);
  });

  it("uses the first usable URL when two are joined with '||'", () => {
    expect(toFetchableUrl("fb/a/1.jpg||/PowerAdspy/n2/fb/a/2.jpg", BASE)).toBe(`${BASE}/fb/a/1.jpg`);
    expect(toFetchableUrl("||fb/a/2.jpg", BASE)).toBe(`${BASE}/fb/a/2.jpg`);
    expect(toFetchableUrl(" || https://x.example.com/p.jpg", BASE)).toBe("https://x.example.com/p.jpg");
  });

  it("returns '' for a relative path when there is no CDN base, and for unusable input", () => {
    expect(toFetchableUrl("fb/a/1.jpg", "")).toBe("");
    expect(toFetchableUrl("fb/a/1.jpg", undefined)).toBe("");
    for (const bad of [null, undefined, "", "   ", "||", 5, {}, []]) expect(toFetchableUrl(bad, BASE)).toBe("");
  });
});
});

// ── the exact-copy check at ingestion ─────────────────────────────────────────────────────────────
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import nodeFs from "node:fs";
import nodeOs from "node:os";
import nodePath from "node:path";
import nodeHttp from "node:http";
import { createHash } from "node:crypto";

const { sha256OfFile, createFileGuard } = require("../../../src/compliance/imagematch/matcher");
const matcherModule = require("../../../src/compliance/imagematch/matcher");
const { rejected } = require("../../../src/insertion/helpers/responses");

const IMAGE_BYTES = Buffer.from("pretend this is a banned image".repeat(60));
const IMAGE_SHA = createHash("sha256").update(IMAGE_BYTES).digest("hex");

describe("guardFile: the exact-copy check of a downloaded file", () => {
  let dir;
  let file;
  beforeEach(() => {
    dir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "guard-"));
    file = nodePath.join(dir, "a.webp");
    nodeFs.writeFileSync(file, IMAGE_BYTES);
  });
  afterEach(() => { vi.restoreAllMocks(); nodeFs.rmSync(dir, { recursive: true, force: true }); });

  function build({ enabled = true, available = true, hashes = [{ id: 7, sha256: IMAGE_SHA, phash: null, algo: null }], now } = {}) {
    const blocklist = {
      getImageHashes: vi.fn(() => ({ available, status: available ? "ready" : "unavailable", hashes })),
      recordAttempt: vi.fn(() => true),
    };
    const log = { warn: vi.fn() };
    const config = { compliance: { imageMatch: { enabled }, blocklist: { response: { code: 422, message: "Ad rejected: this content is not allowed." } } } };
    const guard = createFileGuard({ config, blocklist, responses: { rejected }, log, now });
    return { guard, blocklist, log };
  }

  it("sha256OfFile is the SHA-256 of the file's bytes, and a missing file is an error", async () => {
    expect(await sha256OfFile(file)).toBe(IMAGE_SHA);
    await expect(sha256OfFile(nodePath.join(dir, "missing.webp"))).rejects.toThrow(/ENOENT/);
  });

  it("refuses an exact copy of a banned image with the same answer as a blocked name, and logs the attempt", async () => {
    const { guard, blocklist } = build();
    const out = await guard("facebook", file, { imageUrl: "https://cdn.example.com/x.jpg" });
    expect(out.entry.id).toBe(7);
    expect(out.rejection).toEqual({ code: 422, status: "rejected", message: "Ad rejected: this content is not allowed.", hint: "This content cannot be accepted. Do not resend it." });
    expect(blocklist.recordAttempt).toHaveBeenCalledWith({ network: "facebook", imageUrl: "https://cdn.example.com/x.jpg", blocklistId: 7, matchType: "sha256", source: "ingestion:facebook" });
  });

  it("lets any other file through, and logs nothing", async () => {
    const { guard, blocklist } = build({ hashes: [{ id: 7, sha256: "a".repeat(64), phash: null, algo: null }] });
    expect(await guard("facebook", file)).toBeNull();
    expect(blocklist.recordAttempt).not.toHaveBeenCalled();
  });

  it("only an EXACT copy is decided here: a near copy is left to the background sweep", async () => {
    const near = parseHash("460e931b54bbbb9667c97c9459eed7c8f2439b62c259c021fefb559058f57304");
    const { guard } = build({ hashes: [{ id: 7, sha256: "a".repeat(64), phash: near, algo: V }] });
    expect(await guard("facebook", file)).toBeNull();
  });

  it("does no work at all while it is switched off: the banned list is not even asked, the file is not read", async () => {
    const reads = vi.spyOn(nodeFs, "createReadStream");
    const { guard, blocklist } = build({ enabled: false });
    expect(await guard("facebook", file)).toBeNull();
    expect(blocklist.getImageHashes).not.toHaveBeenCalled();
    expect(reads).not.toHaveBeenCalled();
  });

  it("does not read the file when nothing is banned for the network", async () => {
    const reads = vi.spyOn(nodeFs, "createReadStream");
    const { guard } = build({ hashes: [] });
    expect(await guard("facebook", file)).toBeNull();
    expect(reads).not.toHaveBeenCalled();
  });

  it("when the banned images could not be loaded the ad is not refused for that (fail open), and the warning is not repeated every ad", async () => {
    let now = 1_000_000;
    const { guard, log } = build({ available: false, now: () => now });
    expect(await guard("facebook", file)).toBeNull();
    expect(await guard("facebook", file)).toBeNull();
    expect(log.warn).toHaveBeenCalledTimes(1);
    now += 61_000;
    await guard("facebook", file);
    expect(log.warn).toHaveBeenCalledTimes(2);
  });

  it("never throws: an unreadable file or a failing list means go on, with a warning", async () => {
    const { guard, log } = build();
    expect(await guard("facebook", nodePath.join(dir, "gone.webp"))).toBeNull();
    expect(log.warn).toHaveBeenCalledTimes(1);
    const broken = createFileGuard({ config: { compliance: { imageMatch: { enabled: true } } }, blocklist: { getImageHashes: () => { throw new Error("boom"); } }, log: { warn() {} } });
    expect(await broken("facebook", file)).toBeNull();
    expect(await build()["guard"]("facebook", "")).toBeNull();
    expect(await build()["guard"]("facebook", undefined)).toBeNull();
  });

  it("costs about a millisecond or two for a typical image, even against 100,000 banned images", async () => {
    const big = nodePath.join(dir, "big.jpg");
    nodeFs.writeFileSync(big, Buffer.alloc(300 * 1024, 5));
    const hashes = Array.from({ length: 100000 }, (_, i) => ({ id: i + 1, sha256: createHash("sha256").update(String(i)).digest("hex"), phash: null, algo: null }));
    const { guard } = build({ hashes });
    await guard("facebook", big); // first call builds the lookup
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 20; i += 1) await guard("facebook", big);
    const perCallMs = Number(process.hrtime.bigint() - t0) / 1e6 / 20;
    expect(perCallMs).toBeLessThan(50);
  });
});

describe("fetchPrimaryMedia with the image check (the one place all gated pipelines go through)", () => {
  const media = require("../../../src/insertion/helpers/mediaUpload");
  let server;
  let base;
  const mine = () => nodeFs.readdirSync(nodeOs.tmpdir()).filter((f) => f.startsWith(`ins_${process.pid}_`));

  beforeAll(async () => {
    server = nodeHttp.createServer((req, res) => { res.setHeader("content-type", "image/jpeg"); res.end(IMAGE_BYTES); });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  afterAll(() => new Promise((resolve) => server.close(resolve)));
  afterEach(() => vi.restoreAllMocks());

  it("a banned image: not ok, reason 'blocked', the ready-made rejection, and the temp file is removed", async () => {
    const before = mine().length;
    const guard = vi.spyOn(matcherModule, "guardFile").mockResolvedValue({ entry: { id: 3 }, rejection: { code: 422, status: "rejected", message: "no" } });
    const out = await media.fetchPrimaryMedia({ type: "IMAGE", imageUrl: `${base}/a.jpg` }, "facebook");
    expect(out).toEqual({ ok: false, type: "IMAGE", reason: "blocked", rejection: { code: 422, status: "rejected", message: "no" } });
    expect(guard).toHaveBeenCalledWith("facebook", expect.stringMatching(/ins_\d+_\d+_\d+\./), { imageUrl: `${base}/a.jpg` });
    expect(mine().length).toBe(before);
  });

  it("a video: its thumbnail is the file that is checked", async () => {
    const guard = vi.spyOn(matcherModule, "guardFile").mockResolvedValue({ entry: { id: 3 }, rejection: { code: 422, status: "rejected", message: "no" } });
    const out = await media.fetchPrimaryMedia({ type: "VIDEO", videoUrl: `${base}/v.mp4`, thumbnailUrl: `${base}/t.jpg` }, "instagram");
    expect(out).toMatchObject({ ok: false, type: "VIDEO", reason: "blocked" });
    expect(guard).toHaveBeenCalledWith("instagram", expect.any(String), { imageUrl: `${base}/t.jpg` });
  });

  it("an image that is not banned goes on exactly as before, with its temp file for the upload", async () => {
    vi.spyOn(matcherModule, "guardFile").mockResolvedValue(null);
    const out = await media.fetchPrimaryMedia({ type: "IMAGE", imageUrl: `${base}/a.jpg` }, "facebook");
    expect(out.ok).toBe(true);
    expect(nodeFs.readFileSync(out.image).equals(IMAGE_BYTES)).toBe(true);
    media.cleanupFetched(out);
    expect(nodeFs.existsSync(out.image)).toBe(false);
  });

  it("with the real check and the feature off (the default) nothing changes", async () => {
    const out = await media.fetchPrimaryMedia({ type: "IMAGE", imageUrl: `${base}/a.jpg` }, "facebook");
    expect(out.ok).toBe(true);
    expect(out.rejection).toBeUndefined();
    media.cleanupFetched(out);
  });

  it("a download that failed is still the old 'image' reason, and nothing is checked", async () => {
    const guard = vi.spyOn(matcherModule, "guardFile");
    const out = await media.fetchPrimaryMedia({ type: "IMAGE", imageUrl: "http://127.0.0.1:1/none.jpg" }, "facebook");
    expect(out).toMatchObject({ ok: false, reason: "image" });
    expect(guard).not.toHaveBeenCalled();
  });

  it("the six pipelines return the ready-made rejection before their own 'could not be downloaded' answer", () => {
    const root = nodePath.resolve(import.meta.dirname, "../../../src/services");
    for (const rel of [
      "facebook/insertion/metaAdsPipeline.js", "facebook/insertion/adsLibraryPipeline.js",
      "instagram/insertion/adsLibraryPipeline.js", "instagram/insertion/gramAdsPipeline.js",
      "chatgptads/insertion/chatgptadsPipeline.js", "admob/insertion/pipeline.js",
    ]) {
      const source = nodeFs.readFileSync(nodePath.join(root, rel), "utf8");
      const ours = source.indexOf("if (fetched.rejection) return fetched.rejection;");
      expect(ours, rel).toBeGreaterThan(-1);
      expect(ours, rel).toBeLessThan(source.indexOf("if (!fetched.ok) {"));
    }
  });
});
