import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const searchAllNetworks = vi.fn();
const commonSearchPath = require.resolve("../../../../src/services/common/controllers/commonSearchController");
require.cache[commonSearchPath] = {
  id: commonSearchPath,
  filename: commonSearchPath,
  loaded: true,
  exports: { searchAllNetworks },
};

const { getAiQuickFilterAvailability } = require(
  "../../../../src/services/common/controllers/aiQuickFilterAvailabilityController"
);

function mkRes() {
  const res = { statusCode: 200, body: null };
  res.status = vi.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((body) => {
    res.body = body;
    return res;
  });
  return res;
}

beforeEach(() => {
  searchAllNetworks.mockReset();
});

describe("aiQuickFilterAvailabilityController", () => {
  it("preserves user_id when probing a preset payload", async () => {
    searchAllNetworks.mockImplementation(async (req, res) => {
      expect(req.query).toEqual({});
      expect(req.body.user_id).toBe(42);
      expect(req.body.take).toBe(1);
      expect(req.body.page_size).toBe(1);
      expect(req.body.skip).toBe(0);
      res.status(200).json({
        code: 200,
        data: [{ id: 1 }],
        meta: { total: { facebook: 1 } },
      });
    });

    const req = {
      body: {
        user_id: 42,
        activePlatforms: ["facebook"],
        presets: [
          {
            id: "preset-1",
            payload: {
              network: ["facebook"],
              ad_type: ["ugc"],
            },
          },
        ],
      },
    };
    const res = mkRes();

    await getAiQuickFilterAvailability(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      code: 200,
      availability: { "preset-1": true },
      visiblePresetIds: ["preset-1"],
      totalPresets: 1,
    });
    expect(searchAllNetworks).toHaveBeenCalledTimes(1);
  });

  it("marks a preset unavailable when its live-search probe fails", async () => {
    searchAllNetworks.mockRejectedValueOnce(new Error("probe dependency failed"));

    const req = {
      body: {
        user_id: 42,
        presets: [{ id: "preset-1", payload: { network: ["facebook"] } }],
      },
    };
    const res = mkRes();

    await getAiQuickFilterAvailability(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      availability: { "preset-1": false },
      visiblePresetIds: [],
    });
  });
});
