import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "domain-date-es-queue-"));

const configPath = require.resolve("../../../src/config");
require.cache[configPath] = {
  id: configPath,
  filename: configPath,
  loaded: true,
  exports: {
    localCache: { dir: tempRoot },
    domainDateUpdate: {
      esTermsChunkSize: 10000,
      esRequestsPerSecond: 250,
      esRequestTimeoutMs: 10000,
      esTaskPollIntervalMs: 1,
      esQueueSweepIntervalMs: 5000,
      esQueueMaxPendingJobs: 2,
      esQueueMaxSizeMb: 1,
      esQueueMinFreeDiskMb: 1,
      esQueueMaxAttempts: 2,
    },
  },
};

const childLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const loggerPath = require.resolve("../../../src/logger");
require.cache[loggerPath] = {
  id: loggerPath,
  filename: loggerPath,
  loaded: true,
  exports: { createChild: vi.fn(() => childLog) },
};

const serviceRegistry = { getService: vi.fn() };
const registryPath = require.resolve("../../../src/services/ServiceRegistry");
require.cache[registryPath] = {
  id: registryPath,
  filename: registryPath,
  loaded: true,
  exports: serviceRegistry,
};

const {
  enqueueDomainDateEsUpdate,
  sweepDomainDateEsQueue,
  PENDING_DIR,
  ES_TERMS_CHUNK,
  ES_REQUESTS_PER_SECOND,
  ES_QUEUE_MAX_PENDING_JOBS,
  ES_QUEUE_MAX_ATTEMPTS,
} = require("../../../src/services/common/helpers/domainDateEsQueue");

function clearQueue() {
  if (!fs.existsSync(PENDING_DIR)) return;
  for (const entry of fs.readdirSync(PENDING_DIR)) {
    fs.rmSync(path.join(PENDING_DIR, entry), { recursive: true, force: true });
  }
}

function mockService({ lockAcquired = true, network = "google", current = true, esMajor = 6 } = {}) {
  const submittedSizes = new Map();
  const order = [];
  let taskNumber = 0;
  const updateByQuery = vi.fn(async (request, options) => {
    taskNumber += 1;
    const taskId = `node:${taskNumber}`;
    const ids = Object.values(request.body.query.terms)[0];
    submittedSizes.set(taskId, ids.length);
    order.push(`submit:${taskNumber}`);
    expect(options).toEqual({ requestTimeout: 10000, maxRetries: 0 });
    return { body: { task: taskId } };
  });
  const getTask = vi.fn(async ({ taskId }, options) => {
    order.push(`complete:${taskId.split(":")[1]}`);
    expect(options).toEqual({ requestTimeout: 10000, maxRetries: 0 });
    return {
      body: {
        completed: true,
        response: { updated: submittedSizes.get(taskId), noops: 0, version_conflicts: 0 },
      },
    };
  });
  const deleteTask = vi.fn(async (_request, options) => {
    expect(options).toEqual({ requestTimeout: 10000, maxRetries: 0 });
  });
  const sqlQuery = vi.fn(async (_statement, params) => {
    const totalRows = Math.max(0, params.length - 1);
    return [{ total_rows: totalRows, matching_rows: current ? totalRows : 0 }];
  });
  const connection = {
    execute: vi.fn(async (statement, params) => {
      if (statement.includes("GET_LOCK")) return [[{ acquired: lockAcquired ? 1 : 0 }], []];
      if (statement.includes("RELEASE_LOCK")) return [[{ released: 1 }], []];
      return [await sqlQuery(statement, params), []];
    }),
    release: vi.fn(),
  };
  const service = {
    db: {
      sql: { getConnection: vi.fn(async () => connection), query: sqlQuery },
      elastic: {
        indexName: `${network}_ads_data_v2`,
        esMajor,
        client: { updateByQuery, delete: deleteTask, tasks: { get: getTask } },
      },
    },
  };
  serviceRegistry.getService.mockReturnValue(service);
  return { service, updateByQuery, getTask, deleteTask, connection, sqlQuery, order };
}

function makePendingJobsDue() {
  for (const file of fs.readdirSync(PENDING_DIR).filter((name) => name.endsWith(".json"))) {
    const filePath = path.join(PENDING_DIR, file);
    const job = JSON.parse(fs.readFileSync(filePath, "utf8"));
    job.nextAttemptAt = 0;
    fs.writeFileSync(filePath, JSON.stringify(job));
  }
}

