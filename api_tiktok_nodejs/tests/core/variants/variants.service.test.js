import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  validateCreateSpy, validateUpdateSpy,
  findOneSpy, createSpy, updateSpy, findAllSpy, destroySpy,
  validationFailSpy, userSuccessSpy, userFailSpy,
  loggerErrorSpy,
} = vi.hoisted(() => ({
  validateCreateSpy: vi.fn(),
  validateUpdateSpy: vi.fn(),
  findOneSpy: vi.fn(),
  createSpy: vi.fn(),
  updateSpy: vi.fn(),
  findAllSpy: vi.fn(),
  destroySpy: vi.fn(),
  validationFailSpy: vi.fn((kind, err) => ({ ok: false, kind, err })),
  userSuccessSpy: vi.fn((msg, data) => ({ ok: true, msg, data })),
  userFailSpy: vi.fn((msg, err) => ({ ok: false, msg, err })),
  loggerErrorSpy: vi.fn(),
}));

vi.mock("../../../core/variants/variants.validation.js", () => ({
  default: {
    createVariants: validateCreateSpy,
    updateVariants: validateUpdateSpy,
  },
}));

vi.mock("../../../Sequelize_cli/models/index.js", () => ({
  default: {
    tiktok_ad_variants: {
      findOne: findOneSpy,
      create: createSpy,
      update: updateSpy,
      findAll: findAllSpy,
      destroy: destroySpy,
    },
  },
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

vi.mock("config", () => ({ default: { get: () => undefined } }));

let service;

beforeEach(async () => {
  vi.resetModules();
  validateCreateSpy.mockReset();
  validateUpdateSpy.mockReset();
  findOneSpy.mockReset();
  createSpy.mockReset();
  updateSpy.mockReset();
  findAllSpy.mockReset();
  destroySpy.mockReset();
  validationFailSpy.mockClear();
  userSuccessSpy.mockClear();
  userFailSpy.mockClear();
  loggerErrorSpy.mockClear();
  ({ default: service } = await import(
    "../../../core/variants/variants.service.js"
  ));
});

function mockRes() {
  const res = {};
  res.send = vi.fn(() => res);
  return res;
}

// =====================================================================
describe("core/variants/variants.service > createVariants", () => {
  it("returns validationFailResp when validation has an error", async () => {
    const valErr = new Error("invalid");
    validateCreateSpy.mockReturnValueOnce({ value: undefined, error: valErr });
    const res = mockRes();
    await service.createVariants({ body: {} }, res);
    expect(loggerErrorSpy).toHaveBeenCalledWith(valErr);
    expect(validationFailSpy).toHaveBeenCalledWith("VALIDATION_FAIL", valErr);
    expect(res.send).toHaveBeenCalled();
  });

  it("creates a new record when no existing ad_id is found", async () => {
    validateCreateSpy.mockReturnValueOnce({
      value: { ad_id: "ad-1", title: "t" },
      error: undefined,
    });
    findOneSpy.mockResolvedValueOnce(null);
    createSpy.mockResolvedValueOnce({ id: 42, ad_id: "ad-1" });
    const res = mockRes();
    await service.createVariants({ body: { ad_id: "ad-1" } }, res);
    expect(createSpy).toHaveBeenCalledWith({ ad_id: "ad-1", title: "t" });
    expect(userSuccessSpy).toHaveBeenCalledWith(
      "New tiktok_variants inserted successfully",
      { id: 42, ad_id: "ad-1" }
    );
  });

  it("updates an existing record when ad_id already exists", async () => {
    validateCreateSpy.mockReturnValueOnce({
      value: { ad_id: "ad-2", title: "t2" },
      error: undefined,
    });
    findOneSpy
      .mockResolvedValueOnce({ id: 7, ad_id: "ad-2" }) // first findOne (existence check)
      .mockResolvedValueOnce({ id: 7, ad_id: "ad-2", title: "t2" }); // post-update fetch
    updateSpy.mockResolvedValueOnce([1]);
    const res = mockRes();
    await service.createVariants({ body: { ad_id: "ad-2" } }, res);
    expect(updateSpy).toHaveBeenCalledWith(
      { ad_id: "ad-2", title: "t2" },
      { where: { ad_id: "ad-2" } }
    );
    expect(userSuccessSpy).toHaveBeenCalledWith(
      "tiktok_variants updated successfully",
      { id: 7, ad_id: "ad-2", title: "t2" }
    );
  });

  it("returns userFailResp when validation throws (outer catch)", async () => {
    validateCreateSpy.mockImplementationOnce(() => {
      throw new Error("validation crashed");
    });
    const res = mockRes();
    await service.createVariants({ body: {} }, res);
    expect(userFailSpy).toHaveBeenCalledWith(
      "Failed to add tiktok_variants details",
      expect.any(Error)
    );
  });
});

describe("core/variants/variants.service > updateVariants", () => {
  it("returns validationFailResp when validation has an error", async () => {
    const valErr = new Error("invalid");
    validateUpdateSpy.mockReturnValueOnce({ value: undefined, error: valErr });
    const res = mockRes();
    await service.updateVariants({ params: { variantsid: "1" }, body: {} }, res);
    expect(validationFailSpy).toHaveBeenCalledWith("VALIDATION_FAIL", valErr);
  });

  it("returns userFailResp 'Invalid variants ID' when the record does not exist", async () => {
    validateUpdateSpy.mockReturnValueOnce({ value: {}, error: undefined });
    findOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await service.updateVariants({ params: { variantsid: "99" }, body: {} }, res);
    expect(userFailSpy).toHaveBeenCalledWith("Invalid variants ID");
  });

  it("updates the record and returns userSuccessResp on success", async () => {
    validateUpdateSpy.mockReturnValueOnce({ value: {}, error: undefined });
    findOneSpy.mockResolvedValueOnce({ id: 5 });
    updateSpy.mockResolvedValueOnce([1]);
    const res = mockRes();
    await service.updateVariants(
      { params: { variantsid: "5" }, body: { title: "new" } },
      res
    );
    expect(updateSpy).toHaveBeenCalledWith(
      { title: "new" },
      { where: { id: "5" } }
    );
    expect(userSuccessSpy).toHaveBeenCalledWith(
      "varinats data updated successfully",
      [1]
    );
  });

  it("returns userFailResp via outer catch when findOne throws", async () => {
    validateUpdateSpy.mockReturnValueOnce({ value: {}, error: undefined });
    findOneSpy.mockRejectedValueOnce(new Error("db-down"));
    const res = mockRes();
    await service.updateVariants({ params: { variantsid: "1" }, body: {} }, res);
    expect(loggerErrorSpy).toHaveBeenCalled();
    expect(userFailSpy).toHaveBeenCalledWith(
      "Failed to update variants data.",
      expect.any(Error)
    );
  });

  it("does NOT call userSuccessResp when update returns a falsy value (no-op branch)", async () => {
    validateUpdateSpy.mockReturnValueOnce({ value: {}, error: undefined });
    findOneSpy.mockResolvedValueOnce({ id: 5 });
    updateSpy.mockResolvedValueOnce(undefined); // falsy
    const res = mockRes();
    await service.updateVariants(
      { params: { variantsid: "5" }, body: {} },
      res
    );
    expect(userSuccessSpy).not.toHaveBeenCalled();
  });
});

describe("core/variants/variants.service > getAllVariants", () => {
  it("returns userSuccessResp with the data on findAll success", async () => {
    findAllSpy.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
    const res = mockRes();
    await service.getAllVariants({}, res);
    expect(userSuccessSpy).toHaveBeenCalledWith(
      "Ads variants details fetched successfully",
      [{ id: 1 }, { id: 2 }]
    );
  });

  it("returns userFailResp via outer catch when findAll throws", async () => {
    findAllSpy.mockRejectedValueOnce(new Error("db-down"));
    const res = mockRes();
    await service.getAllVariants({}, res);
    expect(loggerErrorSpy).toHaveBeenCalled();
    expect(userFailSpy).toHaveBeenCalledWith(
      "Failed to fetch Country gender.",
      expect.any(Error)
    );
  });

  it("does NOT call userSuccessResp when findAll returns a falsy value (no-op branch)", async () => {
    findAllSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await service.getAllVariants({}, res);
    expect(userSuccessSpy).not.toHaveBeenCalled();
  });
});

describe("core/variants/variants.service > deleteVariants", () => {
  it("returns userFailResp 'Invalid variants ID' when record not found", async () => {
    findOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await service.deleteVariants({ params: { variantsid: "99" } }, res);
    expect(userFailSpy).toHaveBeenCalledWith("Invalid variants ID");
  });

  it("destroys the record and returns userSuccessResp on success", async () => {
    findOneSpy.mockResolvedValueOnce({ id: 3 });
    destroySpy.mockResolvedValueOnce(1);
    const res = mockRes();
    await service.deleteVariants({ params: { variantsid: "3" } }, res);
    expect(destroySpy).toHaveBeenCalledWith({ where: { id: "3" } });
    expect(userSuccessSpy).toHaveBeenCalledWith(
      "variants id deleted successfully",
      1
    );
  });

  it("returns userFailResp via outer catch when findOne throws", async () => {
    findOneSpy.mockRejectedValueOnce(new Error("db-down"));
    const res = mockRes();
    await service.deleteVariants({ params: { variantsid: "3" } }, res);
    expect(loggerErrorSpy).toHaveBeenCalled();
    expect(userFailSpy).toHaveBeenCalledWith(
      "Failed to delete variants Id.",
      expect.any(Error)
    );
  });

  it("does NOT call userSuccessResp when destroy returns a falsy value (no-op branch)", async () => {
    findOneSpy.mockResolvedValueOnce({ id: 3 });
    destroySpy.mockResolvedValueOnce(0);
    const res = mockRes();
    await service.deleteVariants({ params: { variantsid: "3" } }, res);
    expect(userSuccessSpy).not.toHaveBeenCalled();
  });
});

describe("core/variants/variants.service > getVariants", () => {
  it("returns userSuccessResp when variantsid is supplied and findOne returns data", async () => {
    findOneSpy.mockResolvedValueOnce({ id: 5, title: "x" });
    const res = mockRes();
    await service.getVariants({ params: { variantsid: "5" } }, res);
    expect(findOneSpy).toHaveBeenCalledWith({ where: { id: "5" } });
    expect(userSuccessSpy).toHaveBeenCalledWith(
      "Ad variants info fetched successfully",
      { id: 5, title: "x" }
    );
  });

  it("returns userFailResp 'No data Found' when variantsid is supplied but findOne returns null", async () => {
    findOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await service.getVariants({ params: { variantsid: "99" } }, res);
    expect(userFailSpy).toHaveBeenCalledWith("No data Found");
  });

  it("returns userFailResp 'No data Found' when variantsid is missing (dataFind stays undefined)", async () => {
    const res = mockRes();
    await service.getVariants({ params: {} }, res);
    expect(findOneSpy).not.toHaveBeenCalled();
    expect(userFailSpy).toHaveBeenCalledWith("No data Found");
  });

  it("returns userFailResp via outer catch when findOne throws", async () => {
    findOneSpy.mockRejectedValueOnce(new Error("db-down"));
    const res = mockRes();
    await service.getVariants({ params: { variantsid: "1" } }, res);
    expect(loggerErrorSpy).toHaveBeenCalled();
    expect(userFailSpy).toHaveBeenCalledWith(
      "Failed to fetch ad varinats with this varinats id.",
      expect.any(Error)
    );
  });
});
