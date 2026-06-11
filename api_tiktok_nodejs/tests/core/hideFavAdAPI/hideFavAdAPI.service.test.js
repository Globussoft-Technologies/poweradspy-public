import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  createSpy, findOneSpy, findAllSpy, destroySpy,
  validateSpy, esGetHideFavAdsSpy, loggerErrorSpy,
} = vi.hoisted(() => ({
  createSpy: vi.fn(),
  findOneSpy: vi.fn(),
  findAllSpy: vi.fn(),
  destroySpy: vi.fn(),
  validateSpy: vi.fn(),
  esGetHideFavAdsSpy: vi.fn(),
  loggerErrorSpy: vi.fn(),
}));

vi.mock("../../../Sequelize_cli/models/index.js", () => ({
  default: {
    hide_favourite_ads: {
      create: createSpy,
      findOne: findOneSpy,
      findAll: findAllSpy,
      destroy: destroySpy,
    },
  },
}));

vi.mock("../../../core/hideFavAdAPI/hideFavAdAPI.validate.js", () => ({
  default: { createFavAdsAPI: validateSpy },
}));

vi.mock("../../../utils/elasticSearch.js", () => ({
  getHideFavAds: esGetHideFavAdsSpy,
}));

vi.mock("../../../resources/logs/logger.log.js", () => ({
  default: { info: vi.fn(), error: loggerErrorSpy, warn: vi.fn() },
}));

let svc;
beforeEach(async () => {
  vi.resetModules();
  for (const s of [createSpy, findOneSpy, findAllSpy, destroySpy, validateSpy, esGetHideFavAdsSpy, loggerErrorSpy])
    s.mockReset();
  ({ default: svc } = await import(
    "../../../core/hideFavAdAPI/hideFavAdAPI.service.js"
  ));
});

function mockRes() {
  const res = {};
  res.send = vi.fn(() => res);
  res.status = vi.fn(() => res);
  return res;
}

