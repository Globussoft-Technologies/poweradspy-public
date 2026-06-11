import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  findOneSpy, updateSpy, createSpy,
  validationFailSpy, userSuccessSpy, userFailSpy,
  loggerErrorSpy,
} = vi.hoisted(() => ({
  findOneSpy: vi.fn(),
  updateSpy: vi.fn(),
  createSpy: vi.fn(),
  validationFailSpy: vi.fn((msg, x) => ({ ok: false, kind: "validation", msg, x })),
  userSuccessSpy: vi.fn((msg, data) => ({ ok: true, msg, data })),
  userFailSpy: vi.fn((msg, err) => ({ ok: false, kind: "user-fail", msg, err })),
  loggerErrorSpy: vi.fn(),
}));

vi.mock("../../../utils/response.js", () => ({
  default: {
    validationFailResp: validationFailSpy,
    userSuccessResp: userSuccessSpy,
    userFailResp: userFailSpy,
  },
}));

vi.mock("../../../resources/logs/logger.log.js", () => ({
  default: { error: loggerErrorSpy },
}));

vi.mock("../../../Sequelize_cli/models/index.js", () => ({
  default: {
    amember_user_actions: {
      findOne: findOneSpy,
      update: updateSpy,
      create: createSpy,
    },
  },
}));

vi.mock("config", () => ({
  default: {
    get: (key) => {
      const map = {
        free_plan_user: "FREE",
        free_user_ads_count_day: "5",
        paid_user_ads_count_day: "50",
        paid_user_ads_count_month: "500",
        reset_ads_count_secret_key: "SECRET-123",
      };
      if (!(key in map)) throw new Error(`unstubbed: ${key}`);
      return map[key];
    },
  },
}));

let service;

beforeEach(async () => {
  vi.resetModules();
  findOneSpy.mockReset();
  updateSpy.mockReset();
  createSpy.mockReset();
  validationFailSpy.mockClear();
  userSuccessSpy.mockClear();
  userFailSpy.mockClear();
  loggerErrorSpy.mockClear();
  ({ default: service } = await import(
    "../../../core/userAction/userActionAPI.service.js"
  ));
});

const today = new Date().toISOString().slice(0, 10);
const tomorrow = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
})();
const yesterday = (() => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
})();

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  res.send = vi.fn(() => res);
  return res;
}

// ============================== FREE PLAN ==============================
describe("userActionAPI.service > insertUserAdsCount > FREE_PLAN_USER", () => {
  it("creates a new record when no existingFreePlan is found", async () => {
    findOneSpy.mockResolvedValueOnce(null);
    createSpy.mockResolvedValueOnce({ id: 1 });
    const r = await service.insertUserAdsCount({
      userSubscription: "FREE",
      amember_id: 1,
      amember_email: "x@y.io",
      user_name: "u",
      ad_count: 2,
    });
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        amember_id: 1,
        ad_count: 2,
        month_count: 2,
        date: today,
        amember_subscription: "FREE",
      })
    );
    expect(r).toEqual({ code: 201, message: "Record created" });
  });

  it("increments ad_count + month_count when same-day record under daily limit", async () => {
    findOneSpy.mockResolvedValueOnce({
      end_date: tomorrow,
      date: today,
      ad_count: 2,
      month_count: 10,
    });
    updateSpy.mockResolvedValueOnce([1]);
    const r = await service.insertUserAdsCount({
      userSubscription: "FREE",
      amember_id: 1,
      ad_count: 2,
    });
    expect(updateSpy).toHaveBeenCalledWith(
      { ad_count: 4, month_count: 12 },
      { where: { amember_id: 1 } }
    );
    expect(r).toEqual({
      code: 201,
      message: "Updated record",
      data: { ad_count: 4, month_count: 12 },
    });
  });

  it("returns 205 'You reached all ads for today' when daily limit met", async () => {
    findOneSpy.mockResolvedValueOnce({
      end_date: tomorrow,
      date: today,
      ad_count: 5, // == FREE_USER_ADS_COUNT_DAY (5)
      month_count: 5,
    });
    const r = await service.insertUserAdsCount({
      userSubscription: "FREE",
      amember_id: 1,
      ad_count: 1,
    });
    expect(r.code).toBe(205);
    expect(r.message).toBe("You reached all ads for today");
  });

  it("resets daily ad_count for a new day (date !== today)", async () => {
    findOneSpy.mockResolvedValueOnce({
      end_date: tomorrow,
      date: yesterday,
      ad_count: 99,
      month_count: 99,
    });
    updateSpy.mockResolvedValueOnce([1]);
    const r = await service.insertUserAdsCount({
      userSubscription: "FREE",
      amember_id: 1,
      ad_count: 3,
    });
    expect(updateSpy).toHaveBeenCalledWith(
      { ad_count: 3, date: today },
      { where: { amember_id: 1 } }
    );
    expect(r.code).toBe(201);
    expect(r.message).toBe("Updated record");
  });

  it("returns 205 'Free plan expired' when end_date < today", async () => {
    findOneSpy.mockResolvedValueOnce({
      end_date: yesterday,
      date: yesterday,
      ad_count: 0,
      month_count: 0,
    });
    const r = await service.insertUserAdsCount({
      userSubscription: "FREE",
      amember_id: 1,
      ad_count: 1,
    });
    expect(r).toEqual({ code: 205, message: "Free plan expired" });
  });
});

