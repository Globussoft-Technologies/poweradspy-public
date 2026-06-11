import { describe, it, expect, vi, beforeEach } from "vitest";

// NOTE: Branch coverage caps at ~95% — same redundant !dataFind dead
// branch on line 65 as other services.

const {
  createSpy, findOneSpy, findAllSpy, updateSpy, destroySpy,
  createValidateSpy, updateValidateSpy, loggerErrorSpy,
} = vi.hoisted(() => ({
  createSpy: vi.fn(),
  findOneSpy: vi.fn(),
  findAllSpy: vi.fn(),
  updateSpy: vi.fn(),
  destroySpy: vi.fn(),
  createValidateSpy: vi.fn(),
  updateValidateSpy: vi.fn(),
  loggerErrorSpy: vi.fn(),
}));

vi.mock("../../../Sequelize_cli/models/index.js", () => ({
  default: {
    tiktok_ad_location: {
      create: createSpy,
      findOne: findOneSpy,
      findAll: findAllSpy,
      update: updateSpy,
      destroy: destroySpy,
    },
  },
}));

vi.mock("../../../core/adLocation/adLocation.validation.js", () => ({
  default: { createAdLocation: createValidateSpy, updateAdLocation: updateValidateSpy },
}));

vi.mock("../../../resources/logs/logger.log.js", () => ({
  default: { info: vi.fn(), error: loggerErrorSpy, warn: vi.fn() },
}));

vi.mock("config", () => ({ default: { get: vi.fn((k) => `cfg:${k}`) } }));

let svc;
beforeEach(async () => {
  vi.resetModules();
  for (const s of [createSpy, findOneSpy, findAllSpy, updateSpy, destroySpy, createValidateSpy, updateValidateSpy, loggerErrorSpy])
    s.mockReset();
  ({ default: svc } = await import(
    "../../../core/adLocation/adLocation.service.js"
  ));
});

function mockRes() {
  const res = {};
  res.send = vi.fn(() => res);
  return res;
}

describe("adLocation.service > AddLocation", () => {
  it("VALIDATION_FAIL when validation errors", async () => {
    createValidateSpy.mockReturnValueOnce({ value: {}, error: { message: "bad" } });
    const res = mockRes();
    await svc.AddLocation({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("VALIDATION_FAIL");
  });

  it("inserts when no row matches ad_id", async () => {
    createValidateSpy.mockReturnValueOnce({ value: { ad_id: "a-1" }, error: undefined });
    findOneSpy.mockResolvedValueOnce(null);
    createSpy.mockResolvedValueOnce({ id: 1 });
    const res = mockRes();
    await svc.AddLocation({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "New AD_location inserted successfully"
    );
  });

  it("updates when row matches ad_id", async () => {
    createValidateSpy.mockReturnValueOnce({ value: { ad_id: "a-1" }, error: undefined });
    findOneSpy.mockResolvedValueOnce({ id: 1 });
    updateSpy.mockResolvedValueOnce([1]);
    const res = mockRes();
    await svc.AddLocation({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "ad_location updated successfully"
    );
  });

  it("catches error and returns failure response", async () => {
    createValidateSpy.mockImplementationOnce(() => { throw new Error("boom"); });
    const res = mockRes();
    await svc.AddLocation({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Failed to add Ads location."
    );
  });
});

describe("adLocation.service > getLocationData", () => {
  it("returns success when row is found", async () => {
    findOneSpy.mockResolvedValueOnce({ id: 1 });
    const res = mockRes();
    await svc.getLocationData({ params: { locationid: 1 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "ad-location info fetched successfully"
    );
  });

  it("returns 'No data Found' when row not found", async () => {
    findOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.getLocationData({ params: { locationid: 9 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("No data Found");
  });

  it("returns 'No data Found' when locationid missing", async () => {
    const res = mockRes();
    await svc.getLocationData({ params: {} }, res);
    expect(findOneSpy).not.toHaveBeenCalled();
    expect(res.send.mock.calls[0][0].body.message).toBe("No data Found");
  });

  it("catches error and returns failure response", async () => {
    findOneSpy.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await svc.getLocationData({ params: { locationid: 1 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Failed to fetch ad-location."
    );
  });
});

describe("adLocation.service > getAllLocationData", () => {
  it("returns success when findAll resolves with rows", async () => {
    findAllSpy.mockResolvedValueOnce([{ id: 1 }]);
    const res = mockRes();
    await svc.getAllLocationData({}, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "ad location info fetched successfully"
    );
  });

  it("does not respond when findAll resolves falsy", async () => {
    findAllSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.getAllLocationData({}, res);
    expect(res.send).not.toHaveBeenCalled();
  });

  it("catches error and returns failure response", async () => {
    findAllSpy.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await svc.getAllLocationData({}, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Failed to fetch ad location."
    );
  });
});

describe("adLocation.service > updateLocationData", () => {
  it("VALIDATION_FAIL when validation errors", async () => {
    updateValidateSpy.mockReturnValueOnce({ value: {}, error: { message: "bad" } });
    const res = mockRes();
    await svc.updateLocationData({ params: { locationid: 1 }, body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("VALIDATION_FAIL");
  });

  it("returns 'Invalid ad-location ID' when row not found", async () => {
    updateValidateSpy.mockReturnValueOnce({ value: {}, error: undefined });
    findOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.updateLocationData({ params: { locationid: 99 }, body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Invalid ad-location ID");
  });

  it("updates and returns success when row exists", async () => {
    updateValidateSpy.mockReturnValueOnce({ value: {}, error: undefined });
    findOneSpy.mockResolvedValueOnce({ id: 1 });
    updateSpy.mockResolvedValueOnce([1]);
    const res = mockRes();
    await svc.updateLocationData(
      { params: { locationid: 1 }, body: { city: "X" } },
      res
    );
    expect(updateSpy).toHaveBeenCalledWith({ city: "X" }, { where: { id: 1 } });
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Ad-location data updated successfully"
    );
  });

  it("does not respond when update returns falsy", async () => {
    updateValidateSpy.mockReturnValueOnce({ value: {}, error: undefined });
    findOneSpy.mockResolvedValueOnce({ id: 1 });
    updateSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.updateLocationData({ params: { locationid: 1 }, body: {} }, res);
    expect(res.send).not.toHaveBeenCalled();
  });

  it("catches error and returns failure response", async () => {
    updateValidateSpy.mockImplementationOnce(() => { throw new Error("boom"); });
    const res = mockRes();
    await svc.updateLocationData({ params: { locationid: 1 }, body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Failed to update Ad-location data."
    );
  });
});

describe("adLocation.service > deleteLocationData", () => {
  it("returns 'Invalid location ID' when row not found", async () => {
    findOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.deleteLocationData({ params: { locationid: 99 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Invalid location ID");
  });

  it("deletes and returns success when row exists", async () => {
    findOneSpy.mockResolvedValueOnce({ id: 1 });
    destroySpy.mockResolvedValueOnce(1);
    const res = mockRes();
    await svc.deleteLocationData({ params: { locationid: 1 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Ad location data deleted successfully"
    );
  });

  it("does not respond when destroy returns falsy 0", async () => {
    findOneSpy.mockResolvedValueOnce({ id: 1 });
    destroySpy.mockResolvedValueOnce(0);
    const res = mockRes();
    await svc.deleteLocationData({ params: { locationid: 1 } }, res);
    expect(res.send).not.toHaveBeenCalled();
  });

  it("catches error and returns failure response", async () => {
    findOneSpy.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await svc.deleteLocationData({ params: { locationid: 1 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Failed to delete Ad-location with this Id."
    );
  });
});
