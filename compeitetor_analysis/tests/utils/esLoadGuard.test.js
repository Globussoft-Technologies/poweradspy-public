import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  nodesInfo: vi.fn(),
  nodesStats: vi.fn(),
}));

vi.mock("../../utils/Elasticsearch.js", () => ({
  esClient: {
    server1: { nodes: { info: h.nodesInfo, stats: h.nodesStats } },
  },
}));

let mod;
async function load() {
  vi.resetModules();
  mod = await import("../../utils/esLoadGuard.js");
  return mod;
}

function statsWithNodes(nodesObj) {
  return { nodes: nodesObj };
}

beforeEach(() => {
  h.nodesInfo.mockReset();
  h.nodesStats.mockReset();
  h.nodesInfo.mockResolvedValue({ nodes: { n1: { thread_pool: { search: { size: 10 } } } } });
});

describe("esLoadGuard > isEsUnderStress", () => {
  it("single healthy node → not stressed", async () => {
    h.nodesStats.mockResolvedValue(statsWithNodes({
      n1: { thread_pool: { search: { active: 0, queue: 0, rejected: 0 } } },
    }));
    const { isEsUnderStress } = await load();
    expect(await isEsUnderStress("server1")).toBe(false);
  });

  it("pool busy (active >= 60% of size) → stressed", async () => {
    h.nodesStats.mockResolvedValue(statsWithNodes({
      n1: { thread_pool: { search: { active: 6, queue: 0, rejected: 0 } } }, // 6/10 = 60%
    }));
    const { isEsUnderStress } = await load();
    expect(await isEsUnderStress("server1")).toBe(true);
  });

  it("queue above threshold → stressed", async () => {
    h.nodesStats.mockResolvedValue(statsWithNodes({
      n1: { thread_pool: { search: { active: 0, queue: 6, rejected: 0 } } },
    }));
    const { isEsUnderStress } = await load();
    expect(await isEsUnderStress("server1")).toBe(true);
  });

  it("genuine new rejections on the SAME node across two calls → stressed on the second call", async () => {
    vi.useFakeTimers();
    try {
      const { isEsUnderStress } = await load();
      h.nodesStats.mockResolvedValueOnce(statsWithNodes({
        n1: { thread_pool: { search: { active: 0, queue: 0, rejected: 5 } } },
      }));
      expect(await isEsUnderStress("server1")).toBe(false); // cold start baseline, no false positive
      vi.advanceTimersByTime(1100); // clear the 1s cache
      h.nodesStats.mockResolvedValueOnce(statsWithNodes({
        n1: { thread_pool: { search: { active: 0, queue: 0, rejected: 9 } } }, // +4 real rejections
      }));
      expect(await isEsUnderStress("server1")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("REGRESSION (2026-08-21 bug): two nodes with different baseline `rejected` counts must NOT cross-contaminate into a false positive", async () => {
    // Mirrors the real production server1 (facebook+youtube) readings that
    // caused stressed-skip == candidates on 100% of batches: two genuinely
    // different, large, STATIC per-node rejected counts (2504 vs 18259).
    // Comparing node B's absolute count against node A's baseline (the old
    // per-SERVER-keyed bug) produces a huge spurious "new rejections" delta
    // every single check, forever. Keyed per-node, repeated checks against
    // the SAME unchanging stats must settle to "not stressed".
    vi.useFakeTimers();
    try {
      const { isEsUnderStress } = await load();
      const twoNodeStats = statsWithNodes({
        esNode2: { thread_pool: { search: { active: 0, queue: 0, rejected: 2504 } } },
        esNode:  { thread_pool: { search: { active: 0, queue: 0, rejected: 18259 } } },
      });
      h.nodesStats.mockResolvedValue(twoNodeStats);

      // First call establishes the per-node baselines (cold start, safe).
      expect(await isEsUnderStress("server1")).toBe(false);

      // Advance past the 1s cache and check again with the SAME unchanging
      // counts — a real cluster with no new rejections must read as healthy.
      vi.advanceTimersByTime(1100);
      expect(await isEsUnderStress("server1")).toBe(false);

      vi.advanceTimersByTime(1100);
      expect(await isEsUnderStress("server1")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("health-check failure fails OPEN (never blocks real work)", async () => {
    h.nodesStats.mockRejectedValue(new Error("es-down"));
    const { isEsUnderStress } = await load();
    expect(await isEsUnderStress("server1")).toBe(false);
  });

  it("unknown serverKey (no client mapped) → not stressed", async () => {
    const { isEsUnderStress } = await load();
    expect(await isEsUnderStress("server-does-not-exist")).toBe(false);
  });

  it("caches the verdict for ~1s — a second call within the window skips re-fetching stats", async () => {
    h.nodesStats.mockResolvedValue(statsWithNodes({
      n1: { thread_pool: { search: { active: 0, queue: 0, rejected: 0 } } },
    }));
    const { isEsUnderStress } = await load();
    await isEsUnderStress("server1");
    await isEsUnderStress("server1");
    expect(h.nodesStats).toHaveBeenCalledTimes(1);
  });
});

describe("esLoadGuard > withLimit", () => {
  it("runs immediately when under the concurrency cap", async () => {
    const { withLimit } = await load();
    const result = await withLimit("k", async () => "done", 2);
    expect(result).toBe("done");
  });

  it("queues callers beyond `max` until an earlier one releases", async () => {
    const { withLimit } = await load();
    let releaseFirst;
    const first = withLimit("k2", () => new Promise((r) => { releaseFirst = r; }), 1);
    let secondStarted = false;
    const second = withLimit("k2", async () => { secondStarted = true; return "second"; }, 1);

    await Promise.resolve(); await Promise.resolve();
    expect(secondStarted).toBe(false); // blocked — first still holds the only slot

    releaseFirst("first");
    expect(await first).toBe("first");
    expect(await second).toBe("second");
  });

  it("releases the slot even when the wrapped fn throws", async () => {
    const { withLimit } = await load();
    await expect(withLimit("k3", async () => { throw new Error("boom"); }, 1)).rejects.toThrow("boom");
    // slot must be free again — a fresh call proceeds immediately
    const result = await withLimit("k3", async () => "ok", 1);
    expect(result).toBe("ok");
  });
});
