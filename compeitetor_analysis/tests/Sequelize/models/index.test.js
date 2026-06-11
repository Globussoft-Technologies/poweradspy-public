import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
import { Module } from "module";
import path from "path";

// The SUT uses createRequire(import.meta.url) to:
//   - require('../config/config.json')      ← real file does NOT exist (gitignored)
//   - require(path.join(__dirname, file))    ← per-model .cjs files
//
// Monkey-patch Module._resolveFilename so a request for the missing config
// resolves to a virtual path; then pre-cache that virtual path in require.cache.
const require = createRequire(import.meta.url);

const sutDir = path.resolve(process.cwd(), "Sequelize/models");
const configJsonPath = path.resolve(sutDir, "../config/config.json");
const userDetailsPath = path.resolve(sutDir, "user_details.cjs");

const fakeConfig = {
  development: { username: "u", password: "p", database: "d", host: "127.0.0.1", dialect: "mysql" },
  production: { use_env_variable: "DATABASE_URL", dialect: "mysql" },
};
const fakeModel = (sequelize, DataTypes) => ({ name: "user_details", associate: vi.fn() });

// Intercept _resolveFilename for the two paths so they 'exist'.
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (parent && parent.filename) {
    const parentDir = path.dirname(parent.filename);
    const abs = path.resolve(parentDir, request);
    if (abs === configJsonPath || abs === userDetailsPath) return abs;
  }
  return originalResolve.call(this, request, parent, ...rest);
};

require.cache[configJsonPath] = {
  id: configJsonPath, filename: configJsonPath, loaded: true,
  exports: fakeConfig,
};
require.cache[userDetailsPath] = {
  id: userDetailsPath, filename: userDetailsPath, loaded: true,
  exports: fakeModel,
};

// Mock sequelize so we don't actually try to connect.
const { SequelizeCtor, sequelizeInstances } = vi.hoisted(() => {
  const instances = [];
  function Sequelize(...args) {
    this.args = args;
    instances.push(this);
  }
  Sequelize.DataTypes = { STRING: "STRING", INTEGER: "INTEGER" };
  return { SequelizeCtor: Sequelize, sequelizeInstances: instances };
});

vi.mock("sequelize", () => ({ default: SequelizeCtor }));

beforeEach(() => {
  sequelizeInstances.length = 0;
});

describe("Sequelize/models/index", () => {
  it("development env: instantiates Sequelize(database, user, pass, opts)", async () => {
    process.env.NODE_ENV = "development";
    vi.resetModules();
    const modPath = require.resolve("../../../Sequelize/models/index.js");
    delete require.cache[modPath];
    const { default: db } = await import("../../../Sequelize/models/index.js");
    expect(sequelizeInstances.length).toBe(1);
    expect(sequelizeInstances[0].args[0]).toBe("d"); // database
    expect(sequelizeInstances[0].args[1]).toBe("u"); // username
    expect(db.user_details).toBeDefined();
    expect(db.sequelize).toBe(sequelizeInstances[0]);
    expect(db.Sequelize).toBe(SequelizeCtor);
  });

  it("production env: uses use_env_variable branch", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "mysql://h/d";
    vi.resetModules();
    const modPath = require.resolve("../../../Sequelize/models/index.js");
    delete require.cache[modPath];
    await import("../../../Sequelize/models/index.js");
    expect(sequelizeInstances[0].args[0]).toBe("mysql://h/d");
    if (prev === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prev;
  });

  it("NODE_ENV unset: falls through to 'development' default", async () => {
    const prev = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    vi.resetModules();
    const modPath = require.resolve("../../../Sequelize/models/index.js");
    delete require.cache[modPath];
    await import("../../../Sequelize/models/index.js");
    expect(sequelizeInstances.length).toBe(1);
    if (prev === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prev;
  });

  it("model without associate(): covers the falsy branch of `if (db[modelName].associate)`", async () => {
    // Swap the cached fake model for one that doesn't define `associate`,
    // then re-import the SUT so the forEach loop hits the false branch.
    const noAssocModel = (sequelize, DataTypes) => ({ name: "user_details_no_assoc" });
    const prevCache = require.cache[userDetailsPath];
    require.cache[userDetailsPath] = {
      id: userDetailsPath, filename: userDetailsPath, loaded: true,
      exports: noAssocModel,
    };
    process.env.NODE_ENV = "development";
    vi.resetModules();
    const modPath = require.resolve("../../../Sequelize/models/index.js");
    delete require.cache[modPath];
    const { default: db } = await import("../../../Sequelize/models/index.js");
    expect(db.user_details_no_assoc).toBeDefined();
    expect(db.user_details_no_assoc.associate).toBeUndefined();
    // restore the original cached model for the other tests
    require.cache[userDetailsPath] = prevCache;
  });
});