// ============================== PAID PLAN ==============================
describe("userActionAPI.service > insertUserAdsCount > PAID plan", () => {
  it("inserts a brand-new record when no userMonthData exists", async () => {
    findOneSpy.mockResolvedValueOnce(null);
    createSpy.mockResolvedValueOnce({ id: 99 });
    const r = await service.insertUserAdsCount({
      userSubscription: "PRO",
      amember_id: 2,
      amember_email: "z@y.io",
      user_name: "z",
      ad_count: 10,
    });
    expect(createSpy).toHaveBeenCalled();
    expect(r).toEqual({ code: 200, message: "New record created after a month" });
  });

  it("returns 500 'Failed to insert new record' when create yields no id", async () => {
    findOneSpy.mockResolvedValueOnce(null);
    createSpy.mockResolvedValueOnce(null);
    const r = await service.insertUserAdsCount({
      userSubscription: "PRO",
      amember_id: 2,
      ad_count: 1,
    });
    expect(r).toEqual({ code: 500, message: "Failed to insert new record" });
  });

  it("resets monthly cycle when today > end_date", async () => {
    findOneSpy.mockResolvedValueOnce({
      end_date: yesterday,
      ad_count: 100,
      month_count: 100,
    });
    updateSpy.mockResolvedValueOnce([1]);
    const r = await service.insertUserAdsCount({
      userSubscription: "PRO",
      amember_id: 2,
      ad_count: 5,
    });
    expect(updateSpy).toHaveBeenCalled();
    expect(r.code).toBe(201);
    expect(r.message).toBe("New monthly cycle started (Paid Plan)");
  });

  it("returns 205 'Ads count limit reached' when month_count >= PAID_USER_ADS_COUNT_MONTH", async () => {
    findOneSpy.mockResolvedValueOnce({
      end_date: tomorrow,
      ad_count: 50,
      month_count: 500, // == PAID_USER_ADS_COUNT_MONTH
    });
    const r = await service.insertUserAdsCount({
      userSubscription: "PRO",
      amember_id: 2,
      ad_count: 1,
    });
    expect(r.code).toBe(205);
    expect(r.message).toBe("Ads count limit reached");
  });

  it("increments when userDayData exists and ad_count <= daily limit -> 201", async () => {
    findOneSpy
      .mockResolvedValueOnce({
        end_date: tomorrow,
        ad_count: 10,
        month_count: 100,
      })
      .mockResolvedValueOnce({ ad_count: 10 }); // userDayData
    updateSpy.mockResolvedValueOnce([1]);
    const r = await service.insertUserAdsCount({
      userSubscription: "PRO",
      amember_id: 2,
      ad_count: 5,
    });
    expect(r.code).toBe(201);
    expect(r.data).toEqual({ ad_count: 15, month_count: 105 });
  });

  it("returns 205 'Todays Ads count limit reached' when userDayData ad_count > daily limit", async () => {
    findOneSpy
      .mockResolvedValueOnce({
        end_date: tomorrow,
        ad_count: 51,
        month_count: 100,
      })
      .mockResolvedValueOnce({ ad_count: 51 });
    const r = await service.insertUserAdsCount({
      userSubscription: "PRO",
      amember_id: 2,
      ad_count: 1,
    });
    expect(r.code).toBe(205);
    expect(r.message).toBe("Todays Ads count limit reached");
  });

  it("creates fresh day data when no userDayData found", async () => {
    findOneSpy
      .mockResolvedValueOnce({
        end_date: tomorrow,
        ad_count: 0,
        month_count: 100,
      })
      .mockResolvedValueOnce(null); // userDayData missing
    updateSpy.mockResolvedValueOnce([1]);
    const r = await service.insertUserAdsCount({
      userSubscription: "PRO",
      amember_id: 2,
      ad_count: 5,
    });
    expect(r.code).toBe(201);
    expect(r.data).toEqual({
      ad_count: 5,
      month_count: 105,
      date: today,
    });
  });

  it("returns 500 'Failed to update data' when update reports 0 rows", async () => {
    findOneSpy
      .mockResolvedValueOnce({
        end_date: tomorrow,
        ad_count: 0,
        month_count: 100,
      })
      .mockResolvedValueOnce(null);
    updateSpy.mockResolvedValueOnce([0]); // no rows updated
    const r = await service.insertUserAdsCount({
      userSubscription: "PRO",
      amember_id: 2,
      ad_count: 5,
    });
    expect(r).toEqual({ code: 500, message: "Failed to update data" });
  });
});