describe("hideFavAdAPI.service > hideFavAd", () => {
  it("VALIDATION_FAIL when validation errors", async () => {
    validateSpy.mockReturnValueOnce({ value: {}, error: { message: "bad" } });
    const res = mockRes();
    await svc.hideFavAd({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("VALIDATION_FAIL");
  });

  it("inserts NEW row when no (ad_id,user_id) match exists", async () => {
    validateSpy.mockReturnValueOnce({ value: { ad_id: 1, user_id: 2, type: 1 }, error: undefined });
    findOneSpy.mockResolvedValueOnce(null);
    createSpy.mockResolvedValueOnce({ id: 99 });
    const res = mockRes();
    await svc.hideFavAd({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("New data inserted successfully");
    expect(res.send.mock.calls[0][0].body.data).toBe(99);
  });

  it("returns 'already exists' when same type already present", async () => {
    validateSpy.mockReturnValueOnce({ value: { ad_id: 1, user_id: 2, type: 1 }, error: undefined });
    findOneSpy.mockResolvedValueOnce({ id: 5 }); // (ad_id,user_id) exists
    findOneSpy.mockResolvedValueOnce({ id: 5 }); // type also exists
    const res = mockRes();
    await svc.hideFavAd({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "data with this type already exists for this ad_id"
    );
  });

  it("inserts when (ad_id,user_id) exists but type does NOT", async () => {
    validateSpy.mockReturnValueOnce({ value: { ad_id: 1, user_id: 2, type: 2 }, error: undefined });
    findOneSpy.mockResolvedValueOnce({ id: 5 }); // (ad_id,user_id) exists
    findOneSpy.mockResolvedValueOnce(null);      // type doesn't
    createSpy.mockResolvedValueOnce({ id: 77 });
    const res = mockRes();
    await svc.hideFavAd({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("data inserted successfully");
    expect(res.send.mock.calls[0][0].body.data).toBe(77);
  });

  it("catches error and returns 'Failed to insert data'", async () => {
    validateSpy.mockImplementationOnce(() => { throw new Error("boom"); });
    const res = mockRes();
    await svc.hideFavAd({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Failed to insert data");
  });
});

describe("hideFavAdAPI.service > unHideFavAd", () => {
  it("VALIDATION_FAIL when validation errors", async () => {
    validateSpy.mockReturnValueOnce({ value: {}, error: { message: "bad" } });
    const res = mockRes();
    await svc.unHideFavAd({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("VALIDATION_FAIL");
  });

  it("'Ad is not found for this id' when no (ad_id,user_id) match", async () => {
    validateSpy.mockReturnValueOnce({ value: { ad_id: 1, user_id: 2 }, error: undefined });
    findOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.unHideFavAd({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Ad is not found for this id");
  });

  it("deletes and returns success when type also matches", async () => {
    validateSpy.mockReturnValueOnce({ value: { ad_id: 1, user_id: 2, type: 1 }, error: undefined });
    findOneSpy.mockResolvedValueOnce({ id: 5 });
    findOneSpy.mockResolvedValueOnce({ id: 5 });
    destroySpy.mockResolvedValueOnce(1);
    const res = mockRes();
    await svc.unHideFavAd({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("data deleted successfully");
  });

  it("does not respond when destroy returns falsy", async () => {
    validateSpy.mockReturnValueOnce({ value: { ad_id: 1, user_id: 2, type: 1 }, error: undefined });
    findOneSpy.mockResolvedValueOnce({ id: 5 });
    findOneSpy.mockResolvedValueOnce({ id: 5 });
    destroySpy.mockResolvedValueOnce(0);
    const res = mockRes();
    await svc.unHideFavAd({ body: {} }, res);
    expect(res.send).not.toHaveBeenCalled();
  });

  it("returns 'data not found for this type' when type does NOT match", async () => {
    validateSpy.mockReturnValueOnce({ value: { ad_id: 1, user_id: 2, type: 2 }, error: undefined });
    findOneSpy.mockResolvedValueOnce({ id: 5 });
    findOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.unHideFavAd({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("data not found for this type");
  });

  it("catches error and returns 'Failed to delete data'", async () => {
    validateSpy.mockImplementationOnce(() => { throw new Error("boom"); });
    const res = mockRes();
    await svc.unHideFavAd({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Failed to delete data");
  });
});

describe("hideFavAdAPI.service > getHideAds", () => {
  it("returns deduped HideFavAds when ES returns rows", async () => {
    findAllSpy.mockResolvedValueOnce([
      { ad_id: 1, type: 1 },
      { ad_id: 2, type: 1 },
    ]);
    esGetHideFavAdsSpy.mockResolvedValueOnce([
      { sql_id: 1, hash: "a" },
      { sql_id: 1, hash: "a-dup" },
      { sql_id: 2, hash: "b" },
    ]);
    const res = mockRes();
    await svc.getHideAds({ body: { type: 1, user_id: 5 } }, res);
    expect(esGetHideFavAdsSpy).toHaveBeenCalledWith([
      { sql_id: 1, type: 1 },
      { sql_id: 2, type: 1 },
    ]);
    const data = res.send.mock.calls[0][0].body.data;
    expect(data.length).toBe(2);
  });

  it("handles ES returning null (uses optional chaining)", async () => {
    findAllSpy.mockResolvedValueOnce([{ ad_id: 1, type: 1 }]);
    esGetHideFavAdsSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.getHideAds({ body: { type: 1, user_id: 5 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "HideFavAds retrieved successfully"
    );
    expect(res.send.mock.calls[0][0].body.data).toEqual([]);
  });

  it("returns 'No ads found' when findAll resolves falsy", async () => {
    findAllSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.getHideAds({ body: { type: 1, user_id: 5 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "No ads found for the specified type"
    );
  });

  it("catches error and returns 'Failed to retrieve HideFavads'", async () => {
    findAllSpy.mockRejectedValueOnce(new Error("db-down"));
    const res = mockRes();
    await svc.getHideAds({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Failed to retrieve HideFavads"
    );
  });
});

describe("hideFavAdAPI.service > getHideFavAds", () => {
  it("returns 400 when type or user_id missing", async () => {
    const res = mockRes();
    await svc.getHideFavAds({ body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send.mock.calls[0][0].body.message).toBe("Missing type or user_id");
  });

  it("returns 200 with 'No ads found' when empty result", async () => {
    findAllSpy.mockResolvedValueOnce([]);
    const res = mockRes();
    await svc.getHideFavAds({ body: { type: 1, user_id: 5 } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "No ads found for the specified type"
    );
  });

  it("returns success with rows", async () => {
    findAllSpy.mockResolvedValueOnce([{ ad_id: 1, type: 1 }]);
    const res = mockRes();
    await svc.getHideFavAds({ body: { type: 1, user_id: 5 } }, res);
    expect(res.send.mock.calls.at(-1)[0].body.message).toBe(
      "HideFavAds retrieved successfully"
    );
  });

  it("returns 500 on caught error", async () => {
    findAllSpy.mockRejectedValueOnce(new Error("db-down"));
    const res = mockRes();
    await svc.getHideFavAds({ body: { type: 1, user_id: 5 } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send.mock.calls.at(-1)[0].body.message).toBe(
      "Failed to retrieve HideFavAds"
    );
  });
});
