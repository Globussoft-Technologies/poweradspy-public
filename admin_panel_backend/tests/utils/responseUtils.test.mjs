import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { successResponse, errorResponse } = require("../../utils/responseUtils");

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe("utils/responseUtils > successResponse", () => {
  it("defaults to status 200 and message 'Success'", () => {
    const res = mockRes();
    successResponse(res, { id: 1 });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: "Success",
      data: { id: 1 },
    });
  });

  it("honours custom message and status", () => {
    const res = mockRes();
    successResponse(res, [1, 2, 3], "Created", 201);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: "Created",
      data: [1, 2, 3],
    });
  });
});

describe("utils/responseUtils > errorResponse", () => {
  it("defaults to status 500 and message 'Error'", () => {
    const res = mockRes();
    errorResponse(res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "Error",
    });
  });

  it("honours custom message and status", () => {
    const res = mockRes();
    errorResponse(res, "Not Found", 404);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "Not Found",
    });
  });
});