afterEach(() => {
  clearQueue();
  serviceRegistry.getService.mockReset();
  Object.values(childLog).forEach((fn) => fn.mockClear());
});

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("domainDateEsQueue", () => {
  it("persists a complete restart-safe job before returning", () => {
    const queued = enqueueDomainDateEsUpdate({
      network: "google",
      date: "2026-08-12",
      matchIds: ["a1", "a2"],
      domainRowIds: [7],
    });

    expect(queued.id).toBeTruthy();
    const files = fs.readdirSync(PENDING_DIR).filter((file) => file.endsWith(".json"));
    expect(files).toHaveLength(1);
    const job = JSON.parse(fs.readFileSync(path.join(PENDING_DIR, files[0]), "utf8"));
    expect(job).toMatchObject({
      id: queued.id,
      network: "google",
      date: "2026-08-12",
      matchIds: ["a1", "a2"],
      domainRowIds: [7],
      chunkIndex: 0,
      activeTaskId: null,
    });
  });

  it("reuses an equivalent pending job when the API request is retried", () => {
    const first = enqueueDomainDateEsUpdate({
      network: "google",
      date: "2026-08-12",
      matchIds: ["a1", "a2"],
      domainRowIds: [7, 8],
    });
    const retried = enqueueDomainDateEsUpdate({
      network: "google",
      date: "2026-08-12",
      matchIds: ["a2", "a1"],
      domainRowIds: [8, 7],
    });

    expect(retried).toMatchObject({ id: first.id, duplicate: true });
    expect(fs.readdirSync(PENDING_DIR).filter((file) => file.endsWith(".json"))).toHaveLength(1);
  });

  it("runs large chunks sequentially and throttles every ES task", async () => {
    const { updateByQuery, getTask, deleteTask, connection, order } = mockService();
    const matchIds = Array.from({ length: 15000 }, (_, index) => `ad-${index}`);
    enqueueDomainDateEsUpdate({
      network: "google",
      date: "2026-08-12",
      matchIds,
      domainRowIds: [7],
    });

    await sweepDomainDateEsQueue();

    expect(ES_TERMS_CHUNK).toBe(10000);
    expect(ES_REQUESTS_PER_SECOND).toBe(250);
    expect(updateByQuery).toHaveBeenCalledTimes(2);
    expect(getTask).toHaveBeenCalledTimes(2);
    expect(deleteTask).toHaveBeenCalledTimes(2);
    expect(deleteTask.mock.calls[0][0]).toMatchObject({
      index: ".tasks",
      type: "task",
      id: "node:1",
    });
    expect(order).toEqual(["submit:1", "complete:1", "submit:2", "complete:2"]);
    expect(updateByQuery.mock.calls.map(([request]) => Object.values(request.body.query.terms)[0].length))
      .toEqual([10000, 5000]);
    for (const [request] of updateByQuery.mock.calls) {
      expect(request).toMatchObject({
        index: "google_ads_data_v2",
        waitForCompletion: false,
        requestsPerSecond: 250,
        refresh: false,
        conflicts: "proceed",
      });
      expect(request.body.script.source).toContain("ctx.op = 'noop'");
    }
    expect(connection.execute.mock.calls[0][0]).toContain("GET_LOCK");
    expect(connection.execute.mock.calls.at(-1)[0]).toContain("RELEASE_LOCK");
    expect(fs.readdirSync(PENDING_DIR).filter((file) => file.endsWith(".json"))).toHaveLength(0);
  });

  it("leaves jobs queued when another process owns the network lock", async () => {
    const { updateByQuery, connection } = mockService({ lockAcquired: false });
    enqueueDomainDateEsUpdate({
      network: "google",
      date: "2026-08-12",
      matchIds: ["a1"],
      domainRowIds: [7],
    });

    await sweepDomainDateEsQueue();

    expect(updateByQuery).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalled();
    expect(fs.readdirSync(PENDING_DIR).filter((file) => file.endsWith(".json"))).toHaveLength(1);
  });

  it("retains the active task id after a transient poll failure", async () => {
    const { service, updateByQuery } = mockService();
    service.db.elastic.client.tasks.get = vi.fn(async () => {
      const error = new Error("task poll timed out");
      error.name = "TimeoutError";
      throw error;
    });
    enqueueDomainDateEsUpdate({
      network: "google",
      date: "2026-08-12",
      matchIds: ["a1"],
      domainRowIds: [7],
    });

    await sweepDomainDateEsQueue();

    expect(updateByQuery).toHaveBeenCalledTimes(1);
    const files = fs.readdirSync(PENDING_DIR).filter((file) => file.endsWith(".json"));
    const job = JSON.parse(fs.readFileSync(path.join(PENDING_DIR, files[0]), "utf8"));
    expect(job.activeTaskId).toBe("node:1");
    expect(job.attempts).toBe(1);
    expect(job.nextAttemptAt).toBeGreaterThan(Date.now());
  });

  it("continues discovering idle networks while another network task is running", async () => {
    const google = mockService({ network: "google" });
    const facebook = mockService({ network: "facebook" });
    let completeGoogle;
    google.service.db.elastic.client.tasks.get = vi.fn(() => new Promise((resolve) => {
      completeGoogle = () => resolve({
        body: { completed: true, response: { updated: 1, noops: 0, version_conflicts: 0 } },
      });
    }));
    serviceRegistry.getService.mockImplementation((network) => ({ google, facebook }[network].service));

    enqueueDomainDateEsUpdate({
      network: "google",
      date: "2026-08-12",
      matchIds: ["g1"],
      domainRowIds: [7],
    });
    const googleSweep = sweepDomainDateEsQueue();
    await vi.waitFor(() => expect(google.updateByQuery).toHaveBeenCalledTimes(1));

    enqueueDomainDateEsUpdate({
      network: "facebook",
      date: "2026-08-12",
      matchIds: ["f1"],
      domainRowIds: [8],
    });
    await sweepDomainDateEsQueue();

    expect(facebook.updateByQuery).toHaveBeenCalledTimes(1);
    completeGoogle();
    await googleSweep;
  });

  it("fails closed when SQL cannot provide the distributed lock", async () => {
    const { service, updateByQuery } = mockService();
    service.db.sql = null;
    serviceRegistry.getService.mockReturnValue(service);
    enqueueDomainDateEsUpdate({
      network: "google",
      date: "2026-08-12",
      matchIds: ["a1"],
      domainRowIds: [7],
    });

    await sweepDomainDateEsQueue();

    expect(updateByQuery).not.toHaveBeenCalled();
    expect(fs.readdirSync(PENDING_DIR).filter((file) => file.endsWith(".json"))).toHaveLength(1);
    expect(childLog.warn).toHaveBeenCalledWith(
      "domain date ES lock unavailable",
      expect.objectContaining({ network: "google" })
    );
  });

  it("increases retries, cleans completed failures, and dead-letters at the limit", async () => {
    const { service, updateByQuery, deleteTask } = mockService();
    service.db.elastic.client.tasks.get = vi.fn(async () => ({
      body: { completed: true, error: { type: "script_exception", reason: "bad mapping" } },
    }));
    enqueueDomainDateEsUpdate({
      network: "google",
      date: "2026-08-12",
      matchIds: ["a1"],
      domainRowIds: [7],
    });

    await sweepDomainDateEsQueue();
    let pendingFile = fs.readdirSync(PENDING_DIR).find((file) => file.endsWith(".json"));
    let job = JSON.parse(fs.readFileSync(path.join(PENDING_DIR, pendingFile), "utf8"));
    expect(job.attempts).toBe(1);
    expect(deleteTask).toHaveBeenCalledTimes(1);

    makePendingJobsDue();
    await sweepDomainDateEsQueue();

    expect(ES_QUEUE_MAX_ATTEMPTS).toBe(2);
    expect(updateByQuery).toHaveBeenCalledTimes(2);
    expect(deleteTask).toHaveBeenCalledTimes(2);
    expect(fs.readdirSync(PENDING_DIR).filter((file) => file.endsWith(".json"))).toHaveLength(0);
    const failedFiles = fs.readdirSync(path.join(PENDING_DIR, "failed"));
    expect(failedFiles).toHaveLength(1);
    job = JSON.parse(fs.readFileSync(path.join(PENDING_DIR, "failed", failedFiles[0]), "utf8"));
    expect(job).toMatchObject({ attempts: 2, activeTaskId: null });
  });

  it.each([
    ["timeout", { updated: 1, noops: 0, timed_out: true, version_conflicts: 0 }],
    ["version conflict", { updated: 0, noops: 0, timed_out: false, version_conflicts: 1 }],
    ["malformed response", { noops: 0, timed_out: false, version_conflicts: 0 }],
  ])("retries a completed task with a partial %s result", async (_label, partialResult) => {
    const { service, updateByQuery, deleteTask } = mockService();
    let pollCount = 0;
    service.db.elastic.client.tasks.get = vi.fn(async () => {
      pollCount += 1;
      return {
        body: {
          completed: true,
          response: pollCount === 1
            ? partialResult
            : { updated: 1, noops: 0, timed_out: false, version_conflicts: 0 },
        },
      };
    });
    enqueueDomainDateEsUpdate({
      network: "google",
      date: "2026-08-12",
      matchIds: ["a1"],
      domainRowIds: [7],
    });

    await sweepDomainDateEsQueue();
    let pendingFile = fs.readdirSync(PENDING_DIR).find((file) => file.endsWith(".json"));
    let job = JSON.parse(fs.readFileSync(path.join(PENDING_DIR, pendingFile), "utf8"));
    expect(job).toMatchObject({ attempts: 1, activeTaskId: null, chunkIndex: 0 });

    makePendingJobsDue();
    await sweepDomainDateEsQueue();

    expect(updateByQuery).toHaveBeenCalledTimes(2);
    expect(deleteTask).toHaveBeenCalledTimes(2);
    expect(fs.readdirSync(PENDING_DIR).filter((file) => file.endsWith(".json"))).toHaveLength(0);
  });

  it("drops a stale job before it can overwrite a newer SQL date", async () => {
    const { updateByQuery, sqlQuery, connection } = mockService({ current: false });
    enqueueDomainDateEsUpdate({
      network: "google",
      date: "2026-08-11",
      matchIds: ["a1"],
      domainRowIds: [7],
    });

    await sweepDomainDateEsQueue();

    expect(sqlQuery).toHaveBeenCalled();
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining("SELECT COUNT(*) AS total_rows"),
      ["2026-08-11", 7]
    );
    expect(updateByQuery).not.toHaveBeenCalled();
    expect(fs.readdirSync(PENDING_DIR).filter((file) => file.endsWith(".json"))).toHaveLength(0);
    expect(childLog.info).toHaveBeenCalledWith(
      "domain date ES queue job superseded",
      expect.objectContaining({ network: "google", date: "2026-08-11" })
    );
  });

  it("uses typeless task cleanup for an ES 8 adapter", async () => {
    const { deleteTask } = mockService({ esMajor: 8 });
    enqueueDomainDateEsUpdate({
      network: "google",
      date: "2026-08-12",
      matchIds: ["a1"],
      domainRowIds: [7],
    });

    await sweepDomainDateEsQueue();

    expect(deleteTask.mock.calls[0][0]).toEqual({ index: ".tasks", id: "node:1" });
  });

  it("rejects new jobs after the configured pending queue limit", () => {
    expect(ES_QUEUE_MAX_PENDING_JOBS).toBe(2);
    for (const id of [1, 2]) {
      expect(enqueueDomainDateEsUpdate({
        network: "google",
        date: "2026-08-12",
        matchIds: [`a${id}`],
        domainRowIds: [id],
      })).not.toBeNull();
    }

    expect(enqueueDomainDateEsUpdate({
      network: "google",
      date: "2026-08-12",
      matchIds: ["a3"],
      domainRowIds: [3],
    })).toBeNull();
    expect(childLog.error).toHaveBeenCalledWith(
      "domain date ES enqueue rejected: pending job limit reached",
      expect.objectContaining({ max_pending_jobs: 2 })
    );
  });

  it("rejects a job that would exceed the configured queue size", () => {
    const queued = enqueueDomainDateEsUpdate({
      network: "google",
      date: "2026-08-12",
      matchIds: ["x".repeat(1024 * 1024)],
      domainRowIds: [7],
    });

    expect(queued).toBeNull();
    expect(childLog.error).toHaveBeenCalledWith(
      "domain date ES enqueue rejected: queue size limit reached",
      expect.objectContaining({ network: "google" })
    );
  });

  it("preserves the configured free-disk reserve", () => {
    const statfs = vi.spyOn(fs, "statfsSync").mockReturnValue({ bavail: 1, bsize: 1024 });
    try {
      expect(enqueueDomainDateEsUpdate({
        network: "google",
        date: "2026-08-12",
        matchIds: ["a1"],
        domainRowIds: [7],
      })).toBeNull();
      expect(childLog.error).toHaveBeenCalledWith(
        "domain date ES enqueue rejected: insufficient free disk",
        expect.objectContaining({ network: "google" })
      );
    } finally {
      statfs.mockRestore();
    }
  });
});
