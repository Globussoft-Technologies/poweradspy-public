import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const igCtl = require("../../src/services/instagram/controllers/domainRegistrationController");
const ggCtl = require("../../src/services/google/controllers/domainRegistrationController");
const ytCtl = require("../../src/services/youtube/controllers/domainRegistrationController");
const fbCtl = require("../../src/services/facebook/controllers/domainRegistrationController");

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
    const cases = [
      [igCtl, "instagram_ad_domain", "instagram.com"],
      [ggCtl, "google_text_ad_domains", "awaytravel.com"],
      [ytCtl, "youtube_ad_domains", "awaytravel.com"],
      [fbCtl, "facebook_ad_domains", "lm.facebook.com"],
    ];
    for (const [ctl, table, domain] of cases) {
      const db = dbWith(async () => []);
      await ctl.getDomainRegistration({ query: { domain } }, db, log);
      expect(db.sql.query.mock.calls[0][0]).toContain(`FROM ${table}`);
      expect(db.sql.query.mock.calls[0][1]).toEqual([domain]);
    }
  });

  it("all four networks return 200 + row on a match", async () => {
    for (const ctl of [igCtl, ggCtl, ytCtl, fbCtl]) {
      const db = dbWith(async (_q, p) => [{ domain: p[0], domain_registered_date: "2018-02-04" }]);
      const out = await ctl.getDomainRegistration({ query: { domain: "d.com" } }, db, log);
      expect(out).toEqual({ code: 200, message: "Domain found successfully", data: { domain: "d.com", domain_registered_date: "2018-02-04" } });
    }
  });
});
