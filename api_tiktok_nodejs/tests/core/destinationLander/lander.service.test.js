import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  updateSpy, transactionSpy, commitSpy, rollbackSpy,
  updateDocSpy, getAdsLanderSpy, searchDocSpy,
  loggerInfoSpy, loggerErrorSpy,
} = vi.hoisted(() => ({
  updateSpy: vi.fn(),
  transactionSpy: vi.fn(),
  commitSpy: vi.fn(),
  rollbackSpy: vi.fn(),
  updateDocSpy: vi.fn(),
  getAdsLanderSpy: vi.fn(),
  searchDocSpy: vi.fn(),
  loggerInfoSpy: vi.fn(),
  loggerErrorSpy: vi.fn(),
}));

vi.mock("../../../Sequelize_cli/models/index.js", () => ({
  default: {
    tiktok_ad_html_lander: { update: updateSpy },
    sequelize: { transaction: transactionSpy },
  },
}));

vi.mock("../../../utils/elasticSearch.js", () => ({
  updateDocument: updateDocSpy,
  getAdsLander: getAdsLanderSpy,
  searchDoc: searchDocSpy,
}));

vi.mock("../../../resources/logs/logger.log.js", () => ({
  default: { info: loggerInfoSpy, error: loggerErrorSpy, warn: vi.fn() },
}));

let svc;
beforeEach(async () => {
  vi.resetModules();
  for (const s of [
    updateSpy, transactionSpy, commitSpy, rollbackSpy,
    updateDocSpy, getAdsLanderSpy, searchDocSpy, loggerInfoSpy, loggerErrorSpy,
  ]) s.mockReset();
  const tx = { commit: commitSpy, rollback: rollbackSpy, finished: undefined };
  transactionSpy.mockResolvedValue(tx);
  commitSpy.mockImplementation(async () => { tx.finished = "commit"; });
  rollbackSpy.mockImplementation(async () => { tx.finished = "rollback"; });
  ({ default: svc } = await import(
    "../../../core/destinationLander/lander.service.js"
  ));
});

function mockRes() {
  const res = {};
  res.send = vi.fn(() => res);
  return res;
}

describe("destinationLander/lander.service > getAdwithCountryCode", () => {
  it("returns 'No urls found' when getAdsLander returns empty array", async () => {
    getAdsLanderSpy.mockResolvedValueOnce([]);
    const res = mockRes();
    await svc.getAdwithCountryCode({}, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("No urls found");
  });

  it("updates ES + SQL for each ad and commits on success", async () => {
    getAdsLanderSpy.mockResolvedValueOnce([
      { ad_id: 1 }, { ad_id: 2 },
    ]);
    updateDocSpy.mockResolvedValue({});
    updateSpy.mockResolvedValue([1]);
    const res = mockRes();
    await svc.getAdwithCountryCode({}, res);
    expect(updateDocSpy).toHaveBeenCalledTimes(2);
    expect(updateSpy).toHaveBeenCalledTimes(2);
    expect(commitSpy).toHaveBeenCalled();
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Fetched urls successfully"
    );
  });

  it("rolls back and returns 'Error fetching ads' when getAdsLander rejects", async () => {
    getAdsLanderSpy.mockRejectedValueOnce(new Error("es-down"));
    const res = mockRes();
    await svc.getAdwithCountryCode({}, res);
    expect(rollbackSpy).toHaveBeenCalled();
    expect(res.send.mock.calls[0][0].body.message).toBe("Error fetching ads");
  });

  it("finally block forces rollback when finished is neither commit nor rollback", async () => {
    const tx = {
      commit: vi.fn(async () => {}),
      rollback: vi.fn(async () => {}),
      finished: undefined,
    };
    transactionSpy.mockResolvedValueOnce(tx);
    getAdsLanderSpy.mockResolvedValueOnce([{ ad_id: 1 }]);
    updateDocSpy.mockResolvedValue({});
    updateSpy.mockResolvedValue([1]);
    const res = mockRes();
    await svc.getAdwithCountryCode({}, res);
    expect(tx.commit).toHaveBeenCalled();
    expect(tx.rollback).toHaveBeenCalled();
  });

  it("finally block logs when forced rollback itself throws", async () => {
    const tx = {
      commit: vi.fn(async () => {}),
      rollback: vi.fn(async () => { throw new Error("rb-fail"); }),
      finished: undefined,
    };
    transactionSpy.mockResolvedValueOnce(tx);
    getAdsLanderSpy.mockResolvedValueOnce([{ ad_id: 1 }]);
    updateDocSpy.mockResolvedValue({});
    updateSpy.mockResolvedValue([1]);
    const res = mockRes();
    await svc.getAdwithCountryCode({}, res);
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      "Error releasing transaction connection",
      expect.any(Error)
    );
  });

  it("transaction undefined: finally `if (transaction)` falsy branch fires (line 48)", async () => {
    transactionSpy.mockResolvedValueOnce(undefined);
    getAdsLanderSpy.mockResolvedValueOnce([{ ad_id: 1 }]);
    updateDocSpy.mockResolvedValue({});
    updateSpy.mockResolvedValue([1]);
    const res = mockRes();
    await expect(svc.getAdwithCountryCode({}, res)).rejects.toThrow();
  });
});

