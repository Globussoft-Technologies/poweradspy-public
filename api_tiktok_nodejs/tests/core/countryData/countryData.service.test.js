import { describe, it, expect, vi, beforeEach } from "vitest";

// NOTE: getCountry has a redundant `!dataFind` branch (line 55) after
// the preceding `if (dataFind) return` early-exit — same pattern as the
// other country*.service files. Branch coverage caps at ~95%.

const {
  createSpy, findOneSpy, findAllSpy, updateSpy, destroySpy,
  addValidateSpy, updateValidateSpy, loggerErrorSpy,
} = vi.hoisted(() => ({
  createSpy: vi.fn(),
  findOneSpy: vi.fn(),
  findAllSpy: vi.fn(),
  updateSpy: vi.fn(),
  destroySpy: vi.fn(),
  addValidateSpy: vi.fn(),
  updateValidateSpy: vi.fn(),
  loggerErrorSpy: vi.fn(),
}));

vi.mock("../../../Sequelize_cli/models/index.js", () => ({
  default: {
    tiktok_ad_country_info: {
      create: createSpy,
      findOne: findOneSpy,
      findAll: findAllSpy,
      update: updateSpy,
      destroy: destroySpy,
    },
  },
}));

vi.mock("../../../core/countryData/countryData.validation.js", () => ({
  default: { addCountry: addValidateSpy, updateCountry: updateValidateSpy },
}));

vi.mock("../../../resources/logs/logger.log.js", () => ({
  default: { info: vi.fn(), error: loggerErrorSpy, warn: vi.fn() },
}));

let svc;
beforeEach(async () => {
  vi.resetModules();
  for (const s of [createSpy, findOneSpy, findAllSpy, updateSpy, destroySpy, addValidateSpy, updateValidateSpy, loggerErrorSpy])
    s.mockReset();
  ({ default: svc } = await import(
    "../../../core/countryData/countryData.service.js"
  ));
});

function mockRes() {
  const res = {};
  res.send = vi.fn(() => res);
  return res;
}

