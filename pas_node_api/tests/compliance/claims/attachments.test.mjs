import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
const require = createRequire(import.meta.url);

const A = require("../../../src/compliance/claims/attachments");

const CLAIM = "11111111-1111-4111-8111-111111111111";
const silent = { info() {}, warn() {}, error() {} };

// ── files on disk, with real magic bytes ──
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claimfiles-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
let n = 0;
const filler = (seed) => Buffer.from(`filler-${seed}-${n++}-`.repeat(8));
const BYTES = {
  pdf: (seed = "a") => Buffer.concat([Buffer.from("%PDF-1.4\n"), filler(seed)]),
  jpg: (seed = "a") => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), filler(seed)]),
  png: (seed = "a") => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), filler(seed)]),
  webp: (seed = "a") => Buffer.concat([Buffer.from("RIFF"), Buffer.from([1, 2, 3, 4]), Buffer.from("WEBP"), filler(seed)]),
};
function put(bytes, name = `f${n++}`) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, bytes);
  return p;
}
const file = (type, originalName, seed) => ({ path: put(BYTES[type](seed)), originalName: originalName ?? `evidence.${type}` });

// ── fakes ──
function fakeRepo() {
  const rows = new Map();
  const keyOf = (c, f) => `${c}/${f}`;
  return {
    rows,
    async insertFile(_sql, r) {
      for (const x of rows.values()) if (x.complaint_id === r.complaintId && x.sha256 === r.sha256) return false;
      rows.set(keyOf(r.complaintId, r.fileId), {
        complaint_id: r.complaintId, file_id: r.fileId, storage: r.storage, bucket: r.bucket, file_key: r.fileKey, original_name: r.originalName,
        kind: r.kind, mime: r.mime, size_bytes: r.sizeBytes, sha256: r.sha256, scan_status: r.scanStatus, status: "stored", uploaded_at: "2026-11-03 10:00:00",
      });
      return true;
    },
    async findBySha(_s, c, sha) { return [...rows.values()].find((x) => x.complaint_id === c && x.sha256 === sha) || null; },
    async countFiles(_s, c) { return [...rows.values()].filter((x) => x.complaint_id === c && x.status === "stored").length; },
    async getFile(_s, c, f) { return rows.get(keyOf(c, f)) || null; },
    async listFiles(_s, c) { return [...rows.values()].filter((x) => x.complaint_id === c && x.status === "stored"); },
    async markDeleted(_s, c, f) { const r = rows.get(keyOf(c, f)); if (r) r.status = "deleted"; return Boolean(r); },
  };
}
function fakeTransport(over = {}) {
  return {
    configured: () => true,
    put: vi.fn(async () => ({ ok: true, status: 200, path: "/pas-claims/stream/x" })),
    get: vi.fn(async () => ({ ok: true, status: 200, stream: Readable.from([Buffer.from("%PDF-1.4 data")]) })),
    del: vi.fn(async () => ({ ok: true, status: 200 })),
    ...over,
  };
}
const SETTINGS = { enabled: true, bucket: "pas-claims", maxFiles: 5, maxFileBytes: 5 * 1024 * 1024, allowedTypes: ["pdf", "jpg", "png", "webp"], scan: { required: false } };
function build({ settings = {}, transport = fakeTransport(), repo = fakeRepo(), scanner } = {}) {
  const ids = (function* () { let i = 0; while (true) yield `00000000-0000-4000-8000-${String(++i).padStart(12, "0")}`; })();
  const service = A.createAttachmentService({ settings: { ...SETTINGS, ...settings }, transport, repo, scanner, log: silent, now: () => new Date("2026-11-03T10:00:00Z"), randomId: () => ids.next().value });
  return { service, transport, repo };
}
const SQL = { fake: true };
const MS = new Date("2026-11-03T10:00:00Z").getTime();
const KEY_OF_CLAIM = new RegExp(`^copyrightdoc/112026/${CLAIM}/\\d+$`);

