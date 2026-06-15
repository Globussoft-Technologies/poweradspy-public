import { describe, it, expect, vi, beforeEach } from "vitest";

const postMock = vi.fn();
const getMock = vi.fn();
vi.mock("axios", () => ({
  default: { post: (...a) => postMock(...a), get: (...a) => getMock(...a) },
}));
vi.mock("js-cookie", () => ({
  default: { get: (k) => (k === "token" ? "MYTOKEN" : undefined) },
}));

import { postApiCall, getApiCall, storeApiCall, getApiCallWithParams, postApiCallWithBody } from "../../../src/components/Pas/ApiResponse.jsx";

beforeEach(() => {
  postMock.mockReset();
  getMock.mockReset();
  vi.stubEnv("VITE_SEARCHES_API", "https://search.example.com/");
  vi.stubEnv("VITE_LINKEDIN_API", "https://linkedin.example.com/");
  localStorage.clear();
});

describe("ApiResponse.postApiCall", () => {
  it("posts to the given URL with auth header + payload, returns data", async () => {
    postMock.mockResolvedValue({ data: { ok: true, id: 7 } });
    const result = await postApiCall("https://x.com/foo", { name: "n" });
    expect(postMock).toHaveBeenCalledWith(
      "https://x.com/foo",
      { name: "n" },
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer MYTOKEN",
          "Content-Type": "application/json",
        }),
      }),
    );
    expect(result).toEqual({ ok: true, id: 7 });
  });
  it("on axios error with response → returns error.response.data", async () => {
    postMock.mockRejectedValue({ response: { data: "bad payload" } });
    const result = await postApiCall("u", {});
    expect(result).toEqual({ success: false, message: "bad payload" });
  });
  it("on axios error without response → returns error.message", async () => {
    postMock.mockRejectedValue({ message: "timeout" });
    const result = await postApiCall("u", {});
    expect(result).toEqual({ success: false, message: "timeout" });
  });
});

describe("ApiResponse.getApiCall", () => {
  it("gets get-all-users?page=N with auth header", async () => {
    getMock.mockResolvedValue({ data: { users: [] } });
    const result = await getApiCall(3);
    expect(getMock).toHaveBeenCalledWith(
      "https://search.example.com/get-all-users?page=3",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer MYTOKEN" }),
      }),
    );
    expect(result).toEqual({ users: [] });
  });
  it("on error with response → returns error.response.data", async () => {
    getMock.mockRejectedValue({ response: { data: "denied" } });
    const result = await getApiCall(1);
    expect(result).toEqual({ success: false, message: "denied" });
  });
  it("on error without response → returns error.message", async () => {
    getMock.mockRejectedValue({ message: "net down" });
    const result = await getApiCall(1);
    expect(result).toEqual({ success: false, message: "net down" });
  });
});

describe("ApiResponse.storeApiCall", () => {
  it("happy path: gets plan info, merges + posts to daily-keyword-request", async () => {
    localStorage.setItem("emailF", "user@x.com");
    getMock.mockResolvedValue({
      data: { data: [{ email: "u@x.com", user_name: "U", planId: 42, user_id: "uid" }] },
    });
    postMock.mockResolvedValue({ data: { stored: true } });
    const result = await storeApiCall({ keyword: "shoes" });
    expect(getMock).toHaveBeenCalledWith(
      "https://search.example.com/get-planId?email=user@x.com",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer MYTOKEN" }),
      }),
    );
    expect(postMock).toHaveBeenCalledWith(
      "https://linkedin.example.com/daily-keyword-request",
      expect.objectContaining({
        keyword: "shoes",
        email: "u@x.com",
        user_name: "U",
        planId: 42,
        user_id: "uid",
      }),
      expect.any(Object),
    );
    expect(result).toEqual({ stored: true });
  });
  it("planId nullish → defaults to 0", async () => {
    localStorage.setItem("emailF", "x@y.com");
    getMock.mockResolvedValue({
      data: { data: [{ email: "x@y.com", user_name: "X", planId: null, user_id: "uid2" }] },
    });
    postMock.mockResolvedValue({ data: { stored: true } });
    await storeApiCall({});
    expect(postMock.mock.calls[0][1].planId).toBe(0);
  });
  it("post error with response → returns error.response.data", async () => {
    localStorage.setItem("emailF", "a@b.com");
    getMock.mockResolvedValue({
      data: { data: [{ email: "a", user_name: "A", planId: 1, user_id: "i" }] },
    });
    postMock.mockRejectedValue({ response: { data: "post error" } });
    const result = await storeApiCall({});
    expect(result).toEqual({ success: false, message: "post error" });
  });
  it("post error without response → returns error.message", async () => {
    localStorage.setItem("emailF", "a@b.com");
    getMock.mockResolvedValue({
      data: { data: [{ email: "a", user_name: "A", planId: 1, user_id: "i" }] },
    });
    postMock.mockRejectedValue({ message: "post offline" });
    const result = await storeApiCall({});
    expect(result).toEqual({ success: false, message: "post offline" });
  });
});

describe("ApiResponse.getApiCallWithParams", () => {
  it("gets the URL with nodeToken auth, params + credentials, returns data", async () => {
    getMock.mockResolvedValue({ data: { rows: [1, 2] } });
    const result = await getApiCallWithParams("https://x.com/list", { page: 2 });
    expect(getMock).toHaveBeenCalledWith(
      "https://x.com/list",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: expect.stringContaining("Bearer") }),
        params: { page: 2 },
        withCredentials: true,
      }),
    );
    expect(result).toEqual({ rows: [1, 2] });
  });
  it("on error with response → returns error.response.data", async () => {
    getMock.mockRejectedValue({ response: { data: "forbidden" } });
    const result = await getApiCallWithParams("u");
    expect(result).toEqual({ success: false, message: "forbidden" });
  });
  it("on error without response → returns error.message", async () => {
    getMock.mockRejectedValue({ message: "offline" });
    const result = await getApiCallWithParams("u");
    expect(result).toEqual({ success: false, message: "offline" });
  });
});

describe("ApiResponse.postApiCallWithBody", () => {
  it("posts the body with nodeToken auth header, returns data", async () => {
    postMock.mockResolvedValue({ data: { ok: 1 } });
    const result = await postApiCallWithBody("https://x.com/do", { a: 1 });
    expect(postMock).toHaveBeenCalledWith(
      "https://x.com/do",
      { a: 1 },
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: expect.stringContaining("Bearer"),
        }),
      }),
    );
    expect(result).toEqual({ ok: 1 });
  });
  it("on error with response → returns error.response.data", async () => {
    postMock.mockRejectedValue({ response: { data: "bad body" } });
    const result = await postApiCallWithBody("u", {});
    expect(result).toEqual({ success: false, message: "bad body" });
  });
  it("on error without response → returns error.message", async () => {
    postMock.mockRejectedValue({ message: "timeout" });
    const result = await postApiCallWithBody("u", {});
    expect(result).toEqual({ success: false, message: "timeout" });
  });
});
