import { describe, it, expect, vi } from "vitest";

vi.mock("react-router-dom", () => {
  const Route = () => null;
  return {
    createBrowserRouter: vi.fn((children) => ({ __router: true, children })),
    createRoutesFromElements: vi.fn((tree) => ({ __routes: true, tree })),
    Navigate: () => null,
    Route,
  };
});

vi.mock("../../src/Layout/Layout", () => ({ default: () => null }));
vi.mock("../../src/pages/authentication/Login", () => ({ default: () => null }));
vi.mock("../../src/pages/user/FbAccountDetails", () => ({ default: () => null }));
vi.mock("../../src/components/Dashboard", () => ({ default: () => null }));
vi.mock("../../src/components/UserDetails", () => ({ default: () => null }));
vi.mock("../../src/components/GeneratedMedia", () => ({ default: () => null }));
vi.mock("../../src/components/Pas/Dashboard", () => ({ default: () => null }));
vi.mock("../../src/components/Pas/UserDetailsPas", () => ({ default: () => null }));
vi.mock("../../src/pages/authentication/LogOut", () => ({ default: () => null }));
vi.mock("../../src/pages/authentication/AuthCheck", () => ({ default: () => null }));
vi.mock("../../src/pages/user/CrawlerInsight", () => ({ default: () => null }));
vi.mock("../../src/components/Pas/CrawlerInsight/Facebook", () => ({ default: () => null }));
vi.mock("../../src/components/Pas/CrawlerInsight/GDN", () => ({ default: () => null }));
vi.mock("../../src/components/Pas/CrawlerInsight/Google", () => ({ default: () => null }));
vi.mock("../../src/components/Pas/CrawlerInsight/Insta", () => ({ default: () => null }));
vi.mock("../../src/components/Pas/CrawlerInsight/Linkedin", () => ({ default: () => null }));
vi.mock("../../src/components/Pas/CrawlerInsight/Native", () => ({ default: () => null }));
vi.mock("../../src/components/Pas/CrawlerInsight/Pinterest", () => ({ default: () => null }));
vi.mock("../../src/components/Pas/CrawlerInsight/Quora", () => ({ default: () => null }));
vi.mock("../../src/components/Pas/CrawlerInsight/Reddit", () => ({ default: () => null }));
vi.mock("../../src/components/Pas/CrawlerInsight/Tiktok", () => ({ default: () => null }));
vi.mock("../../src/components/Pas/CrawlerInsight/Youtube", () => ({ default: () => null }));
vi.mock("../../src/pages/user/SystemInfo", () => ({ default: () => null }));
vi.mock("../../src/components/Pas/CompetitorDetails", () => ({ default: () => null }));
vi.mock("../../src/components/Pas/DailyKeywordDetails", () => ({ default: () => null }));
vi.mock("../../src/components/Calculator", () => ({ default: () => null }));

describe("routes/index", () => {
  it("creates the browser router with the assembled route tree", async () => {
    const rrd = await import("react-router-dom");
    const { routes } = await import("../../src/routes/index.jsx");
    expect(rrd.createRoutesFromElements).toHaveBeenCalled();
    expect(rrd.createBrowserRouter).toHaveBeenCalled();
    expect(routes).toBeTruthy();
    expect(routes.__router).toBe(true);
  });
});
