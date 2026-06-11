import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  knFindOneSpy, knFindAllSpy, knCreateSpy, knUpdateSpy, knDestroySpy,
  msFindOneSpy, msCreateSpy,
  validateSpy, createTransportSpy, sendMailSpy, loggerErrorSpy,
} = vi.hoisted(() => ({
  knFindOneSpy: vi.fn(),
  knFindAllSpy: vi.fn(),
  knCreateSpy: vi.fn(),
  knUpdateSpy: vi.fn(),
  knDestroySpy: vi.fn(),
  msFindOneSpy: vi.fn(),
  msCreateSpy: vi.fn(),
  validateSpy: vi.fn(),
  createTransportSpy: vi.fn(),
  sendMailSpy: vi.fn(),
  loggerErrorSpy: vi.fn(),
}));

vi.mock("../../../Sequelize_cli/models/index.js", () => ({
  default: {
    keyword_notification: {
      findOne: knFindOneSpy,
      findAll: knFindAllSpy,
      create: knCreateSpy,
      update: knUpdateSpy,
      destroy: knDestroySpy,
    },
    mail_subscription: { findOne: msFindOneSpy, create: msCreateSpy },
    tiktok_ad_country_info: {},
  },
}));

vi.mock("../../../core/keywordNotification/keywordNotification.validation.js", () => ({
  default: { createKeywords: validateSpy },
}));

vi.mock("../../../resources/logs/logger.log.js", () => ({
  default: { info: vi.fn(), error: loggerErrorSpy, warn: vi.fn() },
}));

vi.mock("nodemailer", () => ({
  default: { createTransport: createTransportSpy },
  createTransport: createTransportSpy,
}));

vi.mock("config", () => ({ default: { get: vi.fn((k) => `cfg:${k}`) } }));

let svc;
beforeEach(async () => {
  vi.resetModules();
  for (const s of [
    knFindOneSpy, knFindAllSpy, knCreateSpy, knUpdateSpy, knDestroySpy,
    msFindOneSpy, msCreateSpy, validateSpy, createTransportSpy, sendMailSpy, loggerErrorSpy,
  ]) s.mockReset();
  createTransportSpy.mockReturnValue({ sendMail: sendMailSpy });
  ({ default: svc } = await import(
    "../../../core/keywordNotification/keywordNotification.service.js"
  ));
});

function mockRes() {
  const res = {};
  res.send = vi.fn(() => res);
  return res;
}

// Helper to build a Sequelize-shaped row that supports .get({plain: true})
function row(obj) {
  return { get: () => obj };
}