// ============================== outer catch ==============================
describe("userActionAPI.service > insertUserAdsCount > outer catch", () => {
  it("returns 500 with err when findOne rejects", async () => {
    findOneSpy.mockRejectedValueOnce(new Error("db-down"));
    const consoleErrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await service.insertUserAdsCount({
      userSubscription: "FREE",
      amember_id: 1,
      ad_count: 1,
    });
    expect(r.code).toBe(500);
    expect(r.message).toBe("Error in getUserAdAction API");
    expect(r.err).toBeInstanceOf(Error);
    consoleErrSpy.mockRestore();
  });
});

// ============================== insertAdsCountDetails ==============================
describe("userActionAPI.service > insertAdsCountDetails (http wrapper)", () => {
  it("calls insertUserAdsCount with body and res.json with result", async () => {
    findOneSpy.mockResolvedValueOnce(null);
    createSpy.mockResolvedValueOnce({ id: 1 });
    const res = mockRes();
    await service.insertAdsCountDetails(
      { body: { userSubscription: "FREE", amember_id: 1, ad_count: 1 } },
      res
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 201, message: "Record created" })
    );
  });

  it("returns userFailResp via outer catch when res.json throws (only reachable path)", async () => {
    // insertUserAdsCount's own inner try/catch swallows all errors and
    // resolves to a result object, so this method's outer catch can only
    // fire on the res.json call itself (or `req?.body` access — but
    // optional chaining doesn't throw).
    findOneSpy.mockResolvedValueOnce(null);
    createSpy.mockResolvedValueOnce({ id: 1 });
    const res = mockRes();
    res.json.mockImplementationOnce(() => {
      throw new Error("res.json failed");
    });
    await service.insertAdsCountDetails(
      { body: { userSubscription: "FREE", amember_id: 1, ad_count: 1 } },
      res
    );
    expect(loggerErrorSpy).toHaveBeenCalled();
    expect(userFailSpy).toHaveBeenCalledWith(
      "Failed to update user actions",
      expect.any(Error)
    );
  });
});

// ============================== updateAdsCount ==============================
describe("userActionAPI.service > updateAdsCount", () => {
  it("returns 403 when secret key is missing", async () => {
    const res = mockRes();
    await service.updateAdsCount({ params: { email: "x@y.io" }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(validationFailSpy).toHaveBeenCalledWith(
      "Invalid or missing secret key"
    );
  });

  it("returns 403 when secret key is wrong", async () => {
    const res = mockRes();
    await service.updateAdsCount(
      { params: { email: "x@y.io" }, headers: { "x-secret-key": "wrong" } },
      res
    );
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("returns validationFailResp when email is missing", async () => {
    const res = mockRes();
    await service.updateAdsCount(
      { params: {}, headers: { "x-secret-key": "SECRET-123" } },
      res
    );
    expect(validationFailSpy).toHaveBeenCalledWith("Missing email field", undefined);
  });

  it("returns validationFailResp 'No user found' when findOne returns null", async () => {
    findOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await service.updateAdsCount(
      {
        params: { email: "x@y.io" },
        headers: { "x-secret-key": "SECRET-123" },
      },
      res
    );
    expect(validationFailSpy).toHaveBeenCalledWith(
      "No user found with this email",
      "x@y.io"
    );
  });

  it("calls user.update with zeros and userSuccessResp on success", async () => {
    const userUpdate = vi.fn(async () => undefined);
    findOneSpy.mockResolvedValueOnce({ update: userUpdate });
    const res = mockRes();
    await service.updateAdsCount(
      {
        params: { email: "x@y.io" },
        headers: { "x-secret-key": "SECRET-123" },
      },
      res
    );
    expect(userUpdate).toHaveBeenCalledWith({ ad_count: 0, month_count: 0 });
    expect(userSuccessSpy).toHaveBeenCalledWith("Ad count reset to 0");
  });

  it("returns userFailResp via outer catch when findOne throws", async () => {
    findOneSpy.mockRejectedValueOnce(new Error("db-down"));
    const consoleErrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = mockRes();
    await service.updateAdsCount(
      {
        params: { email: "x@y.io" },
        headers: { "x-secret-key": "SECRET-123" },
      },
      res
    );
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      "Error fetching user email",
      expect.any(Error)
    );
    expect(userFailSpy).toHaveBeenCalledWith(
      "Error fetching user email",
      expect.any(Error)
    );
    consoleErrSpy.mockRestore();
  });
});
