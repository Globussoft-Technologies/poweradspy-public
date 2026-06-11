import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  createSpy, findAllSpy, transactionSpy, commitSpy, rollbackSpy,
  searchDocSpy, updateDocSpy, popularitySpy, loggerErrorSpy, loggerInfoSpy,
} = vi.hoisted(() => ({
  createSpy: vi.fn(),
  findAllSpy: vi.fn(),
  transactionSpy: vi.fn(),
  commitSpy: vi.fn(),
  rollbackSpy: vi.fn(),
  searchDocSpy: vi.fn(),
  updateDocSpy: vi.fn(),
  popularitySpy: vi.fn(() => [10, 20]),
  loggerErrorSpy: vi.fn(),
  loggerInfoSpy: vi.fn(),
}));

vi.mock("../../../Sequelize_cli/models/index.js", () => ({
  default: {
    tiktok_ad_analytics: { create: createSpy, findAll: findAllSpy },
    sequelize: { transaction: transactionSpy },
  },
}));

vi.mock("../../../utils/elasticSearch.js", () => ({
  updateDocument: updateDocSpy,
  searchDoc: searchDocSpy,
}));

vi.mock("../../../core/tiktok/tiktok.service.js", () => ({
  default: { popularityImpression: popularitySpy },
}));

vi.mock("../../../resources/logs/logger.log.js", () => ({
  default: { info: loggerInfoSpy, error: loggerErrorSpy, warn: vi.fn() },
}));

let svc;
beforeEach(async () => {
  vi.resetModules();
  for (const s of [
    createSpy, findAllSpy, transactionSpy, commitSpy, rollbackSpy,
    searchDocSpy, updateDocSpy, popularitySpy, loggerErrorSpy, loggerInfoSpy,
  ]) s.mockReset();
  popularitySpy.mockReturnValue([10, 20]);
  // Default: transaction object with finished: undefined initially
  const tx = { commit: commitSpy, rollback: rollbackSpy, finished: undefined };
  transactionSpy.mockResolvedValue(tx);
  commitSpy.mockImplementation(async () => { tx.finished = "commit"; });
  rollbackSpy.mockImplementation(async () => { tx.finished = "rollback"; });
  ({ default: svc } = await import("../../../core/lcs/lcs.service.js"));
});

function mockRes() {
  const res = {};
  res.send = vi.fn(() => res);
  return res;
}

