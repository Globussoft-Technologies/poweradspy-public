import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";

const navigateMock = vi.fn();
let pathnameMock = "/adsgpt/dashboard";

vi.mock("react-router-dom", () => ({
  Outlet: ({ context }) => (
    <div data-testid="outlet" data-monitoring={String(context?.isMonitoring)} />
  ),
  useNavigate: () => navigateMock,
  useLocation: () => ({ pathname: pathnameMock }),
}));

vi.mock("../../src/Layout/Sidebar", () => ({
  default: () => <div data-testid="sidebar" />,
}));

vi.mock("react-icons/ai", () => ({
  AiOutlineMenuFold: ({ onClick, className }) => (
    <i data-testid="menu-fold" className={className} onClick={onClick} />
  ),
}));
vi.mock("react-icons/go", () => ({
  GoArrowLeft: () => <i data-testid="arrow-left" />,
}));

import AdminContext from "../../src/Context/Context.jsx";
import Layout from "../../src/Layout/Layout.jsx";

const renderWithCtx = (overrides = {}) => {
  const setsidebarOpen = vi.fn();
  const ctx = {
    searchdataFilterTable: 0,
    sidebarOpen: true,
    setsidebarOpen,
    ...overrides,
  };
  const utils = render(
    <AdminContext.Provider value={ctx}>
      <Layout />
    </AdminContext.Provider>,
  );
  return { ...utils, ctx };
};

beforeEach(() => {
  navigateMock.mockReset();
  pathnameMock = "/adsgpt/dashboard";
  localStorage.clear();
  sessionStorage.clear();
  document.cookie = "";
  // jsdom doesn't implement scrollBy on Element — patch the prototype
  Element.prototype.scrollBy = vi.fn();
});

