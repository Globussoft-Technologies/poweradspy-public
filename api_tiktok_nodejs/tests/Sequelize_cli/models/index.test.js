import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import Module from "node:module";
import { createRequire } from "node:module";

// Sequelize_cli/models/index.js uses createRequire to load
// ../config/config.json. We can't physically create that file (it's
// gitignored and the cron must never create it). Instead, install a fake
// into the require.cache under the exact absolute path the SUT will
// resolve, then re-import the SUT.
//
// Also mocks: sequelize (ESM default import, vi.mock works), fs.readdirSync.

const sutAbs = path.resolve(
  process.cwd(),
  "Sequelize_cli/models/index.js"
);
const resolvedConfigPath = path.resolve(
  path.dirname(sutAbs),
  "../config/config.json"
);

const fakeConfig = {
  production: {
    database: "p_db",
    username: "p_user",
    password: "p_pw",
    host: "p_host",
    dialect: "mysql",
  },
  envvar_env: {
    use_env_variable: "DB_URL",
    dialect: "mysql",
  },
};

vi.mock("sequelize", () => {
  const sync = vi.fn();
  const Ctor = vi.fn(function () {
    this.sync = sync;
    return this;
  });
  Ctor.DataTypes = { STRING: "STRING", INTEGER: "INTEGER" };
  return { default: Ctor };
});

// Bind a require to a path inside the SUT directory so its cache is the
// same Node-level cache the SUT will hit.
const _r = createRequire(path.join(path.dirname(sutAbs), "models-sibling.js"));
function installInCache(absPath, exports) {
  _r.cache[absPath] = { id: absPath, filename: absPath, loaded: true, exports };
}

// Node's require() resolves to an absolute path BEFORE consulting
// require.cache, and the resolution itself throws ENOENT for files that
// don't exist on disk. ../config/config.json is gitignored and the cron
// must never create it. Hook _resolveFilename so it pretends our virtual
// paths exist.
const _origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, parent, ...rest) {
  if (
    req === "../config/config.json" &&
    parent &&
    parent.filename &&
    parent.filename.endsWith(path.join("Sequelize_cli", "models", "index.js"))
  ) {
    return resolvedConfigPath;
  }
  // Allow virtual fake-model paths through too
  if (req.endsWith(".cjs") && parent && parent.filename === sutAbs) {
    // The SUT does path.join(__dirname, file); req is already absolute
    return req;
  }
  return _origResolve.call(this, req, parent, ...rest);
};

let readdirSpy;

beforeEach(() => {
  vi.resetModules();
  // re-install the fake config every test (cache may have been busted)
  installInCache(resolvedConfigPath, JSON.parse(JSON.stringify(fakeConfig)));
});

async function loadSut({ env = "production", files = [], factories = {} } = {}) {
  process.env.NODE_ENV = env;
  for (const f of files) {
    if (factories[f]) {
      installInCache(
        path.join(path.dirname(sutAbs), f),
        factories[f]
      );
    }
  }
  readdirSpy = vi.spyOn(fs, "readdirSync").mockReturnValue(files);
  vi.resetModules();
  return await import("../../../Sequelize_cli/models/index.js");
}

describe("Sequelize_cli/models/index.js", () => {
  it("constructs Sequelize with (database, username, password, config) for the production env", async () => {
    const mod = await loadSut({ env: "production" });
    const { default: Sequelize } = await import("sequelize");
    expect(Sequelize).toHaveBeenCalled();
    const lastCall = Sequelize.mock.calls.at(-1);
    expect(lastCall[0]).toBe("p_db");
    expect(lastCall[1]).toBe("p_user");
    expect(lastCall[2]).toBe("p_pw");
    expect(lastCall[3].host).toBe("p_host");
    expect(mod.default.sequelize).toBeDefined();
    expect(mod.default.Sequelize).toBe(Sequelize);
  });

  it("constructs Sequelize via use_env_variable when configured", async () => {
    process.env.DB_URL = "mysql://x";
    await loadSut({ env: "envvar_env" });
    const { default: Sequelize } = await import("sequelize");
    const lastCall = Sequelize.mock.calls.at(-1);
    expect(lastCall[0]).toBe("mysql://x");
  });

  it("defaults env to 'production' when NODE_ENV is unset", async () => {
    delete process.env.NODE_ENV;
    installInCache(resolvedConfigPath, JSON.parse(JSON.stringify(fakeConfig)));
    readdirSpy = vi.spyOn(fs, "readdirSync").mockReturnValue([]);
    vi.resetModules();
    await import("../../../Sequelize_cli/models/index.js");
    const { default: Sequelize } = await import("sequelize");
    expect(Sequelize.mock.calls.at(-1)[0]).toBe("p_db");
  });

  it("loads .cjs model files, attaches by model.name, calls associate when present", async () => {
    const associateA = vi.fn();
    const factoryA = vi.fn(() => ({ name: "Ad", associate: associateA }));
    const factoryB = vi.fn(() => ({ name: "Owner" }));
    const mod = await loadSut({
      env: "production",
      files: ["AdModel.cjs", "OwnerModel.cjs"],
      factories: { "AdModel.cjs": factoryA, "OwnerModel.cjs": factoryB },
    });
    expect(factoryA).toHaveBeenCalled();
    expect(factoryB).toHaveBeenCalled();
    expect(associateA).toHaveBeenCalledTimes(1);
    expect(mod.default.Ad).toBeDefined();
    expect(mod.default.Owner).toBeDefined();
  });

  it("filters out hidden files, the index file itself, and non-.cjs files", async () => {
    const kept = vi.fn(() => ({ name: "Kept" }));
    const mod = await loadSut({
      env: "production",
      files: [".hidden", "index.js", "skip.js", "Kept.cjs"],
      factories: { "Kept.cjs": kept },
    });
    expect(kept).toHaveBeenCalledTimes(1);
    expect(mod.default.Kept).toBeDefined();
  });
});
