import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const constants = require("../../src/utils/constants");

describe("utils/constants", () => {
  it("exports HTTP status codes", () => {
    expect(constants.HTTP).toEqual({
      OK: 200,
      CREATED: 201,
      BAD_REQUEST: 400,
      UNAUTHORIZED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      INTERNAL_SERVER_ERROR: 500,
    });
  });

  it("exports ERROR_CODES strings", () => {
    expect(constants.ERROR_CODES).toEqual({
      VALIDATION_ERROR: "VALIDATION_ERROR",
      AUTH_ERROR: "AUTH_ERROR",
      DB_ERROR: "DB_ERROR",
      RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
    });
  });

  it("exports CACHE_NS prefix strings", () => {
    expect(constants.CACHE_NS).toEqual({
      USER_PLAN: "user:plan:",
      SEARCH_RESULT: "search:res:",
    });
  });
});
