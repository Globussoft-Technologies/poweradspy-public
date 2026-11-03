import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Checks that the copyright blocklist guards POST /create and PUT /update in
// tiktok.service.js: a blocked ad is rejected before any transaction, ES lookup,
// upload or write. Everything the service talks to is mocked.

const { transactionSpy, commitSpy, rollbackSpy, searchDocSpy, indexExistsSpy, createIndexSpy, validateSpy, uploadFileSpy, langSpy } =
  vi.hoisted(() => ({
    transactionSpy: vi.fn(),
    commitSpy: vi.fn(),
    rollbackSpy: vi.fn(),
    searchDocSpy: vi.fn(),
    indexExistsSpy: vi.fn(),
    createIndexSpy: vi.fn(),
    validateSpy: vi.fn(),
    uploadFileSpy: vi.fn(),
    langSpy: vi.fn(),
  }));

vi.mock("sequelize", () => ({ Op: {} }));
vi.mock("config", () => ({ default: { get: vi.fn(), has: vi.fn(() => false) } }));
vi.mock("axios", () => ({ default: vi.fn() }));
vi.mock("../../../Sequelize_cli/models/index.js", () => ({
  default: { tiktok_ads: { findOne: vi.fn() }, sequelize: { transaction: transactionSpy } },
}));
vi.mock("../../../utils/elasticSearch.js", () => ({
  createIndex: createIndexSpy,
  indexExists: indexExistsSpy,
  updateDocument: vi.fn(),
  searchDoc: searchDocSpy,
  searchDocs: vi.fn(),
  deleteDoc: vi.fn(),
  insertData: vi.fn(),
  getAdsES: vi.fn(),
  getAllESAdId: vi.fn(),
}));
vi.mock("../../../resources/logs/logger.log.js", () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../../core/tiktok/tiktok.validate.js", () => ({
  default: { createDetails: validateSpy, updateDetails: validateSpy },
}));
vi.mock("../../../utils/fileUploading.js", () => ({ uploadFile: uploadFileSpy }));
vi.mock("../../../utils/epochConverter.js", () => ({ default: vi.fn(), daysRunning: vi.fn() }));
vi.mock("../../../utils/languageAPI.js", () => ({ default: langSpy }));

import svc from "../../../core/tiktok/tiktok.service.js";
import {
  Blocklist, buildSettings, _setForTests,
} from "../../../core/blocklist/blocklist.service.js";
import { buildSnapshot } from "../../../core/blocklist/blocklist.match.js";
import { STATUS } from "../../../core/blocklist/blocklist.constants.js";

const log = { info() {}, warn() {}, error() {} };

function install(rows, { status = STATUS.READY, raw = {} } = {}) {
  const config = buildSettings({ enabled: true, ...raw });
  const state = { status, snapshot: status === STATUS.UNAVAILABLE ? null : buildSnapshot(rows) };
  const attempts = { record: vi.fn(), queue: [], dropped: 0 };
  _setForTests(new Blocklist({ config, cache: { get: () => state, summary: () => ({}) }, attempts, log }));
  return attempts;
}

function mockRes() {
  const res = {};
  res.send = vi.fn(() => res);
  res.status = vi.fn(() => res);
  return res;
}

const rows = [{ id: 7, entry_type: "ad_id", value: "bad-1" }];

beforeEach(() => {
  for (const s of [transactionSpy, commitSpy, rollbackSpy, searchDocSpy, indexExistsSpy, createIndexSpy, validateSpy, uploadFileSpy, langSpy]) s.mockReset();
  transactionSpy.mockResolvedValue({ commit: commitSpy, rollback: rollbackSpy });
  validateSpy.mockReturnValue({ error: { details: [] } }); // stop right after the guard in the "allowed" cases
});
afterEach(() => _setForTests(null));

describe("tiktok.service > copyright blocklist guard", () => {
  it("create: a blocked ad is rejected before any transaction, ES lookup or write", async () => {
    const attempts = install(rows);
    const res = mockRes();
    await svc.create({ body: { ad_id: "bad-1", post_owner: "Anyone" } }, res);
    expect(res.send).toHaveBeenCalledTimes(1);
    expect(res.send.mock.calls[0][0]).toMatchObject({ statusCode: 422, body: { status: "failed" } });
    expect(transactionSpy).not.toHaveBeenCalled();
    expect(indexExistsSpy).not.toHaveBeenCalled();
    expect(searchDocSpy).not.toHaveBeenCalled();
    expect(uploadFileSpy).not.toHaveBeenCalled();
    expect(attempts.record).toHaveBeenCalledTimes(1);
    expect(attempts.record.mock.calls[0][0]).toMatchObject({ network: "tiktok", platform_ad_id: "bad-1", source: "insertion:tiktok:create" });
  });

  it("update: a blocked ad is rejected before any transaction or ES lookup", async () => {
    install(rows);
    const res = mockRes();
    await svc.update({ body: { ad_id: "bad-1" } }, res);
    expect(res.send.mock.calls[0][0]).toMatchObject({ statusCode: 422 });
    expect(transactionSpy).not.toHaveBeenCalled();
    expect(searchDocSpy).not.toHaveBeenCalled();
  });

  it("create: a clean ad goes on to the normal flow", async () => {
    install(rows);
    const res = mockRes();
    await svc.create({ body: { ad_id: "fine" } }, res);
    expect(transactionSpy).toHaveBeenCalledTimes(1);
    expect(res.send.mock.calls.every(([r]) => r?.statusCode !== 422)).toBe(true);
  });

  it("create: fail closed rejects with 503 when the list is unavailable", async () => {
    install([], { status: STATUS.UNAVAILABLE });
    const res = mockRes();
    await svc.create({ body: { ad_id: "x" } }, res);
    expect(res.send.mock.calls[0][0]).toMatchObject({ statusCode: 503 });
    expect(transactionSpy).not.toHaveBeenCalled();
  });

  it("is a no-op when the blocklist is not initialised (the default)", async () => {
    _setForTests(null);
    const res = mockRes();
    await svc.create({ body: { ad_id: "bad-1" } }, res);
    expect(transactionSpy).toHaveBeenCalledTimes(1);
  });

  it("does not crash on an empty body", async () => {
    install(rows);
    const res = mockRes();
    await expect(svc.create({}, res)).resolves.not.toThrow();
  });
});
