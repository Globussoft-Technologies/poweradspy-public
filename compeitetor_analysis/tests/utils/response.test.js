import { describe, it, expect } from "vitest";
import Response from "../../utils/response.js";

describe("utils/response", () => {
  it("userSuccessResp wraps data with statusCode 200", () => {
    const out = Response.userSuccessResp("ok", { id: 1 });
    expect(out).toEqual({
      statusCode: 200,
      body: { status: "success", message: "ok", data: { id: 1 } },
    });
  });

  it("userFailResp wraps error with statusCode 400", () => {
    const out = Response.userFailResp("failed", "boom");
    expect(out).toEqual({
      statusCode: 400,
      body: { status: "failed", message: "failed", error: "boom" },
    });
  });

  it("validationFailResp also 400", () => {
    const out = Response.validationFailResp("validation", { field: "name" });
    expect(out).toEqual({
      statusCode: 400,
      body: { status: "failed", message: "validation", error: { field: "name" } },
    });
  });

  it("searchFilterResp returns 200 with totalAds + data", () => {
    const out = Response.searchFilterResp("results", [{ a: 1 }], 99);
    expect(out).toEqual({
      statusCode: 200,
      body: { status: "success", message: "results", totalAds: 99, data: [{ a: 1 }] },
    });
  });

  it("messageResp returns 400 with just a message body", () => {
    expect(Response.messageResp("err")).toEqual({
      statusCode: 400,
      body: { message: "err" },
    });
  });

  it("messageRespComp returns 401 with just a message body", () => {
    expect(Response.messageRespComp("unauth")).toEqual({
      statusCode: 401,
      body: { message: "unauth" },
    });
  });
});
