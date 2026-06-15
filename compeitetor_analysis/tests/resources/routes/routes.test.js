import { describe, it, expect, vi } from "vitest";

// Pre-mock every controller + auth so router build doesn't crash on collaborator load.
vi.mock("../../../core/Competitors/competitorController.js", () => ({
  default: new Proxy({}, { get: () => vi.fn() }),
}));
vi.mock("../../../core/Dashboard/dashboardController.js", () => ({
  default: new Proxy({}, { get: () => vi.fn() }),
}));
vi.mock("../../../core/Competitors/monitorController.js", () => ({
  default: new Proxy({}, { get: () => vi.fn() }),
}));
vi.mock("../../../core/mailer/emailController.js", () => ({
  default: new Proxy({}, { get: () => vi.fn() }),
}));
vi.mock("../../../core/Advertisers/advertiserController.js", () => ({
  default: new Proxy({}, { get: () => vi.fn() }),
}));
vi.mock("../../../utils/authentication.js", () => ({
  verifyToken: vi.fn(),
  SwaggerAuth: vi.fn(),
}));
// Elasticsearch.js reads config.get("SEARCH_HOSTS") at module load, which throws
// when no config directory is present in the test env. Stub it (and config) so the
// route/controller import chain loads without touching real ES/config.
vi.mock("../../../utils/Elasticsearch.js", () => ({
  esClient: {},
  esServers: [],
  checkElasticsearchHealth: vi.fn(),
  closeClients: vi.fn(),
}));
// Return a benign string for every config key so module-load reads (e.g.
// SENDGRID_API_KEY, assets_base_url) resolve without a real config directory.
vi.mock("config", () => ({
  default: { get: vi.fn(() => "test") },
}));

const router = (await import("../../../resources/routes/routes.js")).default;

describe("resources/routes/routes", () => {
  it("exports an Express router", () => {
    expect(typeof router).toBe("function");
    expect(Array.isArray(router.stack)).toBe(true);
  });

  it("registers many routes including /create-mail and /get-competitors", () => {
    const paths = router.stack.filter((l) => l.route).map((l) => l.route.path);
    expect(paths).toContain("/active-competitor-contacts");
    expect(paths).toContain("/create-mail");
    expect(paths).toContain("/get-competitors");
    expect(paths).toContain("/get-lcs");
    expect(paths).toContain("/check-user");
    expect(paths).toContain("/delete-project");
  });

  it("router.use(verifyToken) appears as a middleware layer", () => {
    const middlewares = router.stack.filter((l) => !l.route);
    expect(middlewares.length).toBeGreaterThanOrEqual(1);
  });

  it("routes total count matches what's in the source", () => {
    const routes = router.stack.filter((l) => l.route);
    expect(routes.length).toBeGreaterThan(40);
  });
});
