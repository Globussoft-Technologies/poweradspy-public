import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { forkLogicalWorker, getLogicalWorkerId } = require("../src/clusterWorkerIdentity");

describe("clusterWorkerIdentity", () => {
  it("preserves worker 1 ownership through repeated replacements", () => {
    let clusterId = 0;
    const cluster = {
      fork: vi.fn((env) => ({
        id: ++clusterId,
        process: { pid: 1000 + clusterId },
        receivedEnv: env,
      })),
    };

    const initial = forkLogicalWorker(cluster, 1);
    const firstReplacement = forkLogicalWorker(cluster, getLogicalWorkerId(initial));
    const secondReplacement = forkLogicalWorker(cluster, getLogicalWorkerId(firstReplacement));

    expect([initial.id, firstReplacement.id, secondReplacement.id]).toEqual([1, 2, 3]);
    expect(getLogicalWorkerId(secondReplacement)).toBe("1");
    expect(cluster.fork.mock.calls.map(([env]) => env)).toEqual([
      { WORKER_ID: "1" },
      { WORKER_ID: "1" },
      { WORKER_ID: "1" },
    ]);
  });

  it("falls back to the cluster id for workers created before logical ids were tracked", () => {
    expect(getLogicalWorkerId({ id: 7 })).toBe("7");
  });
});