describe("countryData.service > AddData", () => {
  it("returns Validation Failed when validation errors", async () => {
    addValidateSpy.mockReturnValueOnce({ value: {}, error: { message: "bad" } });
    const res = mockRes();
    await svc.AddData({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Validation Failed");
  });

  it("returns 'Country already exists' when name match found", async () => {
    addValidateSpy.mockReturnValueOnce({ value: { name: "IN" }, error: undefined });
    findOneSpy.mockResolvedValueOnce({ id: 1 });
    const res = mockRes();
    await svc.AddData({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Country already exists");
  });

  it("creates and returns success when no name match", async () => {
    addValidateSpy.mockReturnValueOnce({ value: { name: "IN" }, error: undefined });
    findOneSpy.mockResolvedValueOnce(null);
    createSpy.mockResolvedValueOnce({ id: 9, name: "IN" });
    const res = mockRes();
    await svc.AddData({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Country data inserted successfully"
    );
  });

  it("does not respond when create resolves falsy", async () => {
    addValidateSpy.mockReturnValueOnce({ value: { name: "IN" }, error: undefined });
    findOneSpy.mockResolvedValueOnce(null);
    createSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.AddData({ body: {} }, res);
    expect(res.send).not.toHaveBeenCalled();
  });

  it("catches error and returns failure response", async () => {
    addValidateSpy.mockImplementationOnce(() => { throw new Error("boom"); });
    const res = mockRes();
    await svc.AddData({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Failed to add Country data."
    );
  });
});

describe("countryData.service > getCountry", () => {
  it("returns success when row is found", async () => {
    findOneSpy.mockResolvedValueOnce({ id: 1 });
    const res = mockRes();
    await svc.getCountry({ params: { countryid: 1 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Country info fetched successfully"
    );
  });

  it("returns 'No data Found' when row not found", async () => {
    findOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.getCountry({ params: { countryid: 9 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("No data Found");
  });

  it("returns 'No data Found' when countryid missing", async () => {
    const res = mockRes();
    await svc.getCountry({ params: {} }, res);
    expect(findOneSpy).not.toHaveBeenCalled();
    expect(res.send.mock.calls[0][0].body.message).toBe("No data Found");
  });

  it("catches error and returns failure response", async () => {
    findOneSpy.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await svc.getCountry({ params: { countryid: 1 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Failed to fetch Country data."
    );
  });
});

describe("countryData.service > getAllCountry", () => {
  it("returns success when findAll resolves with rows", async () => {
    findAllSpy.mockResolvedValueOnce([{ id: 1 }]);
    const res = mockRes();
    await svc.getAllCountry({}, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Country info fetched successfully"
    );
  });

  it("does not respond when findAll resolves falsy", async () => {
    findAllSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.getAllCountry({}, res);
    expect(res.send).not.toHaveBeenCalled();
  });

  it("catches error and returns failure response", async () => {
    findAllSpy.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await svc.getAllCountry({}, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Failed to fetch Country data."
    );
  });
});

describe("countryData.service > updateCountryData", () => {
  it("returns 'Invalid country ID' when row not found", async () => {
    findOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.updateCountryData({ params: { countryid: 99 }, body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Invalid country ID");
  });

  it("updates and returns success when row exists + validation OK", async () => {
    findOneSpy.mockResolvedValueOnce({ id: 1 });
    updateValidateSpy.mockReturnValueOnce({ value: {}, error: undefined });
    updateSpy.mockResolvedValueOnce([1]);
    const res = mockRes();
    await svc.updateCountryData({ params: { countryid: 1 }, body: { name: "X" } }, res);
    expect(updateSpy).toHaveBeenCalledWith({ name: "X" }, { where: { id: 1 } });
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Country data updated successfully"
    );
  });

  it("validation error path hits the broken userFailResp ReferenceError (issue #219) — caught by outer try, returns 'Failed to update Country data.'", async () => {
    findOneSpy.mockResolvedValueOnce({ id: 1 });
    updateValidateSpy.mockReturnValueOnce({ value: {}, error: { message: "bad" } });
    const res = mockRes();
    await svc.updateCountryData({ params: { countryid: 1 }, body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Failed to update Country data."
    );
  });

  it("does not respond when update resolves falsy", async () => {
    findOneSpy.mockResolvedValueOnce({ id: 1 });
    updateValidateSpy.mockReturnValueOnce({ value: {}, error: undefined });
    updateSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.updateCountryData({ params: { countryid: 1 }, body: {} }, res);
    expect(res.send).not.toHaveBeenCalled();
  });

  it("catches error from findOne and returns failure response", async () => {
    findOneSpy.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await svc.updateCountryData({ params: { countryid: 1 }, body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Failed to update Country data."
    );
  });
});

describe("countryData.service > deleteCountryData", () => {
  it("returns 'Invalid country ID' when row not found", async () => {
    findOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.deleteCountryData({ params: { countryid: 99 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Invalid country ID");
  });

  it("deletes and returns success when row exists", async () => {
    findOneSpy.mockResolvedValueOnce({ id: 1 });
    destroySpy.mockResolvedValueOnce(1);
    const res = mockRes();
    await svc.deleteCountryData({ params: { countryid: 1 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Country data deleted successfully"
    );
  });

  it("does not respond when destroy returns falsy 0", async () => {
    findOneSpy.mockResolvedValueOnce({ id: 1 });
    destroySpy.mockResolvedValueOnce(0);
    const res = mockRes();
    await svc.deleteCountryData({ params: { countryid: 1 } }, res);
    expect(res.send).not.toHaveBeenCalled();
  });

  it("catches error and returns failure response", async () => {
    findOneSpy.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await svc.deleteCountryData({ params: { countryid: 1 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Failed to delete Country data."
    );
  });
});