describe("core/lcs/lcs.service > update", () => {
  it("returns 'Missing request data' when body is undefined", async () => {
    const res = mockRes();
    await svc.update({}, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Missing request data");
  });

  it("returns 'No ad found with ad_id' when searchDoc returns falsy", async () => {
    searchDocSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.update({ body: { id: "1", ad_id: "x" } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("No ad found with ad_id");
  });

  it("updates ANALYTICS + ES doc when likes/comments/shares differ", async () => {
    searchDocSpy.mockResolvedValueOnce({
      sql_id: 5,
      likes: 1, comments: 2, shares: 3,
      clicks_graph: [], ctr: 0.1,
    });
    createSpy.mockResolvedValueOnce({ id: 1 });
    updateDocSpy.mockResolvedValueOnce({ updated: true });
    const res = mockRes();
    await svc.update(
      { body: { id: "5", likes: 9, comments: 9, shares: 9 } },
      res
    );
    expect(popularitySpy).toHaveBeenCalledWith([], 0.1, 9, 9, 9);
    expect(createSpy).toHaveBeenCalled();
    expect(updateDocSpy).toHaveBeenCalledWith(
      "sql_id", 5,
      { likes: 9, comments: 9, shares: 9, popularity: 10, impression: 20 }
    );
    expect(commitSpy).toHaveBeenCalled();
    expect(res.send.mock.calls[0][0].body.message).toBe("LCS updated successfully");
  });

  it("returns 'LCS data is up to date' when counts match", async () => {
    searchDocSpy.mockResolvedValueOnce({
      sql_id: 5,
      likes: 9, comments: 9, shares: 9,
      clicks_graph: [], ctr: 0.1,
    });
    const res = mockRes();
    await svc.update(
      { body: { id: "5", likes: 9, comments: 9, shares: 9 } },
      res
    );
    expect(createSpy).not.toHaveBeenCalled();
    expect(res.send.mock.calls[0][0].body.message).toBe("LCS data is up to date");
  });

  it("catches error, rolls back, returns 'Error updating LCS'", async () => {
    searchDocSpy.mockRejectedValueOnce(new Error("es-down"));
    const res = mockRes();
    await svc.update({ body: { id: "1" } }, res);
    expect(rollbackSpy).toHaveBeenCalled();
    expect(res.send.mock.calls[0][0].body.message).toBe("Error updating LCS");
  });

  it("finally block: if transaction.finished is neither 'commit' nor 'rollback', forces rollback", async () => {
    // Make the update path succeed but prevent commit from setting finished
    const tx = { commit: vi.fn(async () => {}), rollback: vi.fn(async () => {}), finished: undefined };
    transactionSpy.mockResolvedValueOnce(tx);
    searchDocSpy.mockResolvedValueOnce({
      sql_id: 5, likes: 1, comments: 1, shares: 1,
      clicks_graph: [], ctr: 0,
    });
    createSpy.mockResolvedValueOnce({});
    updateDocSpy.mockResolvedValueOnce({});
    const res = mockRes();
    await svc.update(
      { body: { id: "5", likes: 9, comments: 9, shares: 9 } },
      res
    );
    expect(tx.commit).toHaveBeenCalled();
    expect(tx.rollback).toHaveBeenCalled(); // finally forced rollback
  });

  it("transaction undefined: finally `if (transaction)` falsy branch fires (line 85 false side)", async () => {
    // db.sequelize.transaction() resolves to undefined → finally's
    // `if (transaction)` falsy side runs (no inner rollback attempt).
    // The catch above still tries `await transaction.rollback()` which
    // throws TypeError; that throw escapes after the finally completes,
    // so svc.update() rejects.
    transactionSpy.mockResolvedValueOnce(undefined);
    searchDocSpy.mockResolvedValueOnce({
      sql_id: 5, likes: 1, comments: 1, shares: 1,
      clicks_graph: [], ctr: 0,
    });
    const res = mockRes();
    await expect(
      svc.update({ body: { id: "5", likes: 9, comments: 9, shares: 9 } }, res)
    ).rejects.toThrow(/rollback/);
  });

  it("finally block: logs when forced rollback itself throws", async () => {
    const tx = {
      commit: vi.fn(async () => {}),
      rollback: vi.fn(async () => { throw new Error("rb-fail"); }),
      finished: undefined,
    };
    transactionSpy.mockResolvedValueOnce(tx);
    searchDocSpy.mockResolvedValueOnce({
      sql_id: 5, likes: 1, comments: 1, shares: 1,
      clicks_graph: [], ctr: 0,
    });
    createSpy.mockResolvedValueOnce({});
    updateDocSpy.mockResolvedValueOnce({});
    const res = mockRes();
    await svc.update(
      { body: { id: "5", likes: 9, comments: 9, shares: 9 } },
      res
    );
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      "Error releasing transaction connection",
      expect.any(Error)
    );
  });
});

describe("core/lcs/lcs.service > getLCS", () => {
  it("returns 'Missing id field' when id is undefined", async () => {
    const res = mockRes();
    await svc.getLCS({ params: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Missing id field");
  });

  it("returns 'No ad found with ad_id' when no rows", async () => {
    findAllSpy.mockResolvedValueOnce([]);
    const res = mockRes();
    await svc.getLCS({ params: { id: "5" } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("No ad found with ad_id");
  });

  it("returns transformed rows on success", async () => {
    findAllSpy.mockResolvedValueOnce([
      { likes: 1, comments: 2, shares: 3, createdAt: "2025-01-01" },
      { likes: 4, comments: 5, shares: 6, createdAt: "2025-01-02" },
    ]);
    const res = mockRes();
    await svc.getLCS({ params: { id: "5" } }, res);
    const payload = res.send.mock.calls[0][0];
    expect(payload.body.message).toBe("LCS fetched successfully");
    expect(payload.body.data).toEqual([
      { likes: 1, comments: 2, shares: 3, date: "2025-01-01" },
      { likes: 4, comments: 5, shares: 6, date: "2025-01-02" },
    ]);
  });

  it("catches DB error and returns 'Error fetching LCS'", async () => {
    findAllSpy.mockRejectedValueOnce(new Error("db-down"));
    const res = mockRes();
    await svc.getLCS({ params: { id: "5" } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Error fetching LCS");
  });
});
