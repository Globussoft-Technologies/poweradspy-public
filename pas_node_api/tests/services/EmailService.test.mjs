import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const axiosPath = require.resolve("axios");
const axiosPost = vi.fn();
require.cache[axiosPath] = {
  id: axiosPath, filename: axiosPath, loaded: true,
  exports: { post: axiosPost, default: { post: axiosPost } },
};

const loggerPath = require.resolve("../../src/logger");
const childLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
require.cache[loggerPath] = {
  id: loggerPath, filename: loggerPath, loaded: true,
  exports: { createChild: vi.fn(() => childLog) },
};

const configPath = require.resolve("../../src/config");
let configExports = { sendgrid: { apiKey: "sg-key", fromEmail: "n@p.com", fromName: "Test Sender" } };
require.cache[configPath] = {
  id: configPath, filename: configPath, loaded: true,
  get exports() { return configExports; },
  set exports(v) { configExports = v; },
};

const sutPath = require.resolve("../../src/services/EmailService");
function freshSut() {
  delete require.cache[sutPath];
  return require(sutPath);
}

beforeEach(() => {
  axiosPost.mockReset();
  childLog.info.mockClear(); childLog.error.mockClear();
  configExports = { sendgrid: { apiKey: "sg-key", fromEmail: "n@p.com", fromName: "Test Sender" } };
  delete process.env.APP_URL;
});

describe("EmailService > constructor", () => {
  it("reads config values", () => {
    const svc = freshSut();
    expect(svc.sendGridApiKey).toBe("sg-key");
    expect(svc.fromEmail).toBe("n@p.com");
    expect(svc.fromName).toBe("Test Sender");
  });
  it("falls back to defaults when sendgrid config missing", () => {
    configExports = {};
    const svc = freshSut();
    expect(svc.fromEmail).toBe("noreply@poweradspy.com");
    expect(svc.fromName).toBe("PowerAdSpy");
    expect(svc.sendGridApiKey).toBeUndefined();
  });
});

describe("EmailService > sendDailyMailUpdate", () => {
  it("returns status:false when email missing", async () => {
    const svc = freshSut();
    const out = await svc.sendDailyMailUpdate("", "User", {}, {}, {});
    expect(out.status).toBe(false);
    expect(out.message).toBe("Email is required");
    expect(childLog.error).toHaveBeenCalled();
  });

  it("happy path with ads + keywords → posts to SendGrid", async () => {
    axiosPost.mockResolvedValue({ status: 202 });
    const svc = freshSut();
    const out = await svc.sendDailyMailUpdate(
      "u@b.com", "User",
      ["facebook", "instagram"],
      { facebook: ["k1", "k2"], instagram: ["k3"] },
      {
        image_url: ["https://i/1.png", "https://i/2.png"],
        title: ["T1 short", "T2 a very very very very very very very long title needing truncation"],
        text: ["Body 1 short", "Body 2 a very very very very very very very long text"],
        adId: ["a1", "a2"],
      },
    );
    expect(out.status).toBe(true);
    expect(axiosPost).toHaveBeenCalledWith(
      "https://api.sendgrid.com/v3/mail/send",
      expect.objectContaining({
        personalizations: expect.any(Array),
        from: { email: "n@p.com", name: "Test Sender" },
      }),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer sg-key" }),
      })
    );
    const payload = axiosPost.mock.calls[0][1];
    const html = payload.content[0].value;
    expect(html).toContain("Hello, User!");
    expect(html).toContain("k1");
    expect(html).toContain("FACEBOOK");
  });

  it("respects APP_URL env when set", async () => {
    process.env.APP_URL = "https://custom.app";
    axiosPost.mockResolvedValue({ status: 202 });
    const svc = freshSut();
    await svc.sendDailyMailUpdate(
      "u@b.com", "U",
      ["facebook"],
      { facebook: ["k"] },
      { image_url: [], title: [], text: [], adId: [] }
    );
    const html = axiosPost.mock.calls[0][1].content[0].value;
    expect(html).toContain("https://custom.app");
  });

  it("ads block omitted (no image_url) → 'No ads found yet'", async () => {
    axiosPost.mockResolvedValue({ status: 202 });
    const svc = freshSut();
    await svc.sendDailyMailUpdate(
      "u@b.com", "U", [], { facebook: [] }, {}
    );
    const html = axiosPost.mock.calls[0][1].content[0].value;
    expect(html).toContain("No ads found yet");
  });

  it("ads with image_url empty array → 'No ads found yet'", async () => {
    axiosPost.mockResolvedValue({ status: 202 });
    const svc = freshSut();
    await svc.sendDailyMailUpdate(
      "u@b.com", "U", [], { facebook: [] }, { image_url: [] }
    );
    const html = axiosPost.mock.calls[0][1].content[0].value;
    expect(html).toContain("No ads found yet");
  });

  it("ads with missing title/text/adId fields → uses defaults ('Ad', 'Ad text', '')", async () => {
    axiosPost.mockResolvedValue({ status: 202 });
    const svc = freshSut();
    await svc.sendDailyMailUpdate(
      "u@b.com", "U", [], { facebook: [] },
      { image_url: ["https://i/1.png"] /* no title, text, adId */ }
    );
    const html = axiosPost.mock.calls[0][1].content[0].value;
    expect(html).toContain("Ad text");
  });

  it("axios.post throws → status:false + logger.error", async () => {
    axiosPost.mockRejectedValue(new Error("sendgrid-down"));
    const svc = freshSut();
    const out = await svc.sendDailyMailUpdate(
      "u@b.com", "U", [], {}, {}
    );
    expect(out.status).toBe(false);
    expect(out.message).toBe("sendgrid-down");
  });
});
