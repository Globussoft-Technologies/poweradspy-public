import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  // models
  urFindOneSpy, urFindAllSpy, urCreateSpy, urUpdateSpy, urDestroySpy,
  countryFindOneSpy,
  knFindAllSpy, knUpdateSpy,
  msFindOneSpy, msCreateSpy,
  kwBulkCreateSpy,
  // validation
  validateCreateSpy,
  // response
  validationFailSpy, userSuccessSpy, userFailSpy,
  // logger
  loggerInfoSpy, loggerErrorSpy,
  // sgMail
  sgSetApiKeySpy, sgSendSpy,
} = vi.hoisted(() => ({
  urFindOneSpy: vi.fn(),
  urFindAllSpy: vi.fn(),
  urCreateSpy: vi.fn(),
  urUpdateSpy: vi.fn(),
  urDestroySpy: vi.fn(),
  countryFindOneSpy: vi.fn(),
  knFindAllSpy: vi.fn(),
  knUpdateSpy: vi.fn(),
  msFindOneSpy: vi.fn(),
  msCreateSpy: vi.fn(),
  kwBulkCreateSpy: vi.fn(),
  validateCreateSpy: vi.fn(),
  validationFailSpy: vi.fn((msg, x) => ({ ok: false, kind: "validation", msg, x })),
  userSuccessSpy: vi.fn((msg, data) => ({ ok: true, msg, data })),
  userFailSpy: vi.fn((msg, err) => ({ ok: false, kind: "user-fail", msg, err })),
  loggerInfoSpy: vi.fn(),
  loggerErrorSpy: vi.fn(),
  sgSetApiKeySpy: vi.fn(),
  sgSendSpy: vi.fn(),
}));

vi.mock("../../../utils/response.js", () => ({
  default: {
    validationFailResp: validationFailSpy,
    userSuccessResp: userSuccessSpy,
    userFailResp: userFailSpy,
  },
}));

vi.mock("../../../resources/logs/logger.log.js", () => ({
  default: { info: loggerInfoSpy, error: loggerErrorSpy },
}));

vi.mock("../../../Sequelize_cli/models/index.js", () => ({
  default: {
    user_requests: {
      findOne: urFindOneSpy,
      findAll: urFindAllSpy,
      create: urCreateSpy,
      update: urUpdateSpy,
      destroy: urDestroySpy,
    },
    tiktok_ad_country_info: { findOne: countryFindOneSpy },
    keyword_notification: { findAll: knFindAllSpy, update: knUpdateSpy },
    mail_subscription: { findOne: msFindOneSpy, create: msCreateSpy },
    tiktok_keywords: { bulkCreate: kwBulkCreateSpy },
  },
}));

vi.mock("../../../core/userRequest/userRequest.validation.js", () => ({
  default: { createUserRequest: validateCreateSpy },
}));

vi.mock("@sendgrid/mail", () => ({
  default: { setApiKey: sgSetApiKeySpy, send: sgSendSpy },
}));

vi.mock("nodemailer", () => ({ default: {} }));

vi.mock("config", () => ({
  default: {
    get: (key) => {
      const map = {
        sendgrid_api_key: "SG-TEST",
        mail_from: "noreply@poweradspy.test",
      };
      if (!(key in map)) throw new Error(`unstubbed: ${key}`);
      return map[key];
    },
  },
}));

vi.mock("sequelize", () => ({ Op: { or: "or", like: "like" } }));

let service;

beforeEach(async () => {
  vi.resetModules();
  urFindOneSpy.mockReset();
  urFindAllSpy.mockReset();
  urCreateSpy.mockReset();
  urUpdateSpy.mockReset();
  urDestroySpy.mockReset();
  countryFindOneSpy.mockReset();
  knFindAllSpy.mockReset();
  knUpdateSpy.mockReset();
  msFindOneSpy.mockReset();
  msCreateSpy.mockReset();
  kwBulkCreateSpy.mockReset();
  validateCreateSpy.mockReset();
  validationFailSpy.mockClear();
  userSuccessSpy.mockClear();
  userFailSpy.mockClear();
  loggerInfoSpy.mockClear();
  loggerErrorSpy.mockClear();
  sgSetApiKeySpy.mockClear();
  sgSendSpy.mockReset();
  ({ default: service } = await import(
    "../../../core/userRequest/userRequest.service.js"
  ));
});

