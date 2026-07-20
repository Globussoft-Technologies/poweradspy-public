import { describe, it, expect, afterEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { updateDomainDate, NETWORK_CONFIG, isValidYmd, ymdToEpochSeconds } =
  require("../../../src/services/common/services/updateDomainDateService");
const serviceRegistry = require("../../../src/services/ServiceRegistry");

// Fake network service. Records SQL + ES calls.
//   domainRows → what the domain SELECT returns (null/[] → not_found)
//   ads        → [{id, ad_id}] rows returned by `SELECT id, ad_id ...` (drive the ES updateByQuery)
//   noEs       → omit the elastic client (simulate ES unavailable)
function mockNetwork(name, { domainRows = [], ads = [], noEs = false } = {}) {
  const calls = { sql: [], es: [] };
  const db = {
    sql: {
      query: async (q, p) => {
        calls.sql.push({ q: q.replace(/\s+/g, " ").trim(), p });
        const s = q.trim();
        if (/^SELECT id, domain_registered_date, status/i.test(s)) return domainRows;
        if (/^SELECT id, ad_id/i.test(s)) return ads;
        return { affectedRows: domainRows.length };
      },
    },
  };
  if (!noEs) {
    db.elastic = {
      indexName: `${name}_idx`,
      client: {
        updateByQuery: async (args) => {
          calls.es.push(args);
          const terms = args.body.query.terms;
          const vals = Object.values(terms)[0]; // the single {field: [ids]} entry
          // wait_for_completion:false → background task (returns a task id); else sync (returns count)
          if (args.waitForCompletion === false) return { body: { task: `task_${calls.es.length}` } };
          return { body: { updated: vals.length } };
        },
      },
    };
  }
  serviceRegistry.services.set(name, { db });
  return calls;
}

afterEach(() => {
  for (const net of Object.keys(NETWORK_CONFIG)) serviceRegistry.services.delete(net);
});

describe("updateDomainDateService > config & date validation", () => {
  it("covers all 10 networks; only facebook & linkedin lack updated_date", () => {
    expect(Object.keys(NETWORK_CONFIG).sort()).toEqual([
      "facebook", "gdn", "google", "instagram", "linkedin",
      "native", "pinterest", "quora", "reddit", "youtube",
    ].sort());
    expect(NETWORK_CONFIG.facebook.hasUpdatedDate).toBe(false);
    expect(NETWORK_CONFIG.linkedin.hasUpdatedDate).toBe(false);
    for (const [net, cfg] of Object.entries(NETWORK_CONFIG)) {
      if (net !== "facebook" && net !== "linkedin") expect(cfg.hasUpdatedDate).toBe(true);
      expect(cfg.esDateField).toBeTruthy();
      expect(cfg.adTable).toBeTruthy();
    }
    // youtube & linkedin store the ES date as epoch; the rest as yyyy-MM-dd.
    expect(NETWORK_CONFIG.youtube.esDateFormat).toBe("epoch");
    expect(NETWORK_CONFIG.linkedin.esDateFormat).toBe("epoch");
    expect(NETWORK_CONFIG.google.esDateFormat).toBe("ymd");
  });

  it("validates Y-m-d dates", () => {
    expect(isValidYmd("2026-07-09")).toBe(true);
    expect(isValidYmd("2024-02-29")).toBe(true);   // leap day
    expect(isValidYmd("2026-13-01")).toBe(false);  // bad month
    expect(isValidYmd("2026-02-30")).toBe(false);  // impossible day
    expect(isValidYmd("2026-7-9")).toBe(false);    // not zero-padded
    expect(isValidYmd("")).toBe(false);
  });
});

describe("updateDomainDateService > validation errors", () => {
  it("400 when domain_name missing", async () => {
    const out = await updateDomainDate({ domain_date: "2026-07-09" }, null);
    expect(out.code).toBe(400);
    expect(out.error).toContain("domain_name");
  });
  it("400 when neither domain_date nor status provided", async () => {
    const out = await updateDomainDate({ domain_name: "x.com" }, null);
    expect(out.code).toBe(400);
    expect(out.error).toContain("domain_date");
  });
  it("400 when domain_date malformed", async () => {
    const out = await updateDomainDate({ domain_name: "x.com", domain_date: "07/09/2026" }, null);
    expect(out.code).toBe(400);
    expect(out.error).toContain("Y-m-d");
  });
  it("400 when status is out of range", async () => {
    const out = await updateDomainDate({ domain_name: "x.com", status: 5 }, null);
    expect(out.code).toBe(400);
    expect(out.error).toContain("status");
  });
  it("400 when status 1 sent without a date", async () => {
    const out = await updateDomainDate({ domain_name: "x.com", status: 1 }, null);
    expect(out.code).toBe(400);
    expect(out.error).toContain("requires a domain_date");
  });
  it("400 when a date is sent alongside a conflicting status", async () => {
    const out = await updateDomainDate({ domain_name: "x.com", domain_date: "2026-07-09", status: 2 }, null);
    expect(out.code).toBe(400);
    expect(out.error).toContain("implies status 1");
  });
});

describe("updateDomainDateService > cross-network update + ES propagation", () => {
  it("date → updates all SQL rows (status 1) AND propagates the date to each ad's ES doc", async () => {
    // google matches ES by PUBLIC ad_id; facebook (search_mix) by INTERNAL id (facebook_ad.id).
    const gCalls = mockNetwork("google", {
      domainRows: [
        { id: 11, domain_registered_date: null, status: 0 },
        { id: 12, domain_registered_date: "1999-01-01", status: 1 },
      ],
      ads: [{ id: 101, ad_id: "a1" }, { id: 102, ad_id: "a2" }, { id: 103, ad_id: "a3" }],
    });
    const fbCalls = mockNetwork("facebook", { domainRows: [{ id: 22, domain_registered_date: "2000-01-01", status: 1 }], ads: [{ id: 201, ad_id: "f1" }] });
    for (const net of Object.keys(NETWORK_CONFIG)) {
      if (net !== "google" && net !== "facebook") mockNetwork(net, { domainRows: [] }); // not found
    }

    const out = await updateDomainDate({ domain_name: "x.com", domain_date: "2026-07-09" }, null);

    expect(out.code).toBe(200);
    expect(out.data.status).toBe(1);
    expect(out.data.summary).toMatchObject({ updated: 2, not_found: 8, errors: 0, es_updated: 4, es_errors: 0 });
    expect(out.data.results.google).toMatchObject({ status: "updated", matched_rows: 2, new_status: 1, es_matched_ads: 3, es_updated: 3, es_index: "google_idx" });
    expect(out.data.results.facebook).toMatchObject({ status: "updated", es_updated: 1 });

    // ad lookup used the ad table + the domain row ids, selecting BOTH id and ad_id
    const adLookup = gCalls.sql.find((c) => /^SELECT id, ad_id FROM google_text_ad WHERE domain_id IN/i.test(c.q));
    expect(adLookup).toBeTruthy();
    expect(adLookup.p).toEqual([11, 12]);

    // google → match by PUBLIC ad_id, flat yyyy-MM-dd date field written verbatim. Small → sync.
    expect(gCalls.es).toHaveLength(1);
    const g = gCalls.es[0];
    expect(g.index).toBe("google_idx");
    expect(g.conflicts).toBe("proceed");
    expect(g.refresh).toBe(false);
    expect(g.waitForCompletion).toBe(true); // synchronous for a small domain
    expect(g.body.query.terms.ad_id).toEqual(["a1", "a2", "a3"]);
    expect(g.body.script.params).toEqual({ f: "domain_registered_date", v: "2026-07-09" });
    expect(out.data.results.google.es_mode).toBe("sync");

    // facebook search_mix → match by INTERNAL id on the dotted `facebook_ad.id`; dotted date key.
    const fb = fbCalls.es[0];
    expect(fb.body.query.terms["facebook_ad.id"]).toEqual([201]);
    expect(fb.body.script.params.f).toBe("facebook_ad_domains.domain_registered_date");
    expect(fb.body.script.params.v).toBe("2026-07-09");
  });

  it("epoch networks (youtube) match by internal id and write the date as UNIX epoch seconds", async () => {
    const ytCalls = mockNetwork("youtube", { domainRows: [{ id: 5, domain_registered_date: null, status: 0 }], ads: [{ id: 77, ad_id: "y1" }] });
    for (const net of Object.keys(NETWORK_CONFIG)) if (net !== "youtube") mockNetwork(net, { domainRows: [] });

    const out = await updateDomainDate({ domain_name: "x.com", domain_date: "2026-07-09" }, null);
    expect(out.code).toBe(200);
    const call = ytCalls.es[0];
    expect(call.body.query.terms.ad_id).toEqual([77]); // internal id, not "y1"
    const p = call.body.script.params;
    expect(p.f).toBe("domain_registration_date");
    expect(p.v).toBe(ymdToEpochSeconds("2026-07-09"));
    expect(typeof p.v).toBe("number");
  });

  it("large domain (> sync threshold) runs ES as background tasks and does not block", async () => {
    // default threshold is 2000; 2500 ads → async, chunked by 1000 → 3 background tasks.
    const ads = Array.from({ length: 2500 }, (_, i) => ({ id: i + 1, ad_id: `a${i}` }));
    const gCalls = mockNetwork("google", { domainRows: [{ id: 9, domain_registered_date: null, status: 0 }], ads });
    for (const net of Object.keys(NETWORK_CONFIG)) if (net !== "google") mockNetwork(net, { domainRows: [] });

    const out = await updateDomainDate({ domain_name: "big.com", domain_date: "2026-07-09" }, null);
    expect(out.code).toBe(200);
    const r = out.data.results.google;
    expect(r.es_mode).toBe("async");
    expect(r.es_matched_ads).toBe(2500);
    expect(r.es_updated).toBeUndefined();        // no synchronous count on the async path
    expect(r.es_tasks).toHaveLength(3);          // 1000 + 1000 + 500
    expect(gCalls.es.every((c) => c.waitForCompletion === false)).toBe(true);
    expect(gCalls.es.every((c) => c.refresh === false && c.conflicts === "proceed")).toBe(true);
    expect(out.data.summary).toMatchObject({ es_matched_ads: 2500, es_async_networks: 1 });
  });

  it("status 2 → marks UNRESOLVABLE, NO date, NO ES write", async () => {
    const gCalls = mockNetwork("google", { domainRows: [{ id: 11, domain_registered_date: null, status: 0 }], ads: [{ id: 101, ad_id: "a1" }] });
    for (const net of Object.keys(NETWORK_CONFIG)) if (net !== "google") mockNetwork(net, { domainRows: [] });

    const out = await updateDomainDate({ domain_name: "junk.com", status: 2 }, null);
    expect(out.code).toBe(200);
    expect(out.data.status).toBe(2);
    expect(out.data.domain_date).toBeNull();
    expect(out.data.results.google).toMatchObject({ status: "updated", new_status: 2 });
    expect(out.data.results.google.es_updated).toBeUndefined();
    expect(gCalls.es).toHaveLength(0); // no ES write on the status path

    const gUpdate = gCalls.sql.find((c) => c.q.startsWith("UPDATE"));
    expect(gUpdate.q).toContain("SET status = ?, updated_date = NOW() WHERE domain = ?");
    expect(gUpdate.p).toEqual([2, "junk.com"]);
  });

  it("an ES failure is reported per network but does not fail the SQL update", async () => {
    for (const net of Object.keys(NETWORK_CONFIG)) mockNetwork(net, { domainRows: [] });
    mockNetwork("google", { domainRows: [{ id: 1, domain_registered_date: null, status: 0 }], ads: [{ id: 101, ad_id: "a1" }], noEs: true });

    const out = await updateDomainDate({ domain_name: "x.com", domain_date: "2026-07-09" }, null);
    expect(out.code).toBe(200);
    expect(out.data.results.google.status).toBe("updated"); // SQL still succeeded
    expect(out.data.results.google.es_error).toBeTruthy();
    expect(out.data.summary.es_errors).toBe(1);
  });

  it("reports a per-network db error without failing the whole request", async () => {
    for (const net of Object.keys(NETWORK_CONFIG)) mockNetwork(net, { domainRows: [] });
    serviceRegistry.services.set("quora", { db: { sql: { query: async () => { throw new Error("boom"); } } } });
    const out = await updateDomainDate({ domain_name: "x.com", domain_date: "2026-07-09" }, null);
    expect(out.code).toBe(200);
    expect(out.data.results.quora.status).toBe("error");
    expect(out.data.summary.errors).toBe(1);
  });

  it("503 when no network has a working SQL connection", async () => {
    const out = await updateDomainDate({ domain_name: "x.com", domain_date: "2026-07-09" }, null);
    expect(out.code).toBe(503);
    expect(out.data.summary.errors).toBe(10);
  });
});
