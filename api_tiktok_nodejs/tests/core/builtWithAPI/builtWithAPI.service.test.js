import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  findOneSpy, findAllSpy, updateSpy,
  validateSpy, loggerErrorSpy, configGetSpy,
} = vi.hoisted(() => ({
  findOneSpy: vi.fn(),
  findAllSpy: vi.fn(),
  updateSpy: vi.fn(),
  validateSpy: vi.fn(),
  loggerErrorSpy: vi.fn(),
  configGetSpy: vi.fn(),
}));

vi.mock("../../../Sequelize_cli/models/index.js", () => ({
  default: {
    tiktok_ad_meta_data: {
      findOne: findOneSpy,
      findAll: findAllSpy,
      update: updateSpy,
    },
  },
}));

vi.mock("../../../core/builtWithAPI/builtWithAPI.validation.js", () => ({
  default: { createBuiltWith: validateSpy },
}));

vi.mock("../../../resources/logs/logger.log.js", () => ({
  default: { info: vi.fn(), error: loggerErrorSpy, warn: vi.fn() },
}));

vi.mock("config", () => ({ default: { get: configGetSpy } }));

let svc;
beforeEach(async () => {
  vi.resetModules();
  for (const s of [findOneSpy, findAllSpy, updateSpy, validateSpy, loggerErrorSpy, configGetSpy])
    s.mockReset();
  configGetSpy.mockImplementation((k) => `cfg:${k}`);
  ({ default: svc } = await import(
    "../../../core/builtWithAPI/builtWithAPI.service.js"
  ));
});

function mockRes() {
  const res = {};
  res.send = vi.fn(() => res);
  return res;
}

describe("core/builtWithAPI/builtWithAPI.service > updateBuiltWithStatus", () => {
  it("returns validation fail response when validation errors", async () => {
    validateSpy.mockReturnValueOnce({ value: {}, error: { message: "bad" } });
    const res = mockRes();
    await svc.updateBuiltWithStatus({ body: { id: "x" } }, res);
    const payload = res.send.mock.calls[0][0];
    expect(payload.statusCode).toBe(400);
    expect(payload.body.message).toBe("VALIDATION_FAIL");
  });

  it("returns Invalid Ad_id when no row matches", async () => {
    validateSpy.mockReturnValueOnce({ value: { id: 1 }, error: undefined });
    findOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.updateBuiltWithStatus({ body: {} }, res);
    expect(findOneSpy).toHaveBeenCalledWith({ where: { id: 1 } });
    expect(res.send.mock.calls[0][0].body.message).toBe("Invalid Ad_id");
  });

  it("updates and returns success when row exists", async () => {
    validateSpy.mockReturnValueOnce({ value: { id: 1, status: "ok" }, error: undefined });
    findOneSpy.mockResolvedValueOnce({ id: 1 });
    updateSpy.mockResolvedValueOnce([1]);
    const res = mockRes();
    await svc.updateBuiltWithStatus({ body: {} }, res);
    expect(updateSpy).toHaveBeenCalledWith(
      { id: 1, status: "ok" },
      { where: { id: 1 } }
    );
    const payload = res.send.mock.calls[0][0];
    expect(payload.statusCode).toBe(200);
    expect(payload.body.data).toEqual([1]);
  });

  it("catches thrown error and returns failure response", async () => {
    validateSpy.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const res = mockRes();
    await svc.updateBuiltWithStatus({ body: {} }, res);
    expect(loggerErrorSpy).toHaveBeenCalled();
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Failed to add built_with."
    );
  });
});

describe("core/builtWithAPI/builtWithAPI.service > getUrlsForBuiltWith", () => {
  it("returns records + updates status when results exist", async () => {
    findAllSpy.mockResolvedValueOnce([
      { id: 1, library_url: "a", destination_url: "b" },
      { id: 2, library_url: "c", destination_url: "d" },
    ]);
    updateSpy.mockResolvedValueOnce([2]);
    const res = mockRes();
    await svc.getUrlsForBuiltWith({}, res);
    expect(findAllSpy).toHaveBeenCalledWith({
      attributes: ["id", "library_url", "destination_url"],
      where: { status: 0 },
    });
    expect(updateSpy).toHaveBeenCalledWith({ status: 1 }, { where: { id: [1, 2] } });
    const payload = res.send.mock.calls[0][0];
    expect(payload.body.message).toBe("records fetched successfully");
    expect(payload.body.data.length).toBe(2);
  });

  it("returns 'No more records to fetch' when findAll is empty", async () => {
    findAllSpy.mockResolvedValueOnce([]);
    const res = mockRes();
    await svc.getUrlsForBuiltWith({}, res);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "No more records to fetch"
    );
  });

  it("catches error and returns failure response", async () => {
    findAllSpy.mockRejectedValueOnce(new Error("db-down"));
    const res = mockRes();
    await svc.getUrlsForBuiltWith({}, res);
    expect(loggerErrorSpy).toHaveBeenCalled();
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Failed to fetch records."
    );
  });
});
