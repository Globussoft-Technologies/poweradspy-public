import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const ResponseFormatter = require("../../src/utils/responseFormatter");

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe("utils/responseFormatter > success", () => {
  it("default args wrap null data + 'Success' + code 200", () => {
    const res = mockRes();
    ResponseFormatter.success(res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      code: 200, message: "Success", data: null, meta: {},
    });
  });

  it("primitive data passes through unchanged", () => {
    const res = mockRes();
    ResponseFormatter.success(res, [1, 2, 3], "ok", 201, { page: 1 });
    expect(res.json).toHaveBeenCalledWith({
      code: 201, message: "ok", data: [1, 2, 3], meta: { page: 1 },
    });
  });

  it("data with .data property unwraps and merges meta (line 7-9)", () => {
    const res = mockRes();
    ResponseFormatter.success(
      res,
      { data: [{ id: 1 }], meta: { total: 10 } },
      "fetched",
      200,
      { page: 2 }
    );
    expect(res.json).toHaveBeenCalledWith({
      code: 200,
      message: "fetched",
      data: [{ id: 1 }],
      meta: { page: 2, total: 10 },
    });
  });

  it("data with .data but no .meta merges with empty (line 9 `|| {}`)", () => {
    const res = mockRes();
    ResponseFormatter.success(res, { data: { x: 1 } });
    expect(res.json).toHaveBeenCalledWith({
      code: 200, message: "Success", data: { x: 1 }, meta: {},
    });
  });

  it("Array.isArray(data) → not unwrapped", () => {
    const res = mockRes();
    ResponseFormatter.success(res, [{ data: "x" }]);
    expect(res.json.mock.calls[0][0].data).toEqual([{ data: "x" }]);
  });

  it("falsy data → not unwrapped", () => {
    const res = mockRes();
    ResponseFormatter.success(res, 0);
    expect(res.json.mock.calls[0][0].data).toBe(0);
  });
});

describe("utils/responseFormatter > error", () => {
  it("default args: 500 + 'An error occurred'", () => {
    const res = mockRes();
    ResponseFormatter.error(res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      code: 500, message: "An error occurred",
    });
  });

  it("custom code + errorData attaches .error field", () => {
    const res = mockRes();
    ResponseFormatter.error(res, "bad input", 400, { field: "email" });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      code: 400, message: "bad input", error: { field: "email" },
    });
  });

  it("errorData falsy → no .error field", () => {
    const res = mockRes();
    ResponseFormatter.error(res, "msg", 422, null);
    expect(res.json.mock.calls[0][0].error).toBeUndefined();
  });
});
