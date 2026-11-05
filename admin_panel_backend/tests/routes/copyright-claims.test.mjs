import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
const require = createRequire(import.meta.url);

// The route calls the claims service with axios: replace it with a spy before the route is loaded.
process.env.JWT_SECRET = "test-secret";
const axiosPath = require.resolve("axios");
const fakeAxios = vi.fn();
require.cache[axiosPath] = { id: axiosPath, filename: axiosPath, loaded: true, exports: fakeAxios };

const jwt = require("jsonwebtoken");
const express = require("express");
const request = require("supertest");
const router = require("../../routes/copyright-claims");

const app = express();
app.use("/admin-panel/copyright-claims", router);
const BASE = "/admin-panel/copyright-claims";
const SERVICE = "https://claims.test/api/v1/copyright/admin/claims";
const ID = "11111111-1111-4111-8111-111111111111";
const FILE = "22222222-2222-4222-8222-222222222222";
const tokenFor = (user_name) => jwt.sign({ user_name }, "test-secret");
const as = (user = "Asha.Rao") => ({ Authorization: `Bearer ${tokenFor(user)}` });

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {}); // authService prints the header
  fakeAxios.mockReset();
  fakeAxios.mockResolvedValue({ status: 200, data: { code: 200, message: "ok", data: { fine: true } } });
  process.env.PAS_NODE_API_URL = "https://claims.test/";
  process.env.COPYRIGHT_CLAIMS_ADMIN_TOKEN = "admin-secret";
  process.env.COPYRIGHT_CLAIMS_REVIEWERS = "Asha.Rao, bob";
});

describe("routes/copyright-claims > who may use it", () => {
  it("needs a valid admin login (a JWT)", async () => {
    expect((await request(app).get(`${BASE}/summary`)).status).toBe(401);
    expect((await request(app).get(`${BASE}/summary`).set("Authorization", "Bearer not-a-token")).status).toBe(401);
    expect((await request(app).get(`${BASE}/summary`).set("Authorization", `Bearer ${jwt.sign({ user_name: "asha.rao" }, "another-secret")}`)).status).toBe(401);
    expect((await request(app).get(`${BASE}/summary`).set("Authorization", `Bearer ${jwt.sign({ nothing: 1 }, "test-secret")}`)).status).toBe(401);
    expect(fakeAxios).not.toHaveBeenCalled();
  });

  it("lets only the listed reviewers in (the user name, in any letter case), and refuses everyone else with 403", async () => {
    expect((await request(app).get(`${BASE}/summary`).set(as("Asha.Rao"))).status).toBe(200);
    expect((await request(app).get(`${BASE}/summary`).set(as("ASHA.RAO"))).status).toBe(200);
    expect((await request(app).get(`${BASE}/summary`).set(as("bob"))).status).toBe(200);
    fakeAxios.mockClear();
    for (const stranger of ["mallory", "asha", "asha.rao2", "bo"]) expect((await request(app).get(`${BASE}/summary`).set(as(stranger))).status).toBe(403);
    expect(fakeAxios).not.toHaveBeenCalled();
  });

  it("answers 503 and does nothing when anything is not configured: nobody is let in by default", async () => {
    for (const missing of ["PAS_NODE_API_URL", "COPYRIGHT_CLAIMS_ADMIN_TOKEN", "COPYRIGHT_CLAIMS_REVIEWERS"]) {
      const saved = process.env[missing];
      process.env[missing] = "";
      const res = await request(app).get(`${BASE}/summary`).set(as());
      expect(res.status).toBe(503);
      expect(res.body.message).toBe("Copyright claims are not configured.");
      process.env[missing] = saved;
    }
    process.env.COPYRIGHT_CLAIMS_REVIEWERS = " , ";
    expect((await request(app).get(`${BASE}/summary`).set(as())).status).toBe(503);
    expect(fakeAxios).not.toHaveBeenCalled();
  });
});