describe("destinationLander/lander.service > uploadFileToServer", () => {
  it("returns success with parsed file names", async () => {
    const res = mockRes();
    await svc.uploadFileToServer(
      {
        files: {
          "image.png": [{ location: "https://s3/a/b/img.png" }],
          "file.zip": [{ location: "https://s3/a/b/file.zip" }],
        },
      },
      res
    );
    expect(res.send.mock.calls[0][0].body.data).toEqual({
      imageUrl: "img.png",
      zipUrl: "file.zip",
    });
  });

  it("returns 'Error uploading files' when req.files is missing", async () => {
    const res = mockRes();
    await svc.uploadFileToServer({}, res);
    expect(loggerErrorSpy).toHaveBeenCalled();
    expect(res.send.mock.calls[0][0].body.message).toBe("Error uploading files");
  });
});

describe("destinationLander/lander.service > insertLanderContent", () => {
  it("returns 'Missing request data in body' when body is undefined", async () => {
    const res = mockRes();
    await svc.insertLanderContent({}, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Missing request data in body"
    );
  });

  it("returns 'No ad found with that ad_id' when searchDoc returns falsy", async () => {
    searchDocSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.insertLanderContent({ body: { ad_id: "x" } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "No ad found with that ad_id"
    );
  });

  it("updates SQL + ES and commits on success", async () => {
    searchDocSpy.mockResolvedValueOnce({ sql_id: 5 });
    updateSpy.mockResolvedValueOnce([1]);
    updateDocSpy.mockResolvedValueOnce({});
    const res = mockRes();
    await svc.insertLanderContent(
      { body: { ad_id: 5, status: 1 } },
      res
    );
    expect(updateSpy).toHaveBeenCalled();
    expect(updateDocSpy).toHaveBeenCalled();
    expect(commitSpy).toHaveBeenCalled();
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Lander data inserted successfully"
    );
  });

  it("rolls back and returns 'Error inserting lander data' when update fails", async () => {
    searchDocSpy.mockResolvedValueOnce({ sql_id: 5 });
    updateSpy.mockRejectedValueOnce(new Error("db-down"));
    const res = mockRes();
    await svc.insertLanderContent({ body: { ad_id: 5 } }, res);
    expect(rollbackSpy).toHaveBeenCalled();
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Error inserting lander data"
    );
  });

  it("finally block forces rollback when finished is undefined", async () => {
    const tx = {
      commit: vi.fn(async () => {}),
      rollback: vi.fn(async () => {}),
      finished: undefined,
    };
    transactionSpy.mockResolvedValueOnce(tx);
    searchDocSpy.mockResolvedValueOnce({ sql_id: 5 });
    updateSpy.mockResolvedValueOnce([1]);
    updateDocSpy.mockResolvedValueOnce({});
    const res = mockRes();
    await svc.insertLanderContent({ body: { ad_id: 5 } }, res);
    expect(tx.rollback).toHaveBeenCalled();
  });

  it("finally block logs when forced rollback itself throws", async () => {
    const tx = {
      commit: vi.fn(async () => {}),
      rollback: vi.fn(async () => { throw new Error("rb-fail"); }),
      finished: undefined,
    };
    transactionSpy.mockResolvedValueOnce(tx);
    searchDocSpy.mockResolvedValueOnce({ sql_id: 5 });
    updateSpy.mockResolvedValueOnce([1]);
    updateDocSpy.mockResolvedValueOnce({});
    const res = mockRes();
    await svc.insertLanderContent({ body: { ad_id: 5 } }, res);
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      "Error releasing transaction connection",
      expect.any(Error)
    );
  });

  it("transaction undefined: finally `if (transaction)` falsy branch fires (line 119)", async () => {
    transactionSpy.mockResolvedValueOnce(undefined);
    searchDocSpy.mockResolvedValueOnce({ sql_id: 5 });
    updateSpy.mockResolvedValueOnce([1]);
    updateDocSpy.mockResolvedValueOnce({});
    const res = mockRes();
    await expect(svc.insertLanderContent({ body: { ad_id: 5 } }, res)).rejects.toThrow();
  });
});
