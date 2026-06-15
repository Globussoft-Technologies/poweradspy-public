import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Fake mongoose
const mongoose = {
  connection: {
    readyState: 0,
    db: { collection: vi.fn() },
  },
  connect: vi.fn(),
};
const mongoosePath = require.resolve("mongoose");
require.cache[mongoosePath] = {
  id: mongoosePath, filename: mongoosePath, loaded: true,
  exports: mongoose,
};

// Helper: re-require module fresh so module-level isConnecting/connectPromise reset.
function freshModule() {
  const modPath = require.resolve("../../mongo-db/connection");
  delete require.cache[modPath];
  return require("../../mongo-db/connection");
}

let connectToMongo, getCollection;

beforeEach(() => {
  mongoose.connection.readyState = 0;
  mongoose.connect.mockReset();
  mongoose.connection.db.collection.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  ({ connectToMongo, getCollection } = freshModule());
});

describe("mongo-db/connection > connectToMongo", () => {
  it("noop when already connected (readyState=1)", async () => {
    mongoose.connection.readyState = 1;
    const out = await connectToMongo();
    expect(out).toBeUndefined();
    expect(mongoose.connect).not.toHaveBeenCalled();
  });

  it("calls mongoose.connect with mongodb+srv URI for ADSGPT", async () => {
    process.env.MONGO_DB = "ADSGPT";
    process.env.ADSGPT_MONGO_HOST = "atlas-host";
    process.env.ADSGPT_MONGO_USERNAME = "u";
    process.env.ADSGPT_MONGO_PASS = "p";
    process.env.ADSGPT_MONGO_DATABASE = "adsGPT";
    mongoose.connect.mockResolvedValueOnce(undefined);
    await connectToMongo();
    expect(mongoose.connect.mock.calls[0][0]).toContain("mongodb+srv://u:p@atlas-host/adsGPT");
  });

  it("calls mongoose.connect with direct mongodb URI for PAS with credentials", async () => {
    process.env.MONGO_DB = "PAS";
    process.env.PAS_MONGO_HOST = "internal-mongo";
    process.env.PAS_MONGO_PORT = "27017";
    process.env.PAS_MONGO_DATABASE = "pasdev_competitor";
    process.env.PAS_MONGO_USERNAME = "u";
    process.env.PAS_MONGO_PASS = "p";
    mongoose.connect.mockResolvedValueOnce(undefined);
    await connectToMongo();
    expect(mongoose.connect.mock.calls[0][0]).toContain("mongodb://u:p@internal-mongo:27017/pasdev_competitor");
  });

  it("returns in-flight promise when isConnecting", async () => {
    let resolveConnect;
    mongoose.connect.mockReturnValueOnce(new Promise((r) => { resolveConnect = r; }));
    const p1 = connectToMongo();
    const p2 = connectToMongo();
    // Both calls await the same underlying mongoose.connect — mongoose.connect
    // is only invoked once, even though connectToMongo's async wrapper produces
    // distinct outer Promises.
    resolveConnect();
    await Promise.all([p1, p2]);
    expect(mongoose.connect).toHaveBeenCalledTimes(1);
  });

  it("propagates connection errors", async () => {
    mongoose.connect.mockReturnValueOnce(Promise.reject(new Error("mongo-down")));
    await expect(connectToMongo()).rejects.toThrow("mongo-down");
  });
});

describe("mongo-db/connection > getCollection", () => {
  it("returns collection when connected", () => {
    mongoose.connection.readyState = 1;
    mongoose.connection.db.collection.mockReturnValueOnce({ stub: true });
    const c = getCollection("users");
    expect(c).toEqual({ stub: true });
  });

  it("kicks off connectToMongo when not connected", () => {
    mongoose.connection.readyState = 0;
    mongoose.connect.mockReturnValueOnce(Promise.resolve());
    mongoose.connection.db.collection.mockReturnValueOnce({ ok: true });
    getCollection("users");
    expect(mongoose.connect).toHaveBeenCalled();
  });
});