describe("claims/attachments > file checks", () => {
  it("knows a file by its bytes: pdf, jpg, png, webp, and nothing else", () => {
    expect(A.detectType(BYTES.pdf())).toBe("pdf");
    expect(A.detectType(BYTES.jpg())).toBe("jpg");
    expect(A.detectType(BYTES.png())).toBe("png");
    expect(A.detectType(BYTES.webp())).toBe("webp");
    expect(A.detectType(Buffer.from("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(A.detectType(Buffer.from("MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00"))).toBeNull(); // an executable
    expect(A.detectType(Buffer.from("%PDF"))).toBeNull(); // too short to be sure
    expect(A.detectType(null)).toBeNull();
  });

  it("cleans a person's file name, and reads the extension it claims", () => {
    expect(A.cleanName("../../etc/passwd")).toBe("passwd");
    expect(A.cleanName("C:\\Users\\x\\proof.pdf")).toBe("proof.pdf");
    expect(A.cleanName("a\u0000b\nc.pdf")).toBe("a b c.pdf");
    expect(A.cleanName("")).toBe("file");
    expect(A.cleanName("x".repeat(400))).toHaveLength(255);
    expect(A.declaredExtension("Proof.PDF")).toBe("pdf");
    expect(A.declaredExtension("photo.jpeg")).toBe("jpg");
    expect(A.declaredExtension("noextension")).toBe("");
  });

  it("makes the storage key exactly in the layout of the private bucket: copyrightdoc/<MMYYYY>/<complaintId>/<timestamp>", () => {
    const key = A.keyFor("22222222-2222-4222-8222-222222222222", new Date("2026-11-03T10:00:00Z"));
    expect(key).toBe(`copyrightdoc/112026/22222222-2222-4222-8222-222222222222/${MS}`);
    expect(A.keyFor("22222222-2222-4222-8222-222222222222", MS)).toBe(key); // a number of milliseconds works as well as a Date
    expect(key).not.toMatch(/[^A-Za-z0-9._\/-]/); // only what the NAS allows in a key
    expect(A.keyFor(CLAIM, new Date("2027-01-05T23:59:59Z"))).toMatch(/^copyrightdoc\/012027\//); // month first, then year, in UTC
    expect(A.keyFor(CLAIM.toUpperCase(), MS)).toContain(`/${CLAIM}/`); // the claim id in lower case
    expect(A.keyFor(CLAIM)).toMatch(new RegExp(`^copyrightdoc/\\d{6}/${CLAIM}/\\d{13}$`)); // now, by default
  });

  it("sends a file as a download only: attachment, nosniff, never cached, sandboxed", () => {
    const h = A.downloadHeaders({ original_name: 'My "proof"; file.pdf', file_key: "copyrightdoc/112026/x/1.pdf" });
    expect(h["Content-Type"]).toBe("application/pdf");
    expect(h["Content-Disposition"]).toMatch(/^attachment; filename="My _proof__ file\.pdf"; filename\*=UTF-8''/);
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Cache-Control"]).toBe("no-store");
    expect(h["Content-Security-Policy"]).toMatch(/sandbox/);
  });
});

describe("claims/attachments > storing the files of a claim", () => {
  it("stores each file under copyrightdoc/<MMYYYY>/<claim>/<timestamp>, checks it by its bytes, and records it; nothing about the person or the advertiser is in the key", async () => {
    const { service, transport, repo } = build();
    const out = await service.addFiles({ sql: SQL, complaintId: CLAIM, files: [file("pdf", "Notice of claim.pdf", "p"), file("png", "screenshot.png", "s")] });
    expect(out.ok).toBe(true);
    expect(out.results.map((r) => [r.ok, r.name])).toEqual([[true, "Notice of claim.pdf"], [true, "screenshot.png"]]);

    expect(transport.put).toHaveBeenCalledTimes(2);
    const [path1, key1, ext1] = transport.put.mock.calls[0];
    expect(key1).toBe(`copyrightdoc/112026/${CLAIM}/${MS}`);
    expect(ext1).toBe("pdf");
    expect(key1).not.toMatch(/Notice|claim\.pdf|Example/i);
    expect(transport.put.mock.calls[1][1]).toBe(`copyrightdoc/112026/${CLAIM}/${MS + 1}`); // the clock did not move, yet the second file got its own timestamp: the NAS would overwrite a shared key
    expect(fs.existsSync(path1)).toBe(true); // the caller's temp file is not touched

    const rows = [...repo.rows.values()];
    expect(rows[0]).toMatchObject({ storage: "nas", bucket: "pas-claims", file_key: `${key1}.pdf`, original_name: "Notice of claim.pdf", kind: "document", mime: "application/pdf", scan_status: "skipped", status: "stored" });
    expect(rows[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[1]).toMatchObject({ kind: "image", mime: "image/png" });
  });

  it("refuses an empty file, a too big file, a type that is not allowed, and a file that lies about its extension; uploads none of them", async () => {
    const { service, transport } = build({ settings: { maxFileBytes: 2000 } });
    const big = { path: put(Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(5000, 1)])), originalName: "big.pdf" };
    const html = { path: put(Buffer.from("<html><script>x</script></html>")), originalName: "proof.pdf" };
    const pdfAsPng = { path: put(BYTES.pdf("z")), originalName: "proof.png" };
    const exe = { path: put(Buffer.from("MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00 more")), originalName: "proof.exe" };
    const empty = { path: put(Buffer.alloc(0)), originalName: "empty.pdf" };
    const out = await service.addFiles({ sql: SQL, complaintId: CLAIM, files: [empty, big, html, pdfAsPng, exe] });
    expect(out.ok).toBe(false);
    expect(out.results.map((r) => r.reason)).toEqual(["empty", "too_large", "type_not_allowed", "extension_mismatch", "type_not_allowed"]);
    expect(transport.put).not.toHaveBeenCalled();
  });

  it("a type switched off in the settings is refused", async () => {
    const { service } = build({ settings: { allowedTypes: ["pdf"] } });
    const out = await service.addFiles({ sql: SQL, complaintId: CLAIM, files: [file("jpg", "a.jpg")] });
    expect(out.results[0]).toMatchObject({ ok: false, reason: "type_not_allowed" });
  });

  it("the same file twice for one claim is stored once (a retry is harmless)", async () => {
    const { service, transport, repo } = build();
    const same = BYTES.pdf("same");
    const first = await service.addFiles({ sql: SQL, complaintId: CLAIM, files: [{ path: put(same), originalName: "a.pdf" }] });
    const again = await service.addFiles({ sql: SQL, complaintId: CLAIM, files: [{ path: put(same), originalName: "b.pdf" }] });
    expect(again.results[0]).toMatchObject({ ok: true, duplicate: true, fileId: first.results[0].fileId });
    expect(transport.put).toHaveBeenCalledTimes(1);
    expect(repo.rows.size).toBe(1);
  });

  it("keeps to the number of files per claim, counting the ones already stored", async () => {
    const { service, transport } = build({ settings: { maxFiles: 2 } });
    const out = await service.addFiles({ sql: SQL, complaintId: CLAIM, files: [file("pdf", "1.pdf", "1"), file("pdf", "2.pdf", "2"), file("pdf", "3.pdf", "3")] });
    expect(out.results.map((r) => r.reason ?? "ok")).toEqual(["ok", "ok", "too_many_files"]);
    const later = await service.addFiles({ sql: SQL, complaintId: CLAIM, files: [file("pdf", "4.pdf", "4")] });
    expect(later.results[0].reason).toBe("too_many_files");
    expect(transport.put).toHaveBeenCalledTimes(2);
  });

  it("a failed upload is a failure: nothing is recorded, and one bad file does not stop the others", async () => {
    let call = 0;
    const transport = fakeTransport({ put: vi.fn(async () => (++call === 1 ? { ok: false, status: 500, error: "the NAS did not confirm the upload" } : { ok: true, status: 200, path: "/p" })) });
    const { service, repo } = build({ transport });
    const out = await service.addFiles({ sql: SQL, complaintId: CLAIM, files: [file("pdf", "1.pdf", "x1"), file("pdf", "2.pdf", "x2")] });
    expect(out.results.map((r) => r.reason ?? "ok")).toEqual(["storage_failed", "ok"]);
    expect(repo.rows.size).toBe(1);
  });

  it("if the record cannot be written, the file just uploaded is removed again (nothing points to it)", async () => {
    const repo = fakeRepo();
    repo.insertFile = async () => { throw new Error("database is down"); };
    const { service, transport } = build({ repo });
    const out = await service.addFiles({ sql: SQL, complaintId: CLAIM, files: [file("pdf", "1.pdf", "y")] });
    expect(out.results[0]).toMatchObject({ ok: false, reason: "record_failed" });
    expect(transport.del).toHaveBeenCalledWith(`copyrightdoc/112026/${CLAIM}/${MS}`, "pdf");
  });

  it("checks its input: a claim id that is a UUID, at least one file, and a configured bucket", async () => {
    const { service } = build();
    expect((await service.addFiles({ sql: SQL, complaintId: "not-a-uuid", files: [file("pdf")] })).error).toBe("invalid_complaint_id");
    expect((await service.addFiles({ sql: SQL, complaintId: CLAIM, files: [] })).error).toBe("no_files");
    const off = build({ transport: fakeTransport({ configured: () => false }) });
    expect((await off.service.addFiles({ sql: SQL, complaintId: CLAIM, files: [file("pdf")] })).error).toBe("not_configured");
  });
});

describe("claims/attachments > the virus scan gate", () => {
  const scanSettings = { scan: { required: true } };

  it("with a scan required and none connected, a file is stored as pending and cannot be read", async () => {
    const { service, repo, transport } = build({ settings: scanSettings });
    const out = await service.addFiles({ sql: SQL, complaintId: CLAIM, files: [file("pdf", "a.pdf", "g1")] });
    expect(out.ok).toBe(true);
    expect([...repo.rows.values()][0].scan_status).toBe("pending");
    expect(await service.openFile({ sql: SQL, complaintId: CLAIM, fileId: out.results[0].fileId })).toEqual({ ok: false, error: "scan_pending" });
    expect(transport.get).not.toHaveBeenCalled();
  });

  it("a clean verdict makes it readable; an infected or failed scan is not even uploaded", async () => {
    const verdicts = ["clean", "infected", "error"];
    const { service, transport, repo } = build({ settings: scanSettings, scanner: async () => verdicts.shift() });
    const out = await service.addFiles({ sql: SQL, complaintId: CLAIM, files: [file("pdf", "a.pdf", "c1"), file("pdf", "b.pdf", "c2"), file("pdf", "c.pdf", "c3")] });
    expect(out.results.map((r) => r.reason ?? "ok")).toEqual(["ok", "infected", "scan_failed"]);
    expect(transport.put).toHaveBeenCalledTimes(1);
    expect([...repo.rows.values()][0].scan_status).toBe("clean");
    expect((await service.openFile({ sql: SQL, complaintId: CLAIM, fileId: out.results[0].fileId })).ok).toBe(true);
  });
});

describe("claims/attachments > reading, listing and deleting", () => {
  async function withFile(settings) {
    const t = build({ settings });
    const out = await t.service.addFiles({ sql: SQL, complaintId: CLAIM, files: [file("pdf", "Proof of ownership.pdf", `r${n}`)] });
    return { ...t, fileId: out.results[0].fileId };
  }

  it("opens a stored file as a stream with download-only headers, reading it by its key", async () => {
    const { service, transport, fileId } = await withFile();
    const opened = await service.openFile({ sql: SQL, complaintId: CLAIM, fileId });
    expect(opened.ok).toBe(true);
    expect(opened.headers["Content-Disposition"]).toMatch(/^attachment; filename="Proof of ownership\.pdf"/);
    expect(transport.get).toHaveBeenCalledWith(expect.stringMatching(KEY_OF_CLAIM), "pdf");
    const chunks = [];
    for await (const c of opened.stream) chunks.push(c);
    expect(Buffer.concat(chunks).toString()).toMatch(/^%PDF/);
  });

  it("does not open a file of another claim, an unknown file or a malformed id; and says so when the NAS cannot be read", async () => {
    const { service, fileId } = await withFile();
    const other = "99999999-9999-4999-8999-999999999999";
    expect((await service.openFile({ sql: SQL, complaintId: other, fileId })).error).toBe("not_found");
    expect((await service.openFile({ sql: SQL, complaintId: CLAIM, fileId: "00000000-0000-4000-8000-0000000000ff" })).error).toBe("not_found");
    expect((await service.openFile({ sql: SQL, complaintId: CLAIM, fileId: "../../etc/passwd" })).error).toBe("not_found");

    const down = build({ transport: fakeTransport({ get: async () => ({ ok: false, status: 503, error: "read_failed" }) }) });
    const stored = await down.service.addFiles({ sql: SQL, complaintId: CLAIM, files: [file("pdf", "a.pdf", "dn")] });
    expect((await down.service.openFile({ sql: SQL, complaintId: CLAIM, fileId: stored.results[0].fileId })).error).toBe("unavailable");
  });

  it("lists the files with names and states only: never a key, a bucket, a hash or a URL", async () => {
    const { service } = await withFile();
    const list = await service.listFiles({ sql: SQL, complaintId: CLAIM });
    expect(list).toHaveLength(1);
    expect(Object.keys(list[0]).sort()).toEqual(["fileId", "kind", "mime", "name", "scanStatus", "size", "uploadedAt"]);
    expect(JSON.stringify(list)).not.toMatch(/copyright\/claims|pas-claims|sha256|http/);
  });

  it("deletes the bytes from the NAS and keeps the record marked deleted; a failed delete leaves the file as it is", async () => {
    const { service, transport, repo, fileId } = await withFile();
    expect(await service.deleteFile({ sql: SQL, complaintId: CLAIM, fileId })).toEqual({ ok: true });
    expect(transport.del).toHaveBeenCalledWith(expect.stringMatching(KEY_OF_CLAIM), "pdf");
    expect([...repo.rows.values()][0].status).toBe("deleted");
    expect(await service.listFiles({ sql: SQL, complaintId: CLAIM })).toEqual([]);
    expect((await service.openFile({ sql: SQL, complaintId: CLAIM, fileId })).error).toBe("not_found");

    const failing = build({ transport: fakeTransport({ del: async () => ({ ok: false, status: 500 }) }) });
    const stored = await failing.service.addFiles({ sql: SQL, complaintId: CLAIM, files: [file("pdf", "a.pdf", "fd")] });
    expect((await failing.service.deleteFile({ sql: SQL, complaintId: CLAIM, fileId: stored.results[0].fileId })).error).toBe("unavailable");
    expect([...failing.repo.rows.values()][0].status).toBe("stored");
  });
});

describe("claims/attachments > the HTTP transport, against a local server", () => {
  let server; let base; const seen = []; let mode = "ok";
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, type: req.headers["content-type"] || "", body: Buffer.concat(chunks).toString("latin1") });
        if (req.method === "POST") {
          res.setHeader("content-type", "application/json");
          if (mode === "ok") return res.end(JSON.stringify({ ok: true, path: "/pas-claims/stream/x.pdf" }));
          if (mode === "no_path") return res.end(JSON.stringify({ ok: true }));
          res.statusCode = 500;
          return res.end(JSON.stringify({ ok: false }));
        }
        if (req.method === "GET") {
          if (req.url.includes("missing")) { res.statusCode = 404; return res.end("no"); }
          res.setHeader("content-length", "9");
          return res.end("%PDF-data");
        }
        if (req.method === "DELETE") { res.statusCode = req.url.includes("missing") ? 404 : (mode === "fail_delete" ? 500 : 204); return res.end(); }
        res.statusCode = 405; return res.end();
      });
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  afterAll(() => new Promise((r) => server.close(r)));

  const settings = () => ({ baseUrl: base, bucket: "pas-claims", token: "s3cret-token", uploadPath: "/{bucket}/upload", readPath: "/{bucket}/{key}", deletePath: "/{bucket}/{key}", verifyTls: true, timeoutMs: 5000 });

  it("is configured only with an address, a bucket and a token", () => {
    expect(A.createHttpTransport(settings()).configured()).toBe(true);
    for (const missing of ["baseUrl", "bucket", "token"]) expect(A.createHttpTransport({ ...settings(), [missing]: "" }).configured()).toBe(false);
  });

  it("uploads with the bearer token and the key, and succeeds only when the NAS confirms with a path", async () => {
    const t = A.createHttpTransport(settings());
    const p = put(BYTES.pdf("up"));
    seen.length = 0; mode = "ok";
    const ok = await t.put(p, "copyright/claims/202611/abc", "pdf");
    expect(ok).toMatchObject({ ok: true, path: "/pas-claims/stream/x.pdf" });
    expect(seen[0]).toMatchObject({ method: "POST", url: "/pas-claims/upload", auth: "Bearer s3cret-token" });
    expect(seen[0].type).toMatch(/^multipart\/form-data/);
    expect(seen[0].body).toMatch(/name="key"\r\n\r\ncopyright\/claims\/202611\/abc/);
    expect(seen[0].body).toMatch(/filename="abc\.pdf"/);

    mode = "no_path";
    expect((await t.put(p, "k/abc", "pdf")).ok).toBe(false);
    mode = "error";
    expect((await t.put(p, "k/abc", "pdf")).ok).toBe(false);
    mode = "ok";
  });

  it("reads a file back with the bearer token, and tells a missing file from an unreadable one", async () => {
    const t = A.createHttpTransport(settings());
    seen.length = 0;
    const got = await t.get("copyright/claims/202611/abc", "pdf");
    expect(got.ok).toBe(true);
    expect(seen[0]).toMatchObject({ method: "GET", auth: "Bearer s3cret-token" });
    expect(seen[0].url.split("?")[0]).toBe("/pas-claims/copyright/claims/202611/abc.pdf");
    const chunks = []; for await (const c of got.stream) chunks.push(c);
    expect(Buffer.concat(chunks).toString()).toBe("%PDF-data");
    expect(await t.get("copyright/claims/202611/missing", "pdf")).toMatchObject({ ok: false, error: "not_found" });
  });

  it("gives every read a new random query string, so the CDN never caches the plain address (a cached authorized answer was served to anyone, even after a delete)", async () => {
    const t = A.createHttpTransport(settings());
    seen.length = 0;
    for (let i = 0; i < 4; i += 1) await t.get("copyright/claims/202611/abc", "pdf");
    const queries = seen.map((r) => r.url.split("?")[1]);
    expect(queries.every((q) => /^cb=[0-9a-f]{12}$/.test(q))).toBe(true);
    expect(new Set(queries).size).toBe(4);
    // a read address that already has a query keeps it and adds the new one
    const withQuery = A.createHttpTransport({ ...settings(), readPath: "/{bucket}/{key}?v=1" });
    seen.length = 0;
    await withQuery.get("copyright/claims/202611/abc", "pdf");
    expect(seen[0].url).toMatch(/\.pdf\?v=1&cb=[0-9a-f]{12}$/);
  });

  it("deletes with the bearer token; 'already gone' is success, a server error is not", async () => {
    const t = A.createHttpTransport(settings());
    seen.length = 0;
    expect((await t.del("copyright/claims/202611/abc", "pdf")).ok).toBe(true);
    expect(seen[0]).toMatchObject({ method: "DELETE", url: "/pas-claims/copyright/claims/202611/abc.pdf", auth: "Bearer s3cret-token" });
    expect((await t.del("copyright/claims/202611/missing", "pdf")).ok).toBe(true);
    mode = "fail_delete";
    expect((await t.del("copyright/claims/202611/abc", "pdf")).ok).toBe(false);
    mode = "ok";
  });

  it("never throws when the NAS cannot be reached", async () => {
    const t = A.createHttpTransport({ ...settings(), baseUrl: "http://127.0.0.1:1" });
    expect((await t.put(put(BYTES.pdf("x")), "k/a", "pdf")).ok).toBe(false);
    expect((await t.get("k/a", "pdf")).ok).toBe(false);
    expect((await t.del("k/a", "pdf")).ok).toBe(false);
  });
});

