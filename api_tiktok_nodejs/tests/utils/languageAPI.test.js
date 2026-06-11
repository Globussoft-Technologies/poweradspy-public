import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { loggerErrorSpy, userFailRespSpy } = vi.hoisted(() => ({
  loggerErrorSpy: vi.fn(),
  userFailRespSpy: vi.fn((msg, err) => ({ ok: false, message: msg, err })),
}));

vi.mock("../../resources/logs/logger.log.js", () => ({
  default: { error: loggerErrorSpy },
}));

vi.mock("../../utils/response.js", () => ({
  default: { userFailResp: userFailRespSpy },
}));

vi.mock("config", () => ({
  default: {
    get: (key) => {
      if (key === "language_tanslation_api") {
        return "https://lang.test/api/translate";
      }
      throw new Error(`unstubbed config key: ${key}`);
    },
  },
}));

let languageTranslation;
let fetchSpy;

beforeEach(async () => {
  vi.resetModules();
  loggerErrorSpy.mockClear();
  userFailRespSpy.mockClear();
  fetchSpy = vi.spyOn(global, "fetch").mockImplementation(() => {
    throw new Error("set fetch behaviour per-test");
  });
  ({ default: languageTranslation } = await import("../../utils/languageAPI.js"));
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.send = vi.fn(() => res);
  return res;
}

describe("utils/languageAPI > languageTranslation (default export)", () => {
  it("POSTs the payload to the configured translation API and returns language_name on success", async () => {
    fetchSpy.mockResolvedValueOnce({
      json: async () => ({ language_name: "English" }),
    });
    const result = await languageTranslation("Buy now!", mockRes());
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://lang.test/api/translate",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
    );
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body).toEqual({
      title: "Buy now!",
      text: "",
      newsfeed_description: "",
      call_to_action: "",
    });
    expect(result).toBe("English");
  });

  it("returns undefined when the API responds without a language_name field", async () => {
    fetchSpy.mockResolvedValueOnce({ json: async () => ({}) });
    const result = await languageTranslation("hello", mockRes());
    expect(result).toBeUndefined();
  });

  it("logs and 500s when fetch itself rejects", async () => {
    const err = new Error("ETIMEDOUT");
    fetchSpy.mockRejectedValueOnce(err);
    const res = mockRes();
    await languageTranslation("hello", res);
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      "Error in language translation api",
      err
    );
    expect(userFailRespSpy).toHaveBeenCalledWith(
      "Error in language translation API",
      err
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({
      ok: false,
      message: "Error in language translation API",
      err,
    });
  });

  it("logs and 500s when response.json() rejects", async () => {
    const err = new Error("bad json");
    fetchSpy.mockResolvedValueOnce({
      json: async () => {
        throw err;
      },
    });
    const res = mockRes();
    await languageTranslation("hello", res);
    expect(loggerErrorSpy).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
