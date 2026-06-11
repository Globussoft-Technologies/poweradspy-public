import { describe, it, expect, vi, beforeEach } from "vitest";

// NOTE: Branch coverage caps at 94.44% — the `if(!dataFind)` on line 32
// is unreachable after the preceding `if (dataFind) return` early-exit.

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
    tiktok_ad_country_ages: {
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
    "../../../core/countryAge/countryAge.service.js"
  ));
});

function mockRes() {
  const res = {};
  res.send = vi.fn(() => res);
  return res;
}

describe("countryAge.service > AddCountryAge", () => {
  it("returns success when create resolves with a row", async () => {
    createSpy.mockResolvedValueOnce({ id: 1, age: 25 });
    const res = mockRes();
    await svc.AddCountryAge({ body: { age: 25 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Age id inserted successfully");
  });

  it("no response when create resolves falsy", async () => {
    createSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.AddCountryAge({ body: {} }, res);
    expect(res.send).not.toHaveBeenCalled();
  });

  it("catches error and returns failure response", async () => {
    createSpy.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await svc.AddCountryAge({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Failed to add Age Id.");
  });
});

describe("countryAge.service > getCountryAge", () => {
  it("returns success when row is found", async () => {
    findOneSpy.mockResolvedValueOnce({ id: 5 });
    const res = mockRes();
    await svc.getCountryAge({ params: { ageid: 5 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Country age info fetched successfully"
    );
  });

  it("returns 'No data Found' when no row matches", async () => {
    findOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.getCountryAge({ params: { ageid: 9 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("No data Found");
  });

  it("returns 'No data Found' when ageid is missing", async () => {
    const res = mockRes();
    await svc.getCountryAge({ params: {} }, res);
    expect(findOneSpy).not.toHaveBeenCalled();
    expect(res.send.mock.calls[0][0].body.message).toBe("No data Found");
  });

  it("catches error and returns failure response", async () => {
    findOneSpy.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await svc.getCountryAge({ params: { ageid: 1 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Failed to fetch age id.");
  });
});

describe("countryAge.service > getAllCountryAge", () => {
  it("returns success when findAll resolves", async () => {
    findAllSpy.mockResolvedValueOnce([{ id: 1 }]);
    const res = mockRes();
    await svc.getAllCountryAge({}, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Country age info fetched successfully"
    );
  });

  it("does not respond when findAll resolves falsy", async () => {
    findAllSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.getAllCountryAge({}, res);
    expect(res.send).not.toHaveBeenCalled();
  });

  it("catches error and returns failure response", async () => {
    findAllSpy.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await svc.getAllCountryAge({}, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Failed to fetch age id.");
  });
});

describe("countryAge.service > updateCountryAge", () => {
  it("updates and returns success when row exists", async () => {
    findOneSpy.mockResolvedValueOnce({ id: 1 });
    updateSpy.mockResolvedValueOnce([1]);
    const res = mockRes();
    await svc.updateCountryAge({ params: { ageid: 1 }, body: { age: 30 } }, res);
    expect(updateSpy).toHaveBeenCalledWith({ age: 30 }, { where: { id: 1 } });
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Country age data updated successfully"
    );
  });

  it("returns 'Invalid age ID' when row not found", async () => {
    findOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.updateCountryAge({ params: { ageid: 99 }, body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Invalid age ID");
  });

  it("does not respond when update returns falsy", async () => {
    findOneSpy.mockResolvedValueOnce({ id: 1 });
    updateSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.updateCountryAge({ params: { ageid: 1 }, body: {} }, res);
    expect(res.send).not.toHaveBeenCalled();
  });

  it("catches error and returns failure response", async () => {
    findOneSpy.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await svc.updateCountryAge({ params: { ageid: 1 }, body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Failed to update Country age data."
    );
  });
});

describe("countryAge.service > deleteCountryAge", () => {
  it("deletes and returns success when row exists", async () => {
    findOneSpy.mockResolvedValueOnce({ id: 1 });
    destroySpy.mockResolvedValueOnce(1);
    const res = mockRes();
    await svc.deleteCountryAge({ params: { ageid: 1 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("age id deleted successfully");
  });

  it("returns 'Invalid age ID' when row not found", async () => {
    findOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.deleteCountryAge({ params: { ageid: 99 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Invalid age ID");
  });

  it("does not respond when destroy returns falsy 0", async () => {
    findOneSpy.mockResolvedValueOnce({ id: 1 });
    destroySpy.mockResolvedValueOnce(0);
    const res = mockRes();
    await svc.deleteCountryAge({ params: { ageid: 1 } }, res);
    expect(res.send).not.toHaveBeenCalled();
  });

  it("catches error and returns failure response", async () => {
    findOneSpy.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await svc.deleteCountryAge({ params: { ageid: 1 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Failed to delete age Id.");
  });
});
