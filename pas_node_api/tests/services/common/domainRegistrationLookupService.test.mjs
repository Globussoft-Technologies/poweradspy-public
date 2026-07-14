import { describe, it, expect, afterEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { lookupDomainRegistration, resolveNetworks } =
  require("../../../src/services/common/services/domainRegistrationLookupService");
const { DOMAIN_NETWORKS } = require("../../../src/services/common/helpers/domainTables");
const serviceRegistry = require("../../../src/services/ServiceRegistry");

// Register a fake network service returning `row` for the domain SELECT (null = not found).
function mockNetwork(name, row) {
  serviceRegistry.services.set(name, {
    db: { sql: { query: async () => (row ? [row] : []) } },
  });
}

afterEach(() => {
  for (const net of DOMAIN_NETWORKS) serviceRegistry.services.delete(net);
});

describe("domainRegistrationLookupService > resolveNetworks", () => {
  it("defaults to ALL networks when omitted / empty / 'all'", () => {
    for (const raw of [undefined, null, "", "  ", "all", "ALL"]) {
      expect(resolveNetworks(raw).networks).toEqual(DOMAIN_NETWORKS);
    }
  });
  it("parses a single network and a CSV list (de-duped)", () => {
    expect(resolveNetworks("google").networks).toEqual(["google"]);
    expect(resolveNetworks("facebook, google ,facebook").networks).toEqual(["facebook", "google"]);
  });
  it("rejects unknown networks", () => {
    expect(resolveNetworks("tiktok").error).toContain("Unsupported");
    expect(resolveNetworks("google,bogus").error).toContain("bogus");
  });
});

describe("domainRegistrationLookupService > validation", () => {
  it("400 when domain missing/empty", async () => {
    expect((await lookupDomainRegistration({}, null)).code).toBe(400);
    expect((await lookupDomainRegistration({ domain: "  " }, null)).code).toBe(400);
  });
  it("400 on unsupported network", async () => {
    const out = await lookupDomainRegistration({ domain: "x.com", network: "myspace" }, null);
    expect(out.code).toBe(400);
  });
});

describe("domainRegistrationLookupService > lookup", () => {
  it("404 when the domain is in no network", async () => {
    for (const net of DOMAIN_NETWORKS) mockNetwork(net, null);
    const out = await lookupDomainRegistration({ domain: "nope.com" }, null);
    expect(out.code).toBe(404);
    expect(out.data.matches).toEqual([]);
    expect(out.meta.networks_searched).toEqual(DOMAIN_NETWORKS);
  });

  it("returns BOTH networks with their DIFFERENT dates, in config order", async () => {
    for (const net of DOMAIN_NETWORKS) mockNetwork(net, null);
    mockNetwork("google", { domain: "x.com", domain_registered_date: "2015-08-12", status: 1 });
    mockNetwork("facebook", { domain: "x.com", domain_registered_date: "2004-06-04", status: 1 });

    const out = await lookupDomainRegistration({ domain: "x.com" }, null);
    expect(out.code).toBe(200);
    expect(out.data.found_in).toEqual(["facebook", "google"]); // config order (fb before google)
    expect(out.data.matches).toEqual([
      { network: "facebook", domain: "x.com", domain_registered_date: "2004-06-04", status: 1 },
      { network: "google", domain: "x.com", domain_registered_date: "2015-08-12", status: 1 },
    ]);
    expect(out.data.distinct_registered_dates).toEqual(["2004-06-04", "2015-08-12"]);
  });

  it("scopes to the requested network only", async () => {
    for (const net of DOMAIN_NETWORKS) mockNetwork(net, { domain: "x.com", domain_registered_date: "2020-01-01" });
    const out = await lookupDomainRegistration({ domain: "x.com", network: "reddit" }, null);
    expect(out.data.found_in).toEqual(["reddit"]);
    expect(out.meta.networks_searched).toEqual(["reddit"]);
  });

  it("collapses a null registration date into distinct dates and still counts as found", async () => {
    for (const net of DOMAIN_NETWORKS) mockNetwork(net, null);
    mockNetwork("instagram", { domain: "x.com", domain_registered_date: null, status: 0 });
    const out = await lookupDomainRegistration({ domain: "x.com" }, null);
    expect(out.code).toBe(200);
    expect(out.data.matches).toEqual([{ network: "instagram", domain: "x.com", domain_registered_date: null, status: 0 }]);
    expect(out.data.distinct_registered_dates).toEqual([null]);
  });

  it("returns each DISTINCT date when one network has duplicate rows for the domain", async () => {
    for (const net of DOMAIN_NETWORKS) mockNetwork(net, null);
    // google has 3 rows for x.com: two share a (date,status) (deduped) + one still NULL/pending.
    serviceRegistry.services.set("google", {
      db: { sql: { query: async () => ([
        { domain: "x.com", domain_registered_date: "2015-08-12", status: 1 },
        { domain: "x.com", domain_registered_date: "2015-08-12", status: 1 },
        { domain: "x.com", domain_registered_date: null, status: 0 },
      ]) } },
    });
    const out = await lookupDomainRegistration({ domain: "x.com", network: "google" }, null);
    expect(out.code).toBe(200);
    expect(out.data.matches).toEqual([
      { network: "google", domain: "x.com", domain_registered_date: "2015-08-12", status: 1 },
      { network: "google", domain: "x.com", domain_registered_date: null, status: 0 },
    ]);
    expect(out.data.distinct_registered_dates).toEqual(["2015-08-12", null]);
  });

  it("records a per-network error but still returns other matches", async () => {
    for (const net of DOMAIN_NETWORKS) mockNetwork(net, null);
    mockNetwork("google", { domain: "x.com", domain_registered_date: "2015-08-12" });
    serviceRegistry.services.set("quora", { db: { sql: { query: async () => { throw new Error("boom"); } } } });

    const out = await lookupDomainRegistration({ domain: "x.com" }, null);
    expect(out.code).toBe(200);
    expect(out.data.found_in).toEqual(["google"]);
    expect(out.meta.errors.quora).toContain("boom");
  });
});