describe("keywordNotification.service > addKeywords", () => {
  it("VALIDATION_FAIL when validation errors", async () => {
    validateSpy.mockReturnValueOnce({ value: {}, error: { message: "bad" } });
    const res = mockRes();
    await svc.addKeywords({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("VALIDATION_FAIL");
  });

  it("creates MailSubscription + KeywordNotification when no subscription exists", async () => {
    validateSpy.mockReturnValueOnce({
      value: { user_id: 1, name: "u", email: "u@x", keyword: "k", duration: 1, type: 1 },
      error: undefined,
    });
    msFindOneSpy.mockResolvedValueOnce(null);
    msCreateSpy.mockResolvedValueOnce({ id: 1 });
    knCreateSpy.mockResolvedValueOnce({ id: 7 });
    const res = mockRes();
    await svc.addKeywords({ body: {} }, res);
    expect(msCreateSpy).toHaveBeenCalled();
    expect(knCreateSpy).toHaveBeenCalled();
    expect(res.send.mock.calls[0][0].body.message).toBe("Data added successfully");
  });

  it("'Failed to add data.' when MailSubscription.create returns falsy", async () => {
    validateSpy.mockReturnValueOnce({
      value: { user_id: 1 }, error: undefined,
    });
    msFindOneSpy.mockResolvedValueOnce(null);
    msCreateSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.addKeywords({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Failed to add data.");
  });

  it("'already exists' when subscription found and KN row already exists", async () => {
    validateSpy.mockReturnValueOnce({
      value: { user_id: 1, keyword: "k", duration: 1, type: 1 }, error: undefined,
    });
    msFindOneSpy.mockResolvedValueOnce({ id: 9 });
    knFindOneSpy.mockResolvedValueOnce({ id: 10 });
    const res = mockRes();
    await svc.addKeywords({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "This keyword notification already exists"
    );
  });

  it("creates new KN when subscription exists but KN does not", async () => {
    validateSpy.mockReturnValueOnce({
      value: { user_id: 1, name: "u", keyword: "k", duration: 1, type: 1 }, error: undefined,
    });
    msFindOneSpy.mockResolvedValueOnce({ id: 9 });
    knFindOneSpy.mockResolvedValueOnce(null);
    knCreateSpy.mockResolvedValueOnce({ id: 12 });
    const res = mockRes();
    await svc.addKeywords({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Data added successfully");
  });

  it("catches error and returns 'Failed to add the keyword'", async () => {
    validateSpy.mockImplementationOnce(() => { throw new Error("boom"); });
    const res = mockRes();
    await svc.addKeywords({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Failed to add the keyword");
  });
});

describe("keywordNotification.service > deleteKeywords", () => {
  it("'No data found' when row missing", async () => {
    knFindOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.deleteKeywords({ params: { keywordid: 1 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "No data found with this keyword id"
    );
  });

  it("deletes and returns success when destroy returns truthy", async () => {
    knFindOneSpy.mockResolvedValueOnce({ id: 1 });
    knDestroySpy.mockResolvedValueOnce(1);
    const res = mockRes();
    await svc.deleteKeywords({ params: { keywordid: 1 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("keywords deleted successfully");
  });

  it("does not respond when destroy returns falsy 0", async () => {
    knFindOneSpy.mockResolvedValueOnce({ id: 1 });
    knDestroySpy.mockResolvedValueOnce(0);
    const res = mockRes();
    await svc.deleteKeywords({ params: { keywordid: 1 } }, res);
    expect(res.send).not.toHaveBeenCalled();
  });

  it("catches error and returns 'Failed to delete data.'", async () => {
    knFindOneSpy.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await svc.deleteKeywords({ params: { keywordid: 1 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Failed to delete data.");
  });
});

describe("keywordNotification.service > getSubscribedKeywords", () => {
  it("returns success with mapped result + updates status to 2", async () => {
    knFindAllSpy.mockResolvedValueOnce([
      row({ id: 1, type: 1, keyword: "shoes" }),
      row({ id: 2, type: 2, keyword: "Nike" }),
    ]);
    knUpdateSpy.mockResolvedValueOnce([2]);
    const res = mockRes();
    await svc.getSubscribedKeywords({}, res);
    expect(knUpdateSpy).toHaveBeenCalledWith({ status: 2 }, { where: { id: [1, 2] } });
    expect(res.send.mock.calls.at(-1)[0].body.message).toBe(
      "Keyword fetched successfully"
    );
  });

  it("source bug #220: catch block references undefined 'err' → ReferenceError propagates as rejection", async () => {
    knFindAllSpy.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await expect(svc.getSubscribedKeywords({}, res)).rejects.toThrow(
      /err is not defined/
    );
  });

  it("hits line 130 'No more user request data' branch when findAll returns empty array; line 153 also fires ReferenceError #220", async () => {
    knFindAllSpy.mockResolvedValueOnce([]);
    const res = mockRes();
    await expect(svc.getSubscribedKeywords({}, res)).rejects.toThrow(
      /err is not defined/
    );
    // Line 130 fires before the ReferenceError on 153
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "No more user request data"
    );
  });
});

describe("keywordNotification.service > sendKeywordMailDaily", () => {
  it("sends mail + updates status on success, calls next()", async () => {
    knFindAllSpy.mockResolvedValueOnce([
      row({ id: 1, type: 1, keyword: "shoes", user_id: 5 }),
    ]);
    msFindOneSpy.mockResolvedValueOnce({ email: "u@x", name: "U" });
    sendMailSpy.mockResolvedValueOnce({ accepted: ["u@x"] });
    knUpdateSpy.mockResolvedValueOnce([1]);
    const res = mockRes();
    const next = vi.fn();
    await svc.sendKeywordMailDaily({}, res, next);
    expect(sendMailSpy).toHaveBeenCalled();
    expect(knUpdateSpy).toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
    expect(res.send.mock.calls.at(-1)[0].body.message).toBe(
      "Mail Sent successfully"
    );
  });

  it("type === 2 branch: result.keywords is item.keyword", async () => {
    knFindAllSpy.mockResolvedValueOnce([
      row({ id: 1, type: 2, keyword: "Nike", user_id: 5 }),
    ]);
    msFindOneSpy.mockResolvedValueOnce({ email: "u@x", name: "U" });
    sendMailSpy.mockResolvedValueOnce({ accepted: ["u@x"] });
    knUpdateSpy.mockResolvedValueOnce([1]);
    const res = mockRes();
    await svc.sendKeywordMailDaily({}, res, vi.fn());
    expect(res.send.mock.calls.at(-1)[0].body.message).toBe(
      "Mail Sent successfully"
    );
  });

  it("type !== 1 && !== 2 branch: keywords=null", async () => {
    knFindAllSpy.mockResolvedValueOnce([
      row({ id: 1, type: 9, keyword: "ignored", user_id: 5 }),
    ]);
    msFindOneSpy.mockResolvedValueOnce({ email: "u@x", name: "U" });
    sendMailSpy.mockResolvedValueOnce({ accepted: ["u@x"] });
    knUpdateSpy.mockResolvedValueOnce([1]);
    const res = mockRes();
    await svc.sendKeywordMailDaily({}, res, vi.fn());
    expect(sendMailSpy).toHaveBeenCalled();
  });

  it("does not update status when sendMail.accepted is empty", async () => {
    knFindAllSpy.mockResolvedValueOnce([
      row({ id: 1, type: 1, keyword: "k", user_id: 5 }),
    ]);
    msFindOneSpy.mockResolvedValueOnce({ email: "u@x", name: "U" });
    sendMailSpy.mockResolvedValueOnce({ accepted: [] });
    const res = mockRes();
    await svc.sendKeywordMailDaily({}, res, vi.fn());
    expect(knUpdateSpy).not.toHaveBeenCalled();
  });

  it("returns 'No more user request data' when result empty", async () => {
    knFindAllSpy.mockResolvedValueOnce([]);
    const res = mockRes();
    await svc.sendKeywordMailDaily({}, res, vi.fn());
    expect(res.send.mock.calls.at(-1)[0].body.message).toBe(
      "No more user request data"
    );
  });

  it("returns 'No more user request data' when findAll resolves null (line 172)", async () => {
    knFindAllSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.sendKeywordMailDaily({}, res, vi.fn());
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "No more user request data"
    );
  });

  it("catches error and returns 'Failed to delete data.'", async () => {
    knFindAllSpy.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await svc.sendKeywordMailDaily({}, res, vi.fn());
    expect(res.send.mock.calls.at(-1)[0].body.message).toBe(
      "Failed to delete data."
    );
  });
});

describe("keywordNotification.service > sendKeywordMailWeekly", () => {
  it("sends mail + updates status on success", async () => {
    knFindAllSpy.mockResolvedValueOnce([
      row({ id: 1, type: 1, keyword: "k", user_id: 5 }),
    ]);
    msFindOneSpy.mockResolvedValueOnce({ email: "u@x", name: "U" });
    sendMailSpy.mockResolvedValueOnce({ accepted: ["u@x"] });
    knUpdateSpy.mockResolvedValueOnce([1]);
    const res = mockRes();
    await svc.sendKeywordMailWeekly({}, res);
    expect(res.send.mock.calls.at(-1)[0].body.message).toBe(
      "Mail Sent successfully"
    );
  });

  it("type=2 and unknown-type branches in the mapper", async () => {
    knFindAllSpy.mockResolvedValueOnce([
      row({ id: 1, type: 2, keyword: "Nike", user_id: 5 }),
      row({ id: 2, type: 9, keyword: "ignored", user_id: 5 }),
    ]);
    msFindOneSpy.mockResolvedValueOnce({ email: "u@x", name: "U" });
    sendMailSpy.mockResolvedValueOnce({ accepted: [] });
    const res = mockRes();
    await svc.sendKeywordMailWeekly({}, res);
    expect(sendMailSpy).toHaveBeenCalled();
  });

  it("returns 'No more user request data' when result empty", async () => {
    knFindAllSpy.mockResolvedValueOnce([]);
    const res = mockRes();
    await svc.sendKeywordMailWeekly({}, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("No more user request data");
  });

  it("catches error and returns 'Failed to delete data.'", async () => {
    knFindAllSpy.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await svc.sendKeywordMailWeekly({}, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Failed to delete data.");
  });
});

describe("keywordNotification.service > sendKeywordMailMonthly", () => {
  it("sends mail + updates status on success", async () => {
    knFindAllSpy.mockResolvedValueOnce([
      row({ id: 1, type: 1, keyword: "k", user_id: 5 }),
    ]);
    msFindOneSpy.mockResolvedValueOnce({ email: "u@x", name: "U" });
    sendMailSpy.mockResolvedValueOnce({ accepted: ["u@x"] });
    knUpdateSpy.mockResolvedValueOnce([1]);
    const res = mockRes();
    await svc.sendKeywordMailMonthly({}, res);
    expect(res.send.mock.calls.at(-1)[0].body.message).toBe(
      "Mail Sent successfully"
    );
  });

  it("type=2 and unknown-type mapper branches", async () => {
    knFindAllSpy.mockResolvedValueOnce([
      row({ id: 1, type: 2, keyword: "k", user_id: 5 }),
      row({ id: 2, type: 9, keyword: "x", user_id: 5 }),
    ]);
    msFindOneSpy.mockResolvedValueOnce({ email: "u@x", name: "U" });
    sendMailSpy.mockResolvedValueOnce({ accepted: [] });
    const res = mockRes();
    await svc.sendKeywordMailMonthly({}, res);
    expect(sendMailSpy).toHaveBeenCalled();
  });

  it("returns 'No more user request data' when result empty", async () => {
    knFindAllSpy.mockResolvedValueOnce([]);
    const res = mockRes();
    await svc.sendKeywordMailMonthly({}, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("No more user request data");
  });

  it("catches error and returns 'Failed to delete data.'", async () => {
    knFindAllSpy.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await svc.sendKeywordMailMonthly({}, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Failed to delete data.");
  });
});

describe("keywordNotification.service > getKeywords", () => {
  it("returns 'There is no subscribed keywords' when result empty", async () => {
    knFindAllSpy.mockResolvedValueOnce([]);
    const res = mockRes();
    await svc.getKeywords({ params: { userid: 5 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "There is no subscribed keywords for this user"
    );
  });

  it("returns success with keyword data", async () => {
    knFindAllSpy.mockResolvedValueOnce([{ id: 1 }]);
    const res = mockRes();
    await svc.getKeywords({ params: { userid: 5 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("keywords fetched successfully");
  });

  it("catches error and returns 'Failed to delete data.'", async () => {
    knFindAllSpy.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await svc.getKeywords({ params: { userid: 5 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Failed to delete data.");
  });
});