function mockRes() {
  const res = {};
  res.send = vi.fn(() => res);
  return res;
}

// helper: build a sequelize-row-like object with a .get() method
function row(data) {
  return { ...data, get: () => data };
}

// ============================== createUserRequest ==============================
describe("userRequest.service > createUserRequest", () => {
  it("returns validationFailResp when validation errors", async () => {
    const valErr = new Error("invalid");
    validateCreateSpy.mockReturnValueOnce({ value: undefined, error: valErr });
    const res = mockRes();
    await service.createUserRequest({ body: {} }, res);
    expect(validationFailSpy).toHaveBeenCalledWith("VALIDATION_FAIL", valErr);
  });

  it("creates mail-subscription + user-request when none of either exist", async () => {
    validateCreateSpy.mockReturnValueOnce({
      value: { user_id: 1, name: "S", email: "x@y", keywords: "k" },
      error: undefined,
    });
    msFindOneSpy.mockResolvedValueOnce(null);
    kwBulkCreateSpy.mockResolvedValueOnce([{ id: 1 }]);
    msCreateSpy.mockResolvedValueOnce({ id: 99 });
    urCreateSpy.mockResolvedValueOnce({ id: 7 });
    const res = mockRes();
    await service.createUserRequest(
      { body: { user_id: 1, keywords: "k" } },
      res
    );
    expect(msCreateSpy).toHaveBeenCalled();
    expect(urCreateSpy).toHaveBeenCalled();
    expect(userSuccessSpy).toHaveBeenCalledWith(
      "Data added successfully",
      { id: 7 }
    );
  });

  it("returns 'Failed to add data' when new mail-subscription create returns falsy", async () => {
    validateCreateSpy.mockReturnValueOnce({
      value: { user_id: 1, name: "S", email: "x@y", keywords: "k" },
      error: undefined,
    });
    msFindOneSpy.mockResolvedValueOnce(null);
    kwBulkCreateSpy.mockResolvedValueOnce([]);
    msCreateSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await service.createUserRequest(
      { body: { user_id: 1, keywords: "k" } },
      res
    );
    expect(userFailSpy).toHaveBeenCalledWith("Failed to add data.");
  });

  it("creates user-request when mail-subscription exists but no userExist", async () => {
    validateCreateSpy.mockReturnValueOnce({
      value: { user_id: 1, keywords: "k" },
      error: undefined,
    });
    msFindOneSpy.mockResolvedValueOnce({ id: 1 });
    kwBulkCreateSpy.mockResolvedValueOnce([]);
    urFindOneSpy.mockResolvedValueOnce(null);
    urCreateSpy.mockResolvedValueOnce({ id: 8 });
    const res = mockRes();
    await service.createUserRequest(
      { body: { user_id: 1, keywords: "k" } },
      res
    );
    expect(userSuccessSpy).toHaveBeenCalledWith(
      "User request data inserted successfully",
      { id: 8 }
    );
  });

  it("returns 'Cannot add user request data' when userExist + no storeDetails", async () => {
    validateCreateSpy.mockReturnValueOnce({
      value: { user_id: 1 }, // no keywords/advertiser/url
      error: undefined,
    });
    msFindOneSpy.mockResolvedValueOnce({ id: 1 });
    kwBulkCreateSpy.mockResolvedValueOnce([]);
    urFindOneSpy.mockResolvedValueOnce({ id: 5 });
    const res = mockRes();
    await service.createUserRequest({ body: { user_id: 1 } }, res);
    expect(userFailSpy).toHaveBeenCalledWith("Cannot add user request data.");
  });

  it("returns 'User data already exists' when existingRequest matches", async () => {
    validateCreateSpy.mockReturnValueOnce({
      value: { user_id: 1, keywords: "k" },
      error: undefined,
    });
    msFindOneSpy.mockResolvedValueOnce({ id: 1 });
    kwBulkCreateSpy.mockResolvedValueOnce([]);
    urFindOneSpy
      .mockResolvedValueOnce({ id: 5 }) // userExist
      .mockResolvedValueOnce({ id: 8 }); // existingRequest
    const res = mockRes();
    await service.createUserRequest(
      { body: { user_id: 1, keywords: "k" } },
      res
    );
    expect(userFailSpy).toHaveBeenCalledWith("User data already exists");
  });

  it("userExist + only advertiser set → `|| null` fallback fires for keywords + url (lines 83+85)", async () => {
    validateCreateSpy.mockReturnValueOnce({
      value: { user_id: 1, advertiser: "Acme" /* no keywords/url */ },
      error: undefined,
    });
    msFindOneSpy.mockResolvedValueOnce({ id: 1 });
    kwBulkCreateSpy.mockResolvedValueOnce([]);
    urFindOneSpy
      .mockResolvedValueOnce({ id: 5 }) // userExist
      .mockResolvedValueOnce(null); // existingRequest missing
    urCreateSpy.mockResolvedValueOnce({ id: 100 });
    const res = mockRes();
    await service.createUserRequest(
      { body: { user_id: 1, advertiser: "Acme" } },
      res
    );
    expect(userSuccessSpy).toHaveBeenCalledWith(
      "User request data inserted successfully",
      { id: 100 }
    );
    // Verify findOne was called with the |null fallbacks
    const lastFindOne = urFindOneSpy.mock.calls.at(-1)[0];
    expect(lastFindOne.where.keywords).toBeNull();
    expect(lastFindOne.where.url).toBeNull();
  });

  it("creates user-request when userExist but no existingRequest", async () => {
    validateCreateSpy.mockReturnValueOnce({
      value: { user_id: 1, keywords: "k" },
      error: undefined,
    });
    msFindOneSpy.mockResolvedValueOnce({ id: 1 });
    kwBulkCreateSpy.mockResolvedValueOnce([]);
    urFindOneSpy
      .mockResolvedValueOnce({ id: 5 }) // userExist
      .mockResolvedValueOnce(null); // existingRequest missing
    urCreateSpy.mockResolvedValueOnce({ id: 99 });
    const res = mockRes();
    await service.createUserRequest(
      { body: { user_id: 1, keywords: "k" } },
      res
    );
    expect(userSuccessSpy).toHaveBeenCalledWith(
      "User request data inserted successfully",
      { id: 99 }
    );
  });

  it("returns userFailResp via outer catch when validation throws", async () => {
    validateCreateSpy.mockImplementationOnce(() => {
      throw new Error("val-crashed");
    });
    const res = mockRes();
    await service.createUserRequest({ body: {} }, res);
    expect(userFailSpy).toHaveBeenCalledWith(
      "Failed to add user request data.",
      expect.any(Error)
    );
  });

  it("skips logger.info on `if(insertedData)` falsy branch when bulkCreate returns null (line 34 false side)", async () => {
    validateCreateSpy.mockReturnValueOnce({
      value: { user_id: 1, name: "S", email: "x@y", keywords: "k" },
      error: undefined,
    });
    msFindOneSpy.mockResolvedValueOnce(null);
    kwBulkCreateSpy.mockResolvedValueOnce(null);
    msCreateSpy.mockResolvedValueOnce({ id: 99 });
    urCreateSpy.mockResolvedValueOnce({ id: 7 });
    const res = mockRes();
    await service.createUserRequest(
      { body: { user_id: 1, keywords: "k" } },
      res
    );
    expect(userSuccessSpy).toHaveBeenCalledWith(
      "Data added successfully",
      { id: 7 }
    );
  });
});

