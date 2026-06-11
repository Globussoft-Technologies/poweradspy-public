import { describe, it, expect } from "vitest";
import response from "../../utils/response.js";

describe("utils/response > Response class", () => {
  it("userSuccessResp wraps data in a 200 success envelope", () => {
    expect(response.userSuccessResp("ok", { id: 1 })).toEqual({
      statusCode: 200,
      body: { status: "success", message: "ok", data: { id: 1 } },
    });
  });

  it("userFailResp wraps error in a 400 failed envelope", () => {
    const err = new Error("nope");
    expect(response.userFailResp("bad", err)).toEqual({
      statusCode: 400,
      body: { status: "failed", message: "bad", error: err },
    });
  });

  it("validationFailResp matches the userFail shape (400 failed)", () => {
    expect(response.validationFailResp("invalid", "details")).toEqual({
      statusCode: 400,
      body: { status: "failed", message: "invalid", error: "details" },
    });
  });

  it("searchFilterResp wraps data + totalAds in a 200 success envelope", () => {
    expect(response.searchFilterResp("found", [1, 2, 3], 99)).toEqual({
      statusCode: 200,
      body: { status: "success", message: "found", totalAds: 99, data: [1, 2, 3] },
    });
  });
});
