import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Mock errorHandler — only AppError is used. Logger inside errorHandler is
// transitively required, so pre-stub it too.
const loggerPath = require.resolve("../../src/logger");
require.cache[loggerPath] = {
  id: loggerPath, filename: loggerPath, loaded: true,
  exports: {
    createChild: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
  },
};

const validator = require("../../src/middleware/validator");

function mockReq({ body = {}, query = {}, params = {} } = {}) {
  return { body, query, params };
}

describe("middleware/validator", () => {
  it("passes through when no schema matches anything", () => {
    const mw = validator({});
    const next = vi.fn();
    mw(mockReq(), {}, next);
    expect(next).toHaveBeenCalledWith(); // no error
  });

  it("required field missing → next(AppError) with statusCode 400", () => {
    const mw = validator({ body: { email: { required: true } } });
    const next = vi.fn();
    mw(mockReq({ body: {} }), {}, next);
    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err.message).toContain("body.email is required");
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe("VALIDATION_ERROR");
  });

  it("required field empty string → fails", () => {
    const mw = validator({ query: { q: { required: true } } });
    const next = vi.fn();
    mw(mockReq({ query: { q: "" } }), {}, next);
    const err = next.mock.calls[0][0];
    expect(err.message).toContain("query.q is required");
  });

  it("required field null → fails", () => {
    const mw = validator({ params: { id: { required: true } } });
    const next = vi.fn();
    mw(mockReq({ params: { id: null } }), {}, next);
    const err = next.mock.calls[0][0];
    expect(err.message).toContain("params.id is required");
  });

  it("number type with non-numeric value → fails", () => {
    const mw = validator({ body: { age: { type: "number" } } });
    const next = vi.fn();
    mw(mockReq({ body: { age: "abc" } }), {}, next);
    const err = next.mock.calls[0][0];
    expect(err.message).toContain("body.age must be a number");
  });

  it("number type with numeric string → passes", () => {
    const mw = validator({ body: { age: { type: "number" } } });
    const next = vi.fn();
    mw(mockReq({ body: { age: "42" } }), {}, next);
    expect(next).toHaveBeenCalledWith();
  });

  it("boolean type with non-boolean value → fails", () => {
    const mw = validator({ query: { flag: { type: "boolean" } } });
    const next = vi.fn();
    mw(mockReq({ query: { flag: "maybe" } }), {}, next);
    const err = next.mock.calls[0][0];
    expect(err.message).toContain("query.flag must be a boolean");
  });

  it("boolean type with 'true' or 'false' string → passes", () => {
    const mw = validator({ query: { flag: { type: "boolean" } } });
    const next1 = vi.fn();
    mw(mockReq({ query: { flag: "true" } }), {}, next1);
    expect(next1).toHaveBeenCalledWith();
    const next2 = vi.fn();
    mw(mockReq({ query: { flag: "false" } }), {}, next2);
    expect(next2).toHaveBeenCalledWith();
  });

  it("boolean type with real boolean → passes", () => {
    const mw = validator({ body: { flag: { type: "boolean" } } });
    const next = vi.fn();
    mw(mockReq({ body: { flag: true } }), {}, next);
    expect(next).toHaveBeenCalledWith();
  });

  it("multiple errors accumulate then join", () => {
    const mw = validator({
      body: {
        email: { required: true },
        age: { type: "number" },
      },
    });
    const next = vi.fn();
    mw(mockReq({ body: { age: "x" } }), {}, next);
    const err = next.mock.calls[0][0];
    expect(err.message).toContain("body.email is required");
    expect(err.message).toContain("body.age must be a number");
    expect(err.message.includes(", ")).toBe(true);
  });

  it("undefined value with type rule does not validate type (line 23 false branch)", () => {
    const mw = validator({ body: { age: { type: "number" } } });
    const next = vi.fn();
    mw(mockReq({ body: {} }), {}, next);
    expect(next).toHaveBeenCalledWith();
  });

  it("source key missing from schema → skip iteration (line 15 false branch)", () => {
    // only body schema, params not validated
    const mw = validator({ body: {} });
    const next = vi.fn();
    mw(mockReq({ params: { whatever: "x" } }), {}, next);
    expect(next).toHaveBeenCalledWith();
  });
});
