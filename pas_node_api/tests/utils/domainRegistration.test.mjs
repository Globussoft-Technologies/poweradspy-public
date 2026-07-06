import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const igCtl = require("../../src/services/instagram/controllers/domainRegistrationController");
const ggCtl = require("../../src/services/google/controllers/domainRegistrationController");

const log = { error: vi.fn() };
const dbWith = (impl) => ({ sql: { query: vi.fn(impl) } });

describe("get-domain-registration (shared)", () => {
  it("200 + row when the domain exists", async () => {
    const db = dbWith(async (_q, p) => [{ domain: p[0], domain_registered_date: "2015-06-01" }]);
    const out = await igCtl.getDomainRegistration({ query: { domain: "instagram.com" } }, db, log);
    expect(out).toEqual({
      code: 200, message: "Domain found successfully",
      data: { domain: "instagram.com", domain_registered_date: "2015-06-01" },
    });
  });

  it("404 when the domain isn't found", async () => {
    const db = dbWith(async () => []);
    expect(await ggCtl.getDomainRegistration({ query: { domain: "nope.com" } }, db, log))
      .toEqual({ code: 404, message: "Domain not found" });
  });

  it("400 when domain is missing or empty", async () => {
    const db = dbWith(async () => []);
    expect((await igCtl.getDomainRegistration({ query: {} }, db, log)).code).toBe(400);
    expect((await igCtl.getDomainRegistration({ query: { domain: "" } }, db, log)).code).toBe(400);
    expect(db.sql.query).not.toHaveBeenCalled(); // no query when no domain
  });

  it("400 on a DB query error (model false-branch)", async () => {
    const db = dbWith(async () => { throw new Error("boom"); });
    expect(await igCtl.getDomainRegistration({ query: { domain: "x.com" } }, db, log))
      .toEqual({ code: 400, message: "Some error ocurred during querying the db" });
  });

  it("401 when the SQL connection is unavailable", async () => {
    expect(await ggCtl.getDomainRegistration({ query: { domain: "x.com" } }, {}, log))
      .toEqual({ code: 401, message: "Some Error Occured", data: [] });
  });

  it("queries the correct per-network table, parameterized", async () => {
    const igDb = dbWith(async () => []);
    await igCtl.getDomainRegistration({ query: { domain: "instagram.com" } }, igDb, log);
    expect(igDb.sql.query.mock.calls[0][0]).toContain("FROM instagram_ad_domain");
    expect(igDb.sql.query.mock.calls[0][1]).toEqual(["instagram.com"]);

    const ggDb = dbWith(async () => []);
    await ggCtl.getDomainRegistration({ query: { domain: "awaytravel.com" } }, ggDb, log);
    expect(ggDb.sql.query.mock.calls[0][0]).toContain("FROM google_text_ad_domains");
    expect(ggDb.sql.query.mock.calls[0][1]).toEqual(["awaytravel.com"]);
  });
});