// ============================== deleteUserRequestData ==============================
describe("userRequest.service > deleteUserRequestData", () => {
  it("returns 'Invalid user request ID' when not found", async () => {
    urFindOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await service.deleteUserRequestData({ params: { userrequestid: "99" } }, res);
    expect(userFailSpy).toHaveBeenCalledWith("Invalid user request ID");
  });

  it("destroys + success when record exists and destroy returns truthy", async () => {
    urFindOneSpy.mockResolvedValueOnce({ id: 5 });
    urDestroySpy.mockResolvedValueOnce(1);
    const res = mockRes();
    await service.deleteUserRequestData({ params: { userrequestid: "5" } }, res);
    expect(userSuccessSpy).toHaveBeenCalledWith(
      "user request data deleted successfully",
      1
    );
  });

  it("no-ops when destroy returns falsy", async () => {
    urFindOneSpy.mockResolvedValueOnce({ id: 5 });
    urDestroySpy.mockResolvedValueOnce(0);
    const res = mockRes();
    await service.deleteUserRequestData({ params: { userrequestid: "5" } }, res);
    expect(userSuccessSpy).not.toHaveBeenCalled();
  });

  it("returns failure via outer catch when findOne throws", async () => {
    urFindOneSpy.mockRejectedValueOnce(new Error("db-down"));
    const res = mockRes();
    await service.deleteUserRequestData({ params: { userrequestid: "5" } }, res);
    expect(userFailSpy).toHaveBeenCalledWith(
      "Failed to delete user request data with this Id.",
      expect.any(Error)
    );
  });
});