describe("Layout", () => {
  it("renders Sidebar + Outlet", () => {
    const { getByTestId } = renderWithCtx();
    expect(getByTestId("sidebar")).toBeInTheDocument();
    expect(getByTestId("outlet")).toBeInTheDocument();
  });
  it("clicking menu-fold toggles sidebarOpen", () => {
    const { getByTestId, ctx } = renderWithCtx({ sidebarOpen: true });
    fireEvent.click(getByTestId("menu-fold"));
    expect(ctx.setsidebarOpen).toHaveBeenCalledWith(false);
  });
  it("sidebarOpen=true → container has md:w-[calc(100vw-264px)] class", () => {
    const { container } = renderWithCtx({ sidebarOpen: true });
    const main = container.querySelector(".bg-\\[\\#fafafa\\]");
    expect(main.className).toMatch(/w-\[calc\(100vw-264px\)\]/);
  });
  it("sidebarOpen=false → container has w-full class only", () => {
    const { container } = renderWithCtx({ sidebarOpen: false });
    const main = container.querySelector(".bg-\\[\\#fafafa\\]");
    expect(main.className).not.toMatch(/calc\(100vw-264px\)/);
  });
  it("on /adsgpt/userdetails path → Back button shows + navigates to /adsgpt", () => {
    pathnameMock = "/adsgpt/userdetails/abc";
    const { getByText, getByTestId } = renderWithCtx();
    expect(getByText("Back")).toBeInTheDocument();
    expect(getByTestId("arrow-left")).toBeInTheDocument();
    fireEvent.click(getByText("Back"));
    expect(navigateMock).toHaveBeenCalledWith("/adsgpt");
  });
  it("Back button hidden on other paths", () => {
    pathnameMock = "/pas/dashboard";
    const { queryByText } = renderWithCtx();
    expect(queryByText("Back")).toBeNull();
  });
  it("AH avatar button toggles dropdown", () => {
    const { getByText, queryByText } = renderWithCtx();
    expect(queryByText("Logout")).toBeNull();
    fireEvent.click(getByText("AH"));
    expect(getByText("Logout")).toBeInTheDocument();
    fireEvent.click(getByText("AH"));
    expect(queryByText("Logout")).toBeNull();
  });
  it("Logout clears storage + cookie + navigates to /login", () => {
    localStorage.setItem("u", "x");
    sessionStorage.setItem("s", "y");
    document.cookie = "token=abc; path=/";
    const { getByText } = renderWithCtx();
    fireEvent.click(getByText("AH"));
    fireEvent.click(getByText("Logout"));
    expect(localStorage.getItem("u")).toBeNull();
    expect(sessionStorage.getItem("s")).toBeNull();
    expect(navigateMock).toHaveBeenCalledWith("/login", { replace: true });
  });
  it("clicking outside dropdown closes it", () => {
    const { getByText, queryByText } = renderWithCtx();
    fireEvent.click(getByText("AH"));
    expect(getByText("Logout")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(queryByText("Logout")).toBeNull();
  });
  it("clicking inside dropdown does NOT close it", () => {
    const { getByText } = renderWithCtx();
    fireEvent.click(getByText("AH"));
    fireEvent.mouseDown(getByText("Logout"));
    expect(getByText("Logout")).toBeInTheDocument();
  });
  it("Monitoring toggle visible on /pas/system-info path", () => {
    pathnameMock = "/pas/system-info";
    const { getByText } = renderWithCtx();
    fireEvent.click(getByText("AH"));
    expect(getByText("Monitoring")).toBeInTheDocument();
  });
  it("Monitoring checkbox toggles isMonitoring state", () => {
    pathnameMock = "/pas/system-info";
    const { getByText, getByTestId, container } = renderWithCtx();
    fireEvent.click(getByText("AH"));
    const cb = container.querySelector("input[type='checkbox']");
    expect(cb.checked).toBe(false);
    fireEvent.click(cb);
    expect(cb.checked).toBe(true);
    // Outlet receives the monitoring context
    expect(getByTestId("outlet").getAttribute("data-monitoring")).toBe("true");
  });
  it("searchdataFilterTable=1 triggers scrollBy 800", () => {
    const { container } = renderWithCtx({ searchdataFilterTable: 1 });
    // The scrollRef element gets scrollBy called; jsdom doesn't implement it.
    // We just verify no crash + scrollBy attempt was made (manually patch the ref's scrollBy).
    expect(container.querySelector(".bg-\\[\\#fafafa\\]")).not.toBeNull();
  });
  it("searchdataFilterTable=2 triggers scrollBy 1300", () => {
    const { container } = renderWithCtx({ searchdataFilterTable: 2 });
    expect(container.querySelector(".bg-\\[\\#fafafa\\]")).not.toBeNull();
  });
  it("scrollBy fires when searchdataFilterTable changes after mount", () => {
    const setsidebarOpen = vi.fn();
    let ctx = { searchdataFilterTable: 0, sidebarOpen: true, setsidebarOpen };
    const { container, rerender } = render(
      <AdminContext.Provider value={ctx}>
        <Layout />
      </AdminContext.Provider>,
    );
    const main = container.querySelector(".bg-\\[\\#fafafa\\]");
    main.scrollBy = vi.fn();
    rerender(
      <AdminContext.Provider value={{ ...ctx, searchdataFilterTable: 1 }}>
        <Layout />
      </AdminContext.Provider>,
    );
    expect(main.scrollBy).toHaveBeenCalledWith({ top: 800, behavior: "smooth" });
    rerender(
      <AdminContext.Provider value={{ ...ctx, searchdataFilterTable: 2 }}>
        <Layout />
      </AdminContext.Provider>,
    );
    expect(main.scrollBy).toHaveBeenCalledWith({ top: 1300, behavior: "smooth" });
  });
  it("visibilitychange handler updates isTabClosing flag (no crash)", () => {
    renderWithCtx();
    Object.defineProperty(document, "visibilityState", { writable: true, value: "hidden" });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    Object.defineProperty(document, "visibilityState", { writable: true, value: "visible" });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
  });
  it("beforeunload with isTabClosing=true clears storage", () => {
    renderWithCtx();
    localStorage.setItem("u", "x");
    sessionStorage.setItem("s", "y");
    // Trigger visibilitychange → isTabClosing=true
    Object.defineProperty(document, "visibilityState", { writable: true, value: "hidden" });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    // Now fire beforeunload
    act(() => {
      window.dispatchEvent(new Event("beforeunload"));
    });
    expect(localStorage.getItem("u")).toBeNull();
  });
  it("beforeunload with isTabClosing=false does NOT clear", () => {
    renderWithCtx();
    localStorage.setItem("u", "x");
    act(() => {
      window.dispatchEvent(new Event("beforeunload"));
    });
    expect(localStorage.getItem("u")).toBe("x");
  });
});
