import { describe, it, expect, vi, beforeEach } from "vitest";

// NOTE: Branch coverage caps at ~95% — getMetaData has the same
// redundant `!dataFind` guard on line 107 as the other services.

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
    tiktok_ad_meta_data: {
      create: createSpy,
      findOne: findOneSpy,
      findAll: findAllSpy,
      update: updateSpy,
      destroy: destroySpy,
    },
  },
}));

vi.mock("../../../core/metaData/metaData.validation.js", () => ({
  default: { createMetaData: createValidateSpy, updateMetaData: updateValidateSpy },
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
    "../../../core/metaData/metaData.service.js"
  ));
});

function mockRes() {
  const res = {};
  res.send = vi.fn(() => res);
  return res;
}

describe("metaData.service > createMetaData", () => {
  it("returns VALIDATION_FAIL when validation errors", async () => {
    createValidateSpy.mockReturnValueOnce({ value: {}, error: { message: "bad" } });
    const res = mockRes();
    await svc.createMetaData({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("VALIDATION_FAIL");
  });

  it("inserts when no existing row matches ad_id", async () => {
    createValidateSpy.mockReturnValueOnce({ value: { ad_id: "a-1" }, error: undefined });
    findOneSpy.mockResolvedValueOnce(null);
    createSpy.mockResolvedValueOnce({ id: 1, ad_id: "a-1" });
    const res = mockRes();
    await svc.createMetaData({ body: {} }, res);
    expect(createSpy).toHaveBeenCalledWith({ ad_id: "a-1" });
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "New tiktok_meta_data inserted successfully"
    );
  });

  it("updates when existing row matches ad_id", async () => {
    createValidateSpy.mockReturnValueOnce({ value: { ad_id: "a-1" }, error: undefined });
    findOneSpy.mockResolvedValueOnce({ id: 1 });
    updateSpy.mockResolvedValueOnce([1]);
    const res = mockRes();
    await svc.createMetaData({ body: {} }, res);
    expect(updateSpy).toHaveBeenCalledWith(
      { ad_id: "a-1" }, { where: { ad_id: "a-1" } }
    );
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "tiktok_meta_data updated successfully"
    );
  });

  it("catches error and returns failure response", async () => {
    createValidateSpy.mockImplementationOnce(() => { throw new Error("boom"); });
    const res = mockRes();
    await svc.createMetaData({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Failed to add tiktok_meta_data details"
    );
  });
});

describe("metaData.service > updateMetaData", () => {
  it("returns VALIDATION_FAIL when validation errors", async () => {
    updateValidateSpy.mockReturnValueOnce({ value: {}, error: { message: "bad" } });
    const res = mockRes();
    await svc.updateMetaData({ params: { metadataid: 1 }, body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("VALIDATION_FAIL");
  });

  it("returns 'Invalid meta data ID' when row not found", async () => {
    updateValidateSpy.mockReturnValueOnce({ value: {}, error: undefined });
    findOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.updateMetaData({ params: { metadataid: 99 }, body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Invalid meta data ID");
  });

  it("updates and returns success when row exists", async () => {
    updateValidateSpy.mockReturnValueOnce({ value: {}, error: undefined });
    findOneSpy.mockResolvedValueOnce({ id: 1 });
    updateSpy.mockResolvedValueOnce([1]);
    const res = mockRes();
    await svc.updateMetaData({ params: { metadataid: 1 }, body: { ad_id: "X" } }, res);
    expect(updateSpy).toHaveBeenCalledWith({ ad_id: "X" }, { where: { id: 1 } });
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "metadata data updated successfully"
    );
  });

  it("does not respond when update resolves falsy", async () => {
    updateValidateSpy.mockReturnValueOnce({ value: {}, error: undefined });
    findOneSpy.mockResolvedValueOnce({ id: 1 });
    updateSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.updateMetaData({ params: { metadataid: 1 }, body: {} }, res);
    expect(res.send).not.toHaveBeenCalled();
  });

  it("catches error and returns failure response", async () => {
    updateValidateSpy.mockImplementationOnce(() => { throw new Error("boom"); });
    const res = mockRes();
    await svc.updateMetaData({ params: { metadataid: 1 }, body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Failed to update meta  data.");
  });
});

describe("metaData.service > getAllMetaData", () => {
  it("returns success when findAll resolves with rows", async () => {
    findAllSpy.mockResolvedValueOnce([{ id: 1 }]);
    const res = mockRes();
    await svc.getAllMetaData({}, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Ads meta data details fetched successfully"
    );
  });

  it("does not respond when findAll resolves falsy", async () => {
    findAllSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.getAllMetaData({}, res);
    expect(res.send).not.toHaveBeenCalled();
  });

  it("catches error and returns failure response", async () => {
    findAllSpy.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await svc.getAllMetaData({}, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Failed to fetch meta data.");
  });
});

describe("metaData.service > deleteMetaData", () => {
  it("returns 'Invalid meta data ID' when row not found", async () => {
    findOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.deleteMetaData({ params: { metadataid: 99 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Invalid meta data ID");
  });

  it("deletes and returns success when row exists", async () => {
    findOneSpy.mockResolvedValueOnce({ id: 1 });
    destroySpy.mockResolvedValueOnce(1);
    const res = mockRes();
    await svc.deleteMetaData({ params: { metadataid: 1 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "meta data id deleted successfully"
    );
  });

  it("does not respond when destroy returns falsy 0", async () => {
    findOneSpy.mockResolvedValueOnce({ id: 1 });
    destroySpy.mockResolvedValueOnce(0);
    const res = mockRes();
    await svc.deleteMetaData({ params: { metadataid: 1 } }, res);
    expect(res.send).not.toHaveBeenCalled();
  });

  it("catches error and returns failure response", async () => {
    findOneSpy.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await svc.deleteMetaData({ params: { metadataid: 1 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Failed to delete meta data Id.");
  });
});

describe("metaData.service > getMetaData", () => {
  it("returns success when row is found", async () => {
    findOneSpy.mockResolvedValueOnce({ id: 1 });
    const res = mockRes();
    await svc.getMetaData({ params: { metadataid: 1 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Ad meta data info fetched successfully"
    );
  });

  it("returns 'No data Found' when row not found", async () => {
    findOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.getMetaData({ params: { metadataid: 9 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("No data Found");
  });

  it("returns 'No data Found' when metadataid is missing", async () => {
    const res = mockRes();
    await svc.getMetaData({ params: {} }, res);
    expect(findOneSpy).not.toHaveBeenCalled();
    expect(res.send.mock.calls[0][0].body.message).toBe("No data Found");
  });

  it("catches error and returns failure response", async () => {
    findOneSpy.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await svc.getMetaData({ params: { metadataid: 1 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Failed to fetch ad meta data with this meta data id."
    );
  });
});