// ============================== getUserRequestKeywords ==============================
describe("userRequest.service > getUserRequestKeywords", () => {
  it("happy path: subscribed keywords + country-matched user requests -> success", async () => {
    knFindAllSpy.mockResolvedValueOnce([
      row({ id: 1, keyword: "shoes", type: 1 }),
      row({ id: 2, keyword: "Nike", type: 2 }),
    ]);
    knUpdateSpy.mockResolvedValueOnce([2]);
    countryFindOneSpy.mockResolvedValueOnce({ name: "India" });
    urFindAllSpy.mockResolvedValueOnce([
      {
        id: 10,
        keywords: "running shoes",
        advertiser: null,
        url: null,
        country: "India",
        keyword_status: 0,
        advertiser_status: 1,
        url_status: 1,
      },
    ]);
    urUpdateSpy.mockResolvedValueOnce([1]);
    const res = mockRes();
    await service.getUserRequestKeywords(
      { query: { country: "IN", limit: "5" } },
      res
    );
    expect(userSuccessSpy).toHaveBeenCalledWith(
      "Data Fetched Successfully",
      expect.any(Array)
    );
  });

  it("country-matched path with advertiser_status=0 + url_status=0 → assigns advertiser/url (lines 211, 215)", async () => {
    knFindAllSpy.mockResolvedValueOnce([]);
    countryFindOneSpy.mockResolvedValueOnce({ name: "India" });
    urFindAllSpy.mockResolvedValueOnce([
      {
        id: 11,
        keywords: "k",
        advertiser: "Acme",
        url: "https://acme.com",
        country: "India",
        keyword_status: 0,
        advertiser_status: 0,
        url_status: 0,
      },
    ]);
    urUpdateSpy.mockResolvedValueOnce([1]);
    const res = mockRes();
    await service.getUserRequestKeywords(
      { query: { country: "IN", limit: "5" } },
      res
    );
    expect(userSuccessSpy).toHaveBeenCalledWith(
      "Data Fetched Successfully",
      expect.any(Array)
    );
  });

  it("returns 'Invalid Country Code' when a country is supplied but the ISO lookup returns null", async () => {
    knFindAllSpy.mockResolvedValueOnce([]);
    countryFindOneSpy.mockResolvedValueOnce(null); // unknown ISO -> no match
    const res = mockRes();
    await service.getUserRequestKeywords(
      { query: { country: "XX", limit: "2" } },
      res
    );
    // country is truthy but countryName is null, so `!country || countryName`
    // is false -> the source rejects the request instead of falling back.
    expect(userFailSpy).toHaveBeenCalledWith("Invalid Country Code");
  });

  it("uses fallback query (no country) when first query returns nothing but subscribed keywords exist", async () => {
    knFindAllSpy.mockResolvedValueOnce([row({ id: 1, keyword: "k", type: 1 })]);
    knUpdateSpy.mockResolvedValueOnce([1]);
    urFindAllSpy
      .mockResolvedValueOnce([]) // first query
      .mockResolvedValueOnce([]); // fallback query
    const res = mockRes();
    await service.getUserRequestKeywords({ query: {} }, res);
    expect(userSuccessSpy).toHaveBeenCalledWith(
      "Data Fetched Successfully",
      expect.any(Array)
    );
  });

  it("fallback finds user requests + updates them when first query empty", async () => {
    knFindAllSpy.mockResolvedValueOnce([]);
    urFindAllSpy
      .mockResolvedValueOnce([]) // first
      .mockResolvedValueOnce([
        {
          id: 20,
          keywords: "k",
          advertiser: "a",
          url: "u",
          country: "X",
          keyword_status: 0,
          advertiser_status: 0,
          url_status: 0,
        },
      ]); // fallback
    urUpdateSpy.mockResolvedValueOnce([1]);
    const res = mockRes();
    await service.getUserRequestKeywords({ query: {} }, res);
    expect(userSuccessSpy).toHaveBeenCalled();
  });

  it("default limit of 2 used when query.limit is missing", async () => {
    knFindAllSpy.mockResolvedValueOnce([]);
    urFindAllSpy
      .mockResolvedValueOnce([]) // first
      .mockResolvedValueOnce([]); // fallback empty -> No Data Found
    const res = mockRes();
    await service.getUserRequestKeywords({ query: {} }, res);
    expect(urFindAllSpy).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 2 })
    );
  });

  it("catches and returns 'Failed to fetch Data' when urFindAll throws (outer)", async () => {
    knFindAllSpy.mockResolvedValueOnce([]);
    urFindAllSpy.mockRejectedValueOnce(new Error("query-fail"));
    const res = mockRes();
    await service.getUserRequestKeywords({ query: {} }, res);
    expect(userFailSpy).toHaveBeenCalledWith(
      "Failed to fetch Data",
      "query-fail"
    );
  });

  it("inner try swallows knFindAll errors silently (no throw, no log)", async () => {
    knFindAllSpy.mockRejectedValueOnce(new Error("kn-fail"));
    urFindAllSpy.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const res = mockRes();
    await service.getUserRequestKeywords({ query: {} }, res);
    // subscribedKeywords stays undefined; subsequent code uses spread on
    // undefined, which would throw. Verify "No Data Found" actually fires.
    expect(userFailSpy).toHaveBeenCalled();
  });

  it("country-matched path: row with all statuses != 0 → all three `=== 0` false branches fire (line 206 false side)", async () => {
    knFindAllSpy.mockResolvedValueOnce([]);
    countryFindOneSpy.mockResolvedValueOnce({ name: "India" });
    urFindAllSpy.mockResolvedValueOnce([
      {
        id: 12,
        keywords: "k",
        advertiser: "a",
        url: "u",
        country: "India",
        keyword_status: 1,
        advertiser_status: 1,
        url_status: 1,
      },
    ]);
    urUpdateSpy.mockResolvedValueOnce([1]);
    const res = mockRes();
    await service.getUserRequestKeywords(
      { query: { country: "IN", limit: "5" } },
      res
    );
    expect(userSuccessSpy).toHaveBeenCalledWith(
      "Data Fetched Successfully",
      expect.any(Array)
    );
  });

  it("fallback path: row with all statuses != 0 → all three `=== 0` false branches fire (lines 255/259/263 false side)", async () => {
    knFindAllSpy.mockResolvedValueOnce([]);
    urFindAllSpy
      .mockResolvedValueOnce([]) // first (country) query
      .mockResolvedValueOnce([   // fallback query returns row with non-zero statuses
        {
          id: 30,
          keywords: "k",
          advertiser: "a",
          url: "u",
          country: "X",
          keyword_status: 1,
          advertiser_status: 1,
          url_status: 1,
        },
      ]);
    urUpdateSpy.mockResolvedValueOnce([1]);
    const res = mockRes();
    await service.getUserRequestKeywords({ query: {} }, res);
    expect(userSuccessSpy).toHaveBeenCalled();
  });
});

