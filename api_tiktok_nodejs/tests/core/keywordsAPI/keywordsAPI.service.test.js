import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  bulkCreateSpy, findOneSpy, updateSpy,
  existsSyncSpy, readFileSpy, loggerErrorSpy,
} = vi.hoisted(() => ({
  bulkCreateSpy: vi.fn(),
  findOneSpy: vi.fn(),
  updateSpy: vi.fn(),
  existsSyncSpy: vi.fn(),
  readFileSpy: vi.fn(),
  loggerErrorSpy: vi.fn(),
}));

vi.mock("../../../Sequelize_cli/models/index.js", () => ({
  default: {
    tiktok_keywords: {
      bulkCreate: bulkCreateSpy,
      findOne: findOneSpy,
      update: updateSpy,
    },
  },
}));

vi.mock("../../../resources/logs/logger.log.js", () => ({
  default: { info: vi.fn(), error: loggerErrorSpy, warn: vi.fn() },
}));

vi.mock("fs", async () => {
  const actual = await vi.importActual("fs");
  return {
    ...actual,
    default: { ...actual, existsSync: existsSyncSpy, readFile: readFileSpy },
    existsSync: existsSyncSpy,
    readFile: readFileSpy,
  };
});

let svc;
beforeEach(async () => {
  vi.resetModules();
  for (const s of [bulkCreateSpy, findOneSpy, updateSpy, existsSyncSpy, readFileSpy, loggerErrorSpy])
    s.mockReset();
  ({ default: svc } = await import(
    "../../../core/keywordsAPI/keywordsAPI.service.js"
  ));
});

function mockRes() {
  const res = {};
  res.send = vi.fn(() => res);
  return res;
}

describe("core/keywordsAPI/keywordsAPI.service > addKeywords", () => {
  it("returns 'Keyword NOT Found' when keywords array is empty", async () => {
    // Note: source says `!keywords.length>0` which evaluates as
    // `(!keywords.length) > 0` due to operator precedence — i.e.
    // `false > 0` (always false for length>0) or `true > 0` (true)
    // when keywords.length is 0. We exercise the empty-array path.
    const res = mockRes();
    await svc.addKeywords({ body: { keywords: [] } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Keyword NOT Found");
  });

  it("bulk-inserts and returns success when keywords provided", async () => {
    bulkCreateSpy.mockResolvedValueOnce([{ id: 1, keyword: "a" }]);
    const res = mockRes();
    await svc.addKeywords({ body: { keywords: ["a", "b"] } }, res);
    expect(bulkCreateSpy).toHaveBeenCalledWith([
      { keyword: "a" }, { keyword: "b" },
    ]);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Keyword data inserted successfully"
    );
  });

  it("no response when bulkCreate resolves falsy", async () => {
    bulkCreateSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.addKeywords({ body: { keywords: ["a"] } }, res);
    expect(res.send).not.toHaveBeenCalled();
  });

  it("catches error and returns failure response", async () => {
    bulkCreateSpy.mockRejectedValueOnce(new Error("db-down"));
    const res = mockRes();
    await svc.addKeywords({ body: { keywords: ["a"] } }, res);
    expect(loggerErrorSpy).toHaveBeenCalled();
    expect(res.send.mock.calls[0][0].body.message).toBe("Error fetching ads");
  });
});

describe("core/keywordsAPI/keywordsAPI.service > getKeywords", () => {
  it("returns Keyword when findOne finds a row + updates its status to 1", async () => {
    findOneSpy.mockResolvedValueOnce({ id: 7, keyword: "shoes" });
    updateSpy.mockResolvedValueOnce([1]);
    const res = mockRes();
    await svc.getKeywords({}, res);
    expect(updateSpy).toHaveBeenCalledWith({ status: 1 }, { where: { id: 7 } });
    expect(res.send.mock.calls[0][0].body.data).toBe("shoes");
  });

  it("falls into the (!keyword) branch — known source bug #218: `const keyword` reassigned at line 43 throws TypeError, caught by outer catch", async () => {
    // findOne returns null first → enters if (!keyword) {} block.
    // Source bug: `keyword = await ...` on a const var throws TypeError.
    // Outer catch swallows it and returns userFailResp("Error fetching ads").
    findOneSpy.mockResolvedValueOnce(null);
    updateSpy.mockResolvedValueOnce([0]);
    const res = mockRes();
    await svc.getKeywords({}, res);
    expect(loggerErrorSpy).toHaveBeenCalled();
    expect(res.send.mock.calls[0][0].body.message).toBe("Error fetching ads");
  });

  it("catches DB error in the outer try and returns failure response", async () => {
    findOneSpy.mockRejectedValueOnce(new Error("db-down"));
    const res = mockRes();
    await svc.getKeywords({}, res);
    expect(loggerErrorSpy).toHaveBeenCalled();
    expect(res.send.mock.calls[0][0].body.message).toBe("Error fetching ads");
  });
});

describe("core/keywordsAPI/keywordsAPI.service > getLogFiles", () => {
  it("returns 400-shape when day/month/year missing", async () => {
    const res = mockRes();
    await svc.getLogFiles({ query: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Day, month, and year parameters are required"
    );
  });

  it("returns failure when logs directory does not exist", async () => {
    existsSyncSpy.mockReturnValueOnce(false);
    const res = mockRes();
    await svc.getLogFiles({ query: { day: "1", month: "1", year: "2025" } }, res);
    expect(res.send.mock.calls[0][0].body.message).toMatch(
      /Directory does not exist/
    );
  });

  it("returns 'No log file found' when the file path doesn't exist", async () => {
    existsSyncSpy.mockReturnValueOnce(true).mockReturnValueOnce(false);
    const res = mockRes();
    await svc.getLogFiles({ query: { day: "1", month: "1", year: "2025" } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "No log file found for the given date"
    );
  });

  it("reads the log file and returns success on read success", async () => {
    existsSyncSpy.mockReturnValue(true);
    readFileSpy.mockImplementationOnce((_p, _enc, cb) => cb(null, "LOG CONTENT"));
    const res = mockRes();
    await svc.getLogFiles({ query: { day: "1", month: "1", year: "2025" } }, res);
    expect(res.send.mock.calls.at(-1)[0].body.data).toBe("LOG CONTENT");
  });

  it("returns failure when readFile reports an error", async () => {
    existsSyncSpy.mockReturnValue(true);
    readFileSpy.mockImplementationOnce((_p, _enc, cb) => cb(new Error("read-fail")));
    const res = mockRes();
    await svc.getLogFiles({ query: { day: "1", month: "1", year: "2025" } }, res);
    expect(loggerErrorSpy).toHaveBeenCalled();
    expect(res.send.mock.calls.at(-1)[0].body.message).toBe(
      "Error reading log file"
    );
  });

  it("catches outer error from existsSync throwing", async () => {
    existsSyncSpy.mockImplementationOnce(() => {
      throw new Error("fs-down");
    });
    const res = mockRes();
    await svc.getLogFiles({ query: { day: "1", month: "1", year: "2025" } }, res);
    expect(loggerErrorSpy).toHaveBeenCalled();
    expect(res.send.mock.calls[0][0].body.message).toBe("Error fetching log file");
  });
});