describe("claims/attachments > safety of the module and its settings", () => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../../..");

  it("does not use the shared media NAS helpers: the evidence never goes to the public media bucket", () => {
    const source = fs.readFileSync(path.join(root, "src/compliance/claims/attachments.js"), "utf8");
    expect(source).not.toMatch(/require\(['"][^'"]*(nasClient|nasHttpUpload|nasUploadQueue|nasSftpPool)['"]\)/);
    expect(source).not.toMatch(/insertion\.nas|mediaToken|DefaultImage/);
  });

  it("is off by default, wants its own token from the environment, and scans by default", () => {
    const { compliance } = require("../../../src/config");
    expect(compliance.claims.attachments).toMatchObject({
      enabled: false, maxFiles: 5, maxFileBytes: 5 * 1024 * 1024, allowedTypes: ["pdf", "jpg", "png", "webp"], scan: { required: true }, verifyTls: true,
    });
    expect(typeof compliance.claims.attachments.token).toBe("string");
    // checked on the real private bucket: it is read and deleted at /<bucket>/stream/<key>.<ext> (the path its upload answer gives)
    expect(compliance.claims.attachments.readPath).toBe("/{bucket}/stream/{key}");
    expect(compliance.claims.attachments.deletePath).toBe("/{bucket}/stream/{key}");
  });
  // The check that scripts/apply-copyright-schema.js defines copyright_claim_files (unique file id, one slot per claim and sha256) comes back
  // with the schema change, which goes in after B3/B6's version of that script is merged.
});

describe("claims/attachments > timestamps in the keys", () => {
  it("never gives two files of one claim the same key, even when the clock stands still or goes back", async () => {
    const times = [MS, MS, MS - 5000, MS + 10, MS + 10].map((t) => new Date(t));
    const transport = fakeTransport();
    const service = A.createAttachmentService({ settings: { ...SETTINGS }, transport, repo: fakeRepo(), log: silent, now: () => times.shift() || new Date(MS), randomId: () => crypto.randomUUID() });
    await service.addFiles({ sql: SQL, complaintId: CLAIM, files: [1, 2, 3, 4, 5].map((i) => file("pdf", `${i}.pdf`, `clock${i}`)) });
    const keys = transport.put.mock.calls.map((c) => c[1]);
    expect(keys).toHaveLength(5);
    expect(new Set(keys).size).toBe(5);
    expect(keys.map((k) => Number(k.split("/").pop()))).toEqual([MS, MS + 1, MS + 2, MS + 10, MS + 11]);
  });
});
