import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const updateDomainDate = vi.fn();
const servicePath = require.resolve("../../../src/services/common/services/updateDomainDateService");
require.cache[servicePath] = {
  id: servicePath,
  filename: servicePath,
  loaded: true,
  exports: { updateDomainDate },
};

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const loggerPath = require.resolve("../../../src/logger");
require.cache[loggerPath] = {
  id: loggerPath,
  filename: loggerPath,
  loaded: true,
  exports: { createChild: vi.fn(() => log) },
};

const { putDomainDate } = require("../../../src/services/common/controllers/updateDomainDateController");

function mockResponse() {
  const res = { set: vi.fn(), status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

afterEach(() => {
  updateDomainDate.mockReset();
  Object.values(log).forEach((fn) => fn.mockClear());
});

describe("updateDomainDateController", () => {
  it("sets Retry-After when durable ES queue admission fails", async () => {
    const result = {
      code: 503,
      error: {
        type: "elasticsearch_queue_error",
        details: { retry_after_seconds: 5 },
      },
    };
    updateDomainDate.mockResolvedValue(result);
    const res = mockResponse();

    await putDomainDate({ body: { domain_name: "x.com", domain_date: "2026-08-12" } }, res);

    expect(res.set).toHaveBeenCalledWith("Retry-After", "5");
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(result);
  });

  it("does not add Retry-After to an accepted queued update", async () => {
    const result = { code: 200, data: { summary: { es_queued_networks: 1 } } };
    updateDomainDate.mockResolvedValue(result);
    const res = mockResponse();

    await putDomainDate({ body: { domain_name: "x.com", domain_date: "2026-08-12" } }, res);

    expect(res.set).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