describe("routes/copyright-claims > what it sends to the claims service", () => {
  it("calls it with its own admin token, never with the person's login", async () => {
    const res = await request(app).get(`${BASE}/summary`).set(as());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ code: 200, message: "ok", data: { fine: true } });
    const cfg = fakeAxios.mock.calls[0][0];
    expect(cfg).toMatchObject({ method: "GET", url: `${SERVICE}/summary` });
    expect(Object.keys(cfg.headers)).toEqual(["x-copyright-admin-token"]);
    expect(cfg.headers["x-copyright-admin-token"]).toBe("admin-secret");
  });

  it("passes on only the three list filters", async () => {
    await request(app).get(`${BASE}?status=pending&beforeId=9&limit=5&evil=1&token=x`).set(as());
    const cfg = fakeAxios.mock.calls[0][0];
    expect(cfg.url).toBe(SERVICE);
    expect(cfg.params).toEqual({ status: "pending", beforeId: "9", limit: "5" });
  });

  it("refuses an id that is not a UUID, before calling anything (nothing can be added to the address)", async () => {
    for (const bad of ["not-a-uuid", "..%2f..%2fsecret", `${ID}%2f..%2f`, "1"]) {
      expect((await request(app).get(`${BASE}/${bad}`).set(as())).status).toBe(400);
    }
    expect((await request(app).get(`${BASE}/${ID}/files/not-a-uuid`).set(as())).status).toBe(400);
    expect((await request(app).post(`${BASE}/not-a-uuid/accept`).set(as()).send({ evidenceReviewed: true })).status).toBe(400);
    expect(fakeAxios).not.toHaveBeenCalled();
  });

  it("reads one claim and its search", async () => {
    await request(app).get(`${BASE}/${ID}`).set(as());
    await request(app).get(`${BASE}/${ID}/precheck`).set(as());
    expect(fakeAxios.mock.calls.map((c) => c[0].url)).toEqual([`${SERVICE}/${ID}`, `${SERVICE}/${ID}/precheck`]);
  });

  it("records the reviewer from the LOGIN, whatever the browser says", async () => {
    await request(app).post(`${BASE}/${ID}/accept`).set(as("Asha.Rao")).send({ reviewedBy: "Mallory", evidenceReviewed: true, note: "documents fine" });
    expect(fakeAxios.mock.calls[0][0]).toMatchObject({ method: "POST", url: `${SERVICE}/${ID}/accept`, data: { reviewedBy: "Asha.Rao", evidenceReviewed: true, note: "documents fine" } });

    await request(app).post(`${BASE}/${ID}/reject`).set(as("bob")).send({ reviewedBy: "Mallory", reason: "no proof" });
    expect(fakeAxios.mock.calls[1][0]).toMatchObject({ url: `${SERVICE}/${ID}/reject`, data: { reviewedBy: "bob", reason: "no proof" } });

    await request(app).post(`${BASE}/${ID}/retry`).set(as("bob")).send({ reviewedBy: "Mallory" });
    expect(fakeAxios.mock.calls[2][0]).toMatchObject({ url: `${SERVICE}/${ID}/retry`, data: { reviewedBy: "bob" } });
  });

  it("counts the documents as reviewed only when the browser says exactly true", async () => {
    for (const value of ["true", 1, "yes", null, undefined]) {
      fakeAxios.mockClear();
      await request(app).post(`${BASE}/${ID}/accept`).set(as()).send({ evidenceReviewed: value });
      expect(fakeAxios.mock.calls[0][0].data.evidenceReviewed).toBe(false);
    }
    await request(app).post(`${BASE}/${ID}/reject`).set(as()).send({});
    expect(fakeAxios.mock.calls.at(-1)[0].data.reason).toBe("");
  });
});

