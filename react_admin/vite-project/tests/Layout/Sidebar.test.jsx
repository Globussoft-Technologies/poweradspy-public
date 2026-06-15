import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";

const navigateMock = vi.fn();
let pathnameMock = "/adsgpt";

vi.mock("react-router-dom", () => ({
  Link: ({ to, children, ...rest }) => (
    <a data-testid={`link${to ? `-${to}` : ""}`} href={to || ""} {...rest}>
      {children}
    </a>
  ),
  useNavigate: () => navigateMock,
  useLocation: () => ({ pathname: pathnameMock }),
}));

vi.mock("react-icons/rx", () => ({
  RxCross1: ({ onClick, className }) => (
    <i data-testid="cross-ic" className={className} onClick={onClick} />
  ),
}));

vi.mock("../../src/assets/fbaccountdetails.png", () => ({ default: "fba.png" }));
vi.mock("../../src/assets/systeminfo.png", () => ({ default: "sys.png" }));

import AdminContext from "../../src/Context/Context.jsx";
import Sidebar from "../../src/Layout/Sidebar.jsx";

const renderWithCtx = (ctxOverrides = {}) => {
  const setsidebarOpen = vi.fn();
  const ctx = { sidebarOpen: true, setsidebarOpen, ...ctxOverrides };
  const utils = render(
    <AdminContext.Provider value={ctx}>
      <Sidebar />
    </AdminContext.Provider>,
  );
  return { ...utils, ctx };
};

beforeEach(() => {
  navigateMock.mockReset();
  pathnameMock = "/adsgpt";
  localStorage.clear();
  document.title = "";
  // Provide a favicon for the useEffect that mutates document.title
  let existingLink = document.querySelector("link[rel='icon']");
  if (!existingLink) {
    const link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
});

describe("Sidebar", () => {
  it("hidden when sidebarOpen=false", () => {
    const { container } = renderWithCtx({ sidebarOpen: false });
    expect(container.innerHTML).toBe("");
  });
  it("renders with PowerAdSpy logo when isOn=true (default)", () => {
    const { container } = renderWithCtx();
    expect(container.querySelector("img[alt='AdsGPT']").getAttribute("src"))
      .toMatch(/Change-Tagline/);
  });
  it("default state shows PowerAdSpy nav items (Crawler/Competitor/Daily Keywords/System Info)", () => {
    const { getByText } = renderWithCtx();
    expect(getByText("Crawler Insights")).toBeInTheDocument();
    expect(getByText("Competitors Details")).toBeInTheDocument();
    expect(getByText("Daily Keywords Details")).toBeInTheDocument();
    expect(getByText("System Info")).toBeInTheDocument();
  });
  it("toggle switch shows 'Switch to Adsgpt' when isOn=true", () => {
    const { getByText } = renderWithCtx();
    expect(getByText("Switch to Adsgpt")).toBeInTheDocument();
  });
  it("toggling switch flips state, navigates, stores in localStorage", () => {
    const { container, getByText } = renderWithCtx();
    const checkbox = container.querySelector("input[type='checkbox']");
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    expect(navigateMock).toHaveBeenCalledWith("/adsgpt");
    expect(localStorage.getItem("powerAdSpy")).toBe("false");
    expect(localStorage.getItem("lastPath")).toBe("/adsgpt");
    // Switch label updates
    expect(getByText("Switch to PowerAdSpy")).toBeInTheDocument();
  });
  it("isOn=false shows AdsGPT nav items (Generated Media / Interaction / Calculation)", () => {
    const { container, getByText } = renderWithCtx();
    fireEvent.click(container.querySelector("input[type='checkbox']"));
    expect(getByText("Generated Media")).toBeInTheDocument();
    expect(getByText("Interaction Data")).toBeInTheDocument();
    expect(getByText("Calculation Tool")).toBeInTheDocument();
  });
  it("toggling back to PowerAdSpy navigates to /pas/crawler-insights", () => {
    const { container } = renderWithCtx();
    const checkbox = container.querySelector("input[type='checkbox']");
    fireEvent.click(checkbox); // off → /adsgpt
    fireEvent.click(checkbox); // on → /pas/crawler-insights
    expect(navigateMock).toHaveBeenCalledWith("/pas/crawler-insights");
  });
  it("System Info nav link calls navigate('/pas/system-info')", () => {
    const { getByText } = renderWithCtx();
    fireEvent.click(getByText("System Info"));
    expect(navigateMock).toHaveBeenCalledWith("/pas/system-info");
  });
  it("close button (mobile) flips sidebarOpen", () => {
    const { getByTestId, ctx } = renderWithCtx({ sidebarOpen: true });
    fireEvent.click(getByTestId("cross-ic"));
    expect(ctx.setsidebarOpen).toHaveBeenCalledWith(false);
  });
  it("isOn=true sets document.title to 'Poweradspy Admin Panel'", () => {
    renderWithCtx();
    expect(document.title).toBe("Poweradspy Admin Panel");
  });
  it("isOn=false sets document.title to 'AdsGpt Admin Panel'", () => {
    const { container } = renderWithCtx();
    fireEvent.click(container.querySelector("input[type='checkbox']"));
    expect(document.title).toBe("AdsGpt Admin Panel");
  });
  it("no favicon element → no title change attempted (no crash)", () => {
    // Remove favicon link
    const link = document.querySelector("link[rel='icon']");
    if (link) link.remove();
    expect(() => renderWithCtx()).not.toThrow();
  });
  it("on mount: writes window.location.pathname to localStorage", () => {
    renderWithCtx();
    // Initial render writes the pathname to lastPath (via the useEffect)
    expect(localStorage.getItem("lastPath")).not.toBeNull();
  });
});
