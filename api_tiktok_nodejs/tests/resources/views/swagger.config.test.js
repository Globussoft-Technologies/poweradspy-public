import { describe, it, expect, vi } from "vitest";

// Capture the swagger-autogen factory's returned function so we can
// assert what arguments the SUT passed it at module load.
const { swaggerSpy, swaggerFactory } = vi.hoisted(() => {
  const swaggerSpy = vi.fn(async () => undefined);
  const swaggerFactory = vi.fn(() => swaggerSpy);
  return { swaggerSpy, swaggerFactory };
});

vi.mock("swagger-autogen", () => ({ default: swaggerFactory }));

vi.mock("config", () => ({
  default: {
    get: (key) => {
      if (key === "swagger_host_url") return "swagger.test.local";
      throw new Error(`unstubbed: ${key}`);
    },
  },
}));

// Top-level await + side-effect-only module → just import to exercise.
await import("../../../resources/views/swagger.config.js");

describe("resources/views/swagger.config > module load", () => {
  it("calls swagger-autogen factory exactly once at import", () => {
    expect(swaggerFactory).toHaveBeenCalledTimes(1);
  });

  it("invokes the returned swagger function with the expected output path, endpoint list, and doc shape", () => {
    expect(swaggerSpy).toHaveBeenCalledTimes(1);
    const [outputFile, endpointsFiles, doc] = swaggerSpy.mock.calls[0];

    expect(outputFile).toBe("./resources/views/swagger-api-view.json");
    expect(endpointsFiles).toEqual(["./resources/routes/public.routes.js"]);
    expect(doc).toMatchObject({
      info: {
        version: "1.0",
        title: "TikTok APIs",
        description: "Tiktok API Documentation",
      },
      host: "swagger.test.local",
      basePath: "/",
      schemes: ["http", "https"],
      consumes: ["application/json", "application/x-www-form-urlencoded"],
      produces: ["application/json"],
      security: [{ BearerAuth: [] }],
    });
  });

  it("populates a definitions block with at least the Create + Variants_Create types", () => {
    const doc = swaggerSpy.mock.calls[0][2];
    expect(doc.definitions).toBeDefined();
    expect(typeof doc.definitions).toBe("object");
    expect(Object.keys(doc.definitions).length).toBeGreaterThan(0);
  });
});