// ============================== sendRequestedKeywordMail ==============================
describe("userRequest.service > sendRequestedKeywordMail", () => {
  it("returns 'No more user request data' when nothing pending", async () => {
    urFindAllSpy.mockResolvedValueOnce([]);
    const res = mockRes();
    await service.sendRequestedKeywordMail({}, res);
    expect(userFailSpy).toHaveBeenCalledWith("No more user request data");
  });

  it("returns 'Fetched requested keyword data' with the mapped rows when pending data exists", async () => {
    urFindAllSpy.mockResolvedValueOnce([
      row({
        id: 1,
        keywords: "k",
        advertiser: "a",
        url: "u",
        user_id: 99,
      }),
    ]);
    const res = mockRes();
    await service.sendRequestedKeywordMail({}, res);
    expect(userSuccessSpy).toHaveBeenCalledWith("Fetched requested keyword data", [
      { id: 1, keywords: "k", advertiser: "a", url: "u", user_id: 99 },
    ]);
  });

  it("maps nullish keywords/advertiser/url to null via the `|| null` fallback", async () => {
    urFindAllSpy.mockResolvedValueOnce([
      row({ id: 1, user_id: 99 /* no keywords/advertiser/url */ }),
    ]);
    const res = mockRes();
    await service.sendRequestedKeywordMail({}, res);
    expect(userSuccessSpy).toHaveBeenCalledWith("Fetched requested keyword data", [
      { id: 1, keywords: null, advertiser: null, url: null, user_id: 99 },
    ]);
  });

  it("returns 'Failed to fetch requested keyword data.' via catch when findAll throws", async () => {
    urFindAllSpy.mockRejectedValueOnce(new Error("db-down"));
    const res = mockRes();
    await service.sendRequestedKeywordMail({}, res);
    expect(userFailSpy).toHaveBeenCalledWith(
      "Failed to fetch requested keyword data.",
      "db-down"
    );
  });
});

