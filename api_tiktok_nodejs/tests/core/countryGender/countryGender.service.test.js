import { describe, it, expect, vi, beforeEach } from "vitest";

// NOTE: Branch coverage caps at 94.44% (17/18). The remaining unreachable
// branch is on line 30: `if(!dataFind){...}`. The preceding `if (dataFind)`
// returns early when truthy, so the falsy branch of `!dataFind` (i.e.
// dataFind truthy) can never execute. Filed as a redundant-guard report;
// safe to leave at 94.44% per the cron's "dead/unreachable branch"
// allowance.

const { createSpy, findOneSpy, findAllSpy, updateSpy, destroySpy, loggerErrorSpy } =
  vi.hoisted(() => ({
    createSpy: vi.fn(),
    findOneSpy: vi.fn(),
    findAllSpy: vi.fn(),
    updateSpy: vi.fn(),
    destroySpy: vi.fn(),
    loggerErrorSpy: vi.fn(),
  }));

vi.mock("../../../Sequelize_cli/models/index.js", () => ({
  default: {
    tiktok_ad_country_gender: {
      create: createSpy,
      findOne: findOneSpy,
      findAll: findAllSpy,
      update: updateSpy,
      destroy: destroySpy,
    },
  },
}));

vi.mock("../../../resources/logs/logger.log.js", () => ({
  default: { info: vi.fn(), error: loggerErrorSpy, warn: vi.fn() },
}));

vi.mock("config", () => ({ default: { get: vi.fn((k) => `cfg:${k}`) } }));

let svc;
beforeEach(async () => {
  vi.resetModules();
  for (const s of [createSpy, findOneSpy, findAllSpy, updateSpy, destroySpy, loggerErrorSpy])
    s.mockReset();
  ({ default: svc } = await import(
    "../../../core/countryGender/countryGender.service.js"
  ));
});

function mockRes() {
  const res = {};
  res.send = vi.fn(() => res);
  return res;
}

describe("countryGender.service > AddCountryGender", () => {
  it("returns success when create resolves with a row", async () => {
    createSpy.mockResolvedValueOnce({ id: 1, gender: "M" });
    const res = mockRes();
    await svc.AddCountryGender({ body: { gender: "M" } }, res);
    expect(createSpy).toHaveBeenCalledWith({ gender: "M" });
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Country gender inserted successfully"
    );
  });

  it("no response when create resolves falsy", async () => {
    createSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.AddCountryGender({ body: {} }, res);
    expect(res.send).not.toHaveBeenCalled();
  });

  it("catches error and returns failure response", async () => {
    createSpy.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await svc.AddCountryGender({ body: {} }, res);
    expect(loggerErrorSpy).toHaveBeenCalled();
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Failed to add Country gender."
    );
  });
});

describe("countryGender.service > getCountryGender", () => {
  it("returns success when row is found", async () => {
    findOneSpy.mockResolvedValueOnce({ id: 5, gender: "F" });
    const res = mockRes();
    await svc.getCountryGender({ params: { genderid: 5 } }, res);
    expect(findOneSpy).toHaveBeenCalledWith({ where: { id: 5 } });
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Country gender info fetched successfully"
    );
  });

  it("returns 'No data Found' when no row is found", async () => {
    findOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.getCountryGender({ params: { genderid: 9 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("No data Found");
  });

  it("returns 'No data Found' when genderid is missing (dataFind never set)", async () => {
    const res = mockRes();
    await svc.getCountryGender({ params: {} }, res);
    expect(findOneSpy).not.toHaveBeenCalled();
    expect(res.send.mock.calls[0][0].body.message).toBe("No data Found");
  });

  it("catches error and returns failure response", async () => {
    findOneSpy.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await svc.getCountryGender({ params: { genderid: 1 } }, res);
    expect(loggerErrorSpy).toHaveBeenCalled();
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Failed to fetch Country gender."
    );
  });
});

describe("countryGender.service > getAllCountryGender", () => {
  it("returns success when findAll resolves", async () => {
    findAllSpy.mockResolvedValueOnce([{ id: 1 }]);
    const res = mockRes();
    await svc.getAllCountryGender({}, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Country gender info fetched successfully"
    );
  });

  it("catches error and returns failure response", async () => {
    findAllSpy.mockRejectedValueOnce(new Error("db-down"));
    const res = mockRes();
    await svc.getAllCountryGender({}, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Failed to fetch Country gender."
    );
  });

  it("does not respond when findAll resolves falsy", async () => {
    findAllSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.getAllCountryGender({}, res);
    expect(res.send).not.toHaveBeenCalled();
  });
});

describe("countryGender.service > updateCountryGender", () => {
  it("updates and returns success when row exists", async () => {
    findOneSpy.mockResolvedValueOnce({ id: 1 });
    updateSpy.mockResolvedValueOnce([1]);
    const res = mockRes();
    await svc.updateCountryGender({ params: { genderid: 1 }, body: { gender: "X" } }, res);
    expect(updateSpy).toHaveBeenCalledWith({ gender: "X" }, { where: { id: 1 } });
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Country gender data updated successfully"
    );
  });

  it("returns 'Invalid gender ID' when row not found", async () => {
    findOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.updateCountryGender({ params: { genderid: 99 }, body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Invalid gender ID");
  });

  it("catches error and returns failure response", async () => {
    findOneSpy.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await svc.updateCountryGender({ params: { genderid: 1 }, body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Failed to update Country gender data."
    );
  });

  it("does not respond when update resolves falsy", async () => {
    findOneSpy.mockResolvedValueOnce({ id: 1 });
    updateSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.updateCountryGender({ params: { genderid: 1 }, body: {} }, res);
    expect(res.send).not.toHaveBeenCalled();
  });
});

describe("countryGender.service > deleteCountryGender", () => {
  it("deletes and returns success when row exists", async () => {
    findOneSpy.mockResolvedValueOnce({ id: 1 });
    destroySpy.mockResolvedValueOnce(1);
    const res = mockRes();
    await svc.deleteCountryGender({ params: { genderid: 1 } }, res);
    expect(destroySpy).toHaveBeenCalledWith({ where: { id: 1 } });
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Gender id deleted successfully"
    );
  });

  it("returns 'Invalid gender ID' when row not found", async () => {
    findOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.deleteCountryGender({ params: { genderid: 99 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Invalid gender ID");
  });

  it("does not respond when destroy returns falsy 0", async () => {
    findOneSpy.mockResolvedValueOnce({ id: 1 });
    destroySpy.mockResolvedValueOnce(0);
    const res = mockRes();
    await svc.deleteCountryGender({ params: { genderid: 1 } }, res);
    expect(res.send).not.toHaveBeenCalled();
  });

  it("catches error and returns failure response", async () => {
    findOneSpy.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await svc.deleteCountryGender({ params: { genderid: 1 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Failed to delete Gender Id."
    );
  });
});