describe("routes/copyright-claims > what it answers", () => {
  it("passes on a refusal of the claims service as it is (409, 404, 400 ...)", async () => {
    fakeAxios.mockResolvedValue({ status: 409, data: { code: 409, message: "this claim was already accepted", data: null } });
    const res = await request(app).post(`${BASE}/${ID}/reject`).set(as()).send({ reason: "x" });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe("this claim was already accepted");
  });

  it("turns a failure of the service, a malformed answer, or a network error into a plain 502 without any detail", async () => {
    const cases = [
      { status: 503, data: { code: 503, message: "Table 'db.copyright_claims' doesn't exist", data: null } },
      { status: 500, data: "<html>stack trace</html>" },
      { status: 200, data: "not json" },
      { status: 200, data: null },
    ];
    for (const answer of cases) {
      fakeAxios.mockResolvedValueOnce(answer);
      const res = await request(app).get(`${BASE}/summary`).set(as());
      expect(res.status).toBe(502);
      expect(JSON.stringify(res.body)).not.toMatch(/doesn't exist|stack trace|admin-secret|claims\.test/);
    }
    fakeAxios.mockRejectedValueOnce(Object.assign(new Error("connect ECONNREFUSED 10.0.0.9:443"), { code: "ECONNREFUSED" }));
    const down = await request(app).get(`${BASE}/summary`).set(as());
    expect(down.status).toBe(502);
    expect(JSON.stringify(down.body)).not.toMatch(/ECONNREFUSED|10\.0\.0\.9/);
  });

  it("streams an evidence file as a download and passes on only the safe headers", async () => {
    fakeAxios.mockResolvedValue({
      status: 200,
      data: Readable.from([Buffer.from("%PDF-1.4 data")]),
      headers: {
        "content-type": "application/pdf", "content-disposition": 'attachment; filename="p.pdf"', "x-content-type-options": "nosniff", "cache-control": "no-store",
        "content-security-policy": "default-src 'none'; sandbox", "set-cookie": "session=secret", "x-powered-by": "secret", server: "secret",
      },
    });
    const res = await request(app).get(`${BASE}/${ID}/files/${FILE}`).set(as()).buffer(true).parse((r, cb) => { const c = []; r.on("data", (d) => c.push(d)); r.on("end", () => cb(null, Buffer.concat(c))); });
    expect(res.status).toBe(200);
    expect(res.body.toString()).toMatch(/^%PDF/);
    expect(res.headers["content-disposition"]).toMatch(/^attachment/);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(fakeAxios.mock.calls[0][0]).toMatchObject({ url: `${SERVICE}/${ID}/files/${FILE}`, responseType: "stream" });
  });

  it("says so, in words, when a file is not scanned yet or is missing, and gives a plain 502 for the rest", async () => {
    for (const [status, code, message] of [[409, 409, /not been scanned/], [404, 404, /No such file/], [500, 502, /cannot be read/], [503, 502, /cannot be read/]]) {
      fakeAxios.mockResolvedValueOnce({ status, data: Readable.from([Buffer.from("x")]), headers: {} });
      const res = await request(app).get(`${BASE}/${ID}/files/${FILE}`).set(as());
      expect(res.status).toBe(code);
      expect(res.body.message).toMatch(message);
    }
    fakeAxios.mockRejectedValueOnce(new Error("socket hang up"));
    expect((await request(app).get(`${BASE}/${ID}/files/${FILE}`).set(as())).status).toBe(502);
  });
});

describe("routes/copyright-claims > the monitor (read only)", () => {
  const MONITOR = "https://claims.test/api/v1/copyright/admin/monitor";
  const RUN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  it("is for reviewers only, like the claims", async () => {
    expect((await request(app).get(`${BASE}/monitor/overview`)).status).toBe(401);
    expect((await request(app).get(`${BASE}/monitor/overview`).set(as("mallory"))).status).toBe(403);
    expect(fakeAxios).not.toHaveBeenCalled();
  });

  it("is not taken for a claim id, and goes to the monitor address of the service with the admin token only", async () => {
    const res = await request(app).get(`${BASE}/monitor/overview`).set(as());
    expect(res.status).toBe(200);
    const cfg = fakeAxios.mock.calls[0][0];
    expect(cfg).toMatchObject({ method: "GET", url: `${MONITOR}/overview` });
    expect(Object.keys(cfg.headers)).toEqual(["x-copyright-admin-token"]);
  });

  it("passes on only the filters of each route", async () => {
    await request(app).get(`${BASE}/monitor/runs?network=facebook&status=failed&mode=execute&cursor=c&limit=5&evil=1`).set(as());
    expect(fakeAxios.mock.calls[0][0]).toMatchObject({ url: `${MONITOR}/runs`, params: { network: "facebook", status: "failed", mode: "execute", cursor: "c", limit: "5" } });
    fakeAxios.mockClear();
    await request(app).get(`${BASE}/monitor/runs/${RUN}/logs?network=facebook&system=elastic&afterId=7&evil=1`).set(as());
    expect(fakeAxios.mock.calls[0][0]).toMatchObject({ url: `${MONITOR}/runs/${RUN}/logs`, params: { network: "facebook", system: "elastic", afterId: "7" } });
    fakeAxios.mockClear();
    await request(app).get(`${BASE}/monitor/hash-jobs/12/results?network=facebook&outcome=failed`).set(as());
    expect(fakeAxios.mock.calls[0][0]).toMatchObject({ url: `${MONITOR}/hash-jobs/12/results`, params: { network: "facebook", outcome: "failed" } });
    fakeAxios.mockClear();
    await request(app).get(`${BASE}/monitor/failures?network=reddit&beforeId=40`).set(as());
    expect(fakeAxios.mock.calls[0][0]).toMatchObject({ url: `${MONITOR}/failures`, params: { network: "reddit", beforeId: "40" } });
  });

  it("serves the blocklist and the rejected ads, passing on only their filters", async () => {
    await request(app).get(`${BASE}/monitor/blocklist?network=facebook&status=active&entryType=advertiser&q=test%20brand&beforeId=9&limit=5&evil=1`).set(as());
    expect(fakeAxios.mock.calls[0][0]).toMatchObject({ method: "GET", url: `${MONITOR}/blocklist`, params: { network: "facebook", status: "active", entryType: "advertiser", q: "test brand", beforeId: "9", limit: "5" } });
    expect(fakeAxios.mock.calls[0][0].params).not.toHaveProperty("evil");
    fakeAxios.mockClear();
    await request(app).get(`${BASE}/monitor/attempts?network=reddit&beforeId=4&limit=10&token=x`).set(as());
    expect(fakeAxios.mock.calls[0][0]).toMatchObject({ url: `${MONITOR}/attempts`, params: { network: "reddit", beforeId: "4", limit: "10" } });
    expect(fakeAxios.mock.calls[0][0].params).not.toHaveProperty("token");
    expect((await request(app).get(`${BASE}/monitor/blocklist?network=../x`).set(as())).status).toBe(400);
    expect((await request(app).post(`${BASE}/monitor/blocklist`).set(as())).status).toBe(404);
  });

  it("refuses a bad network, run id, job id or complaint id before calling anything", async () => {
    for (const path of ["/monitor/runs?network=../x", "/monitor/runs?network=a%20b", `/monitor/runs/not-a-uuid/logs?network=facebook`, "/monitor/hash-jobs/abc/results?network=facebook", "/monitor/runs?complaintId=nope"]) {
      expect((await request(app).get(`${BASE}${path}`).set(as())).status).toBe(400);
    }
    expect(fakeAxios).not.toHaveBeenCalled();
  });

  it("has no way to change anything: only GET exists on the monitor", async () => {
    for (const method of ["post", "put", "patch", "delete"]) {
      expect((await request(app)[method](`${BASE}/monitor/overview`).set(as())).status).toBe(404);
    }
    expect(fakeAxios).not.toHaveBeenCalled();
  });

  it("answers a plain 502 when the service is down", async () => {
    fakeAxios.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:443"));
    const res = await request(app).get(`${BASE}/monitor/overview`).set(as());
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toMatch(/10\.0\.0\.5/);
  });
});

describe("routes/copyright-claims > registration", () => {
  it("is mounted by main-routes.js at /copyright-claims", () => {
    const source = readFileSync(new URL("../../routes/main-routes.js", import.meta.url), "utf8");
    expect(source).toMatch(/require\("\.\/copyright-claims"\)/);
    expect(source).toMatch(/app\.use\("\/copyright-claims", copyrightClaims\)/);
  });
});
