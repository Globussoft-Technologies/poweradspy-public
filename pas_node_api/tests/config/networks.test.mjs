import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const configIdxPath = require.resolve("../../src/config");

// Build a thorough fake `config/index` whose .databases has all the fields
// the networks.js template touches. Reset between tests via configFactory.
function makeConfig({ env = "development", networks = {} } = {}) {
  const dbStub = { host: "h", port: 0, user: "u", password: "p", database: "d", poolSize: 1, auth: { username: "u", password: "p" }, node: "n", uri: "uri" };
  // Many specific *database fields keyed by network slug to make the static
  // template eval succeed (facebookdatabase, googledatabase, etc.)
  const sqlDb = {
    ...dbStub,
    facebookdatabase: "fbdb", googledatabase: "gdb", instagramdatabase: "igdb",
    gdndatabase: "gdndb", linkedindatabase: "lidb", nativedatabase: "ntdb",
    pinterestdatabase: "pidb", quoradatabase: "qudb", redditdatabase: "rddb",
    tiktokdatabase: "ttdb", youtubedatabase: "ytdb",
  };
  return {
    env,
    databases: {
      sql: sqlDb,
      mongo: { ...dbStub, database: "pas_dev" },
      elastic: dbStub,
      elastic_tiktok: dbStub,
      elastic_youtube: dbStub,
    },
    getRawFileConfig: () => ({ networks }),
  };
}

const networksPath = require.resolve("../../src/config/networks");
function freshNetworks(configExports) {
  // Re-seed config module
  require.cache[configIdxPath] = {
    id: configIdxPath, filename: configIdxPath, loaded: true, exports: configExports,
  };
  delete require.cache[networksPath];
  return require(networksPath);
}

const originalEnv = { ...process.env };
beforeEach(() => {
  // Strip any FB_/GG_/etc env keys
  for (const k of Object.keys(process.env)) {
    if (/^[A-Z]{2,3}_/.test(k)) delete process.env[k];
  }
});

describe("config/networks > toBool + netVal branches via facebook block", () => {
  it("dev mode + no overrides → defaults used", () => {
    const nets = freshNetworks(makeConfig({ env: "development" }));
    expect(nets.facebook.enabled).toBe(true);
    expect(nets.facebook.database.sql.enabled).toBe(false);
    expect(nets.facebook.database.sql.poolSize).toBe(1);
    // connectionParam=true in dev → ignores networkJson + env, uses default
    expect(nets.facebook.database.sql.host).toBe("h");
  });
  it("prod mode + config.json override wins", () => {
    const nets = freshNetworks(makeConfig({
      env: "production",
      networks: {
        facebook: {
          enabled: false,
          sql: { enabled: true, poolSize: 99, host: "fbhost" },
        },
      },
    }));
    expect(nets.facebook.enabled).toBe(false);
    expect(nets.facebook.database.sql.poolSize).toBe(99);
    expect(nets.facebook.database.sql.host).toBe("fbhost");
  });
  it("prod mode + env override (no config.json field)", () => {
    process.env.FB_SQL_HOST = "envhost";
    const nets = freshNetworks(makeConfig({ env: "production" }));
    expect(nets.facebook.database.sql.host).toBe("envhost");
  });
  it("dev mode + connectionParam=false (poolSize) reads from network config", () => {
    const nets = freshNetworks(makeConfig({
      env: "development",
      networks: { facebook: { sql: { poolSize: 42 } } },
    }));
    expect(nets.facebook.database.sql.poolSize).toBe(42);
  });
  it("config field present but empty string → falls through to env then default", () => {
    process.env.FB_SQL_HOST = "envwins";
    const nets = freshNetworks(makeConfig({
      env: "production",
      networks: { facebook: { sql: { host: "" } } },
    }));
    expect(nets.facebook.database.sql.host).toBe("envwins");
  });
  it("config field null → falls through to env", () => {
    process.env.FB_SQL_HOST = "envwins2";
    const nets = freshNetworks(makeConfig({
      env: "production",
      networks: { facebook: { sql: { host: null } } },
    }));
    expect(nets.facebook.database.sql.host).toBe("envwins2");
  });
  it("env empty string → falls through to default", () => {
    process.env.FB_SQL_HOST = "";
    const nets = freshNetworks(makeConfig({ env: "production" }));
    expect(nets.facebook.database.sql.host).toBe("h");
  });
  it("toBool: 'true' string → true; 'false' string → false", () => {
    const nets = freshNetworks(makeConfig({
      env: "production",
      networks: { facebook: { enabled: "true", sql: { enabled: "false" } } },
    }));
    expect(nets.facebook.enabled).toBe(true);
    expect(nets.facebook.database.sql.enabled).toBe(false);
  });
  it("getRawFileConfig returns null → netCfg defaults to {}", () => {
    const cfg = makeConfig({ env: "production" });
    cfg.getRawFileConfig = () => null;
    const nets = freshNetworks(cfg);
    expect(nets.facebook.enabled).toBe(true);
  });
});

describe("config/networks > all 11 networks expose expected shape", () => {
  it("each network has slug + database section", () => {
    const nets = freshNetworks(makeConfig({ env: "production" }));
    for (const slug of ["facebook", "google", "instagram", "gdn", "linkedin", "native", "pinterest", "quora", "reddit", "tiktok", "youtube"]) {
      expect(nets[slug]).toBeDefined();
      expect(nets[slug].slug).toBe(slug);
      expect(nets[slug].database).toBeDefined();
    }
  });
});