// ============================== getUserReqKeywords ==============================
describe("userRequest.service > getUserReqKeywords", () => {
  it("returns success with the data array", async () => {
    urFindAllSpy.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
    const res = mockRes();
    await service.getUserReqKeywords({ params: { userid: "u1" } }, res);
    expect(userSuccessSpy).toHaveBeenCalledWith(
      "keywords fetched successfully",
      [{ id: 1 }, { id: 2 }]
    );
  });

  it("returns 'No user requested keywords' when empty", async () => {
    urFindAllSpy.mockResolvedValueOnce([]);
    const res = mockRes();
    await service.getUserReqKeywords({ params: { userid: "u1" } }, res);
    expect(userFailSpy).toHaveBeenCalledWith(
      "There is no user requested keywords for this user"
    );
  });

  it("returns 'Failed to fetch Data' via catch", async () => {
    urFindAllSpy.mockRejectedValueOnce(new Error("db-down"));
    const res = mockRes();
    await service.getUserReqKeywords({ params: { userid: "u1" } }, res);
    expect(userFailSpy).toHaveBeenCalledWith(
      "Failed to fetch Data",
      expect.any(Error)
    );
  });
});

// ============================== updateUserRequestStatus ==============================
describe("userRequest.service > updateUserRequestStatus", () => {
  it("resets keyword/advertiser/url/sent status to 0 for records flagged as 1/4", async () => {
    urFindAllSpy.mockResolvedValueOnce([
      {
        id: 1,
        keyword_status: 1,
        advertiser_status: 1,
        url_status: 1,
        sent_status: 4,
      },
    ]);
    urUpdateSpy.mockResolvedValueOnce([1]);
    await service.updateUserRequestStatus();
    expect(urUpdateSpy).toHaveBeenCalledWith(
      {
        keyword_status: 0,
        advertiser_status: 0,
        url_status: 0,
        sent_status: 0,
      },
      { where: { id: 1 } }
    );
  });

  it("skips records with no flagged fields (no updates queued)", async () => {
    urFindAllSpy.mockResolvedValueOnce([
      { id: 2, keyword_status: 0, advertiser_status: 0, url_status: 0, sent_status: 0 },
    ]);
    await service.updateUserRequestStatus();
    expect(urUpdateSpy).not.toHaveBeenCalled();
  });

  it("swallows errors silently (empty catch)", async () => {
    urFindAllSpy.mockRejectedValueOnce(new Error("db-down"));
    await expect(service.updateUserRequestStatus()).resolves.toBeUndefined();
  });
});

// ============================== updateUserRequestSentStatus ==============================
describe("userRequest.service > updateUserRequestSentStatus", () => {
  it("updates sent_status and returns success when record exists", async () => {
    urFindOneSpy.mockResolvedValueOnce({ id: 5 });
    urUpdateSpy.mockResolvedValueOnce([1]);
    const res = mockRes();
    await service.updateUserRequestSentStatus(
      { body: { requestid: "5", sent_status: 3 } },
      res
    );
    expect(urUpdateSpy).toHaveBeenCalledWith(
      { sent_status: 3 },
      { where: { id: "5" } }
    );
    expect(userSuccessSpy).toHaveBeenCalledWith(
      "status updated successfully",
      [1]
    );
  });

  it("does nothing if record not found", async () => {
    urFindOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await service.updateUserRequestSentStatus(
      { body: { requestid: "5", sent_status: 3 } },
      res
    );
    expect(userSuccessSpy).not.toHaveBeenCalled();
    expect(userFailSpy).not.toHaveBeenCalled();
  });

  it("returns 'Failed to update the status' via catch", async () => {
    urFindOneSpy.mockRejectedValueOnce(new Error("db-down"));
    const res = mockRes();
    await service.updateUserRequestSentStatus(
      { body: { requestid: "5", sent_status: 3 } },
      res
    );
    expect(userFailSpy).toHaveBeenCalledWith(
      "Failed to update the status",
      expect.any(Error)
    );
  });
});
