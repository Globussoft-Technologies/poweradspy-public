import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

vi.mock("../../src/components/Pas/CopyrightClaims.jsx", () => ({ default: () => <div>REQUESTS PAGE</div> }));
vi.mock("../../src/components/Pas/TakedownMonitor.jsx", () => ({ default: () => <div>MONITORING PAGE</div> }));
const cookieSpy = vi.hoisted(() => ({ get: vi.fn(() => "jwt-token"), remove: vi.fn() }));
vi.mock("js-cookie", () => ({ default: cookieSpy }));

import CopyrightRequest from "../../src/components/Pas/CopyrightRequest.jsx";

// the same address the page uses: the .env setting when there is one (a developer's machine), else the default
const ADMIN_API = import.meta.env.VITE_ADMIN_PANEL_API || "http://localhost:4000/admin-panel";
const ROOT = `${ADMIN_API}/copyright-claims`;
const answer = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => ({ code: status, data }) });
const realLocation = window.location;
const assignSpy = vi.fn();

/** summary and overview answers; either can be a response or a function that throws */
function backend({ summary, overview = () => answer(200, { totals: { items: { failed: 0 } } }) }) {
  const calls = [];
  global.fetch = vi.fn(async (url, opts = {}) => {
    const key = String(url).replace(ROOT, "");
    calls.push({ key, opts });
    const make = key === "/summary" ? summary : key === "/monitor/overview" ? overview : null;
    if (!make) throw new Error(`unexpected call: ${key}`);
    return make();
  });
  return calls;
}

beforeEach(() => {
  cookieSpy.get.mockReturnValue("jwt-token");
  cookieSpy.remove.mockReset();
  assignSpy.mockReset();
});
afterEach(() => { cleanup(); Object.defineProperty(window, "location", { configurable: true, writable: true, value: realLocation }); });

describe("CopyrightRequest > when the backend answers", () => {
  it("opens on the requests and shows the monitoring in its other tab; only the open tab is on screen; the tabs carry the numbers", async () => {
    const calls = backend({ summary: () => answer(200, { pending: 3 }), overview: () => answer(200, { totals: { items: { failed: 6 } } }) });
    render(<CopyrightRequest />);
    expect(await screen.findByText("REQUESTS PAGE")).toBeInTheDocument();
    expect(screen.queryByText("MONITORING PAGE")).toBeNull();
    expect(screen.getByRole("tab", { name: /Requests/ })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByTitle("Claims waiting for a decision")).toHaveTextContent("3");
    expect(screen.getByTitle("Delete steps that failed")).toHaveTextContent("6");
    expect(calls[0].opts.headers.Authorization).toBe("Bearer jwt-token");
    fireEvent.click(screen.getByRole("tab", { name: /Monitoring/ }));
    expect(screen.getByText("MONITORING PAGE")).toBeInTheDocument();
    expect(screen.queryByText("REQUESTS PAGE")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /Requests/ }));
    expect(screen.getByText("REQUESTS PAGE")).toBeInTheDocument();
  });

  it("shows no badge when nothing waits and nothing failed", async () => {
    backend({ summary: () => answer(200, { pending: 0 }) });
    render(<CopyrightRequest />);
    await screen.findByText("REQUESTS PAGE");
    expect(screen.queryByTitle("Claims waiting for a decision")).toBeNull();
    expect(screen.queryByTitle("Delete steps that failed")).toBeNull();
  });

  it("still opens when only the monitor numbers fail (the badge is left out)", async () => {
    backend({ summary: () => answer(200, { pending: 2 }), overview: () => { throw new Error("down"); } });
    render(<CopyrightRequest />);
    expect(await screen.findByText("REQUESTS PAGE")).toBeInTheDocument();
    expect(screen.getByTitle("Claims waiting for a decision")).toHaveTextContent("2");
    expect(screen.queryByTitle("Delete steps that failed")).toBeNull();
  });
});

describe("CopyrightRequest > when it cannot work, it says why and what to do", () => {
  it("the admin server cannot be reached: names the address, says what to start, and Retry asks again and then opens the tabs", async () => {
    let up = false;
    const calls = backend({ summary: () => { if (!up) throw new TypeError("Failed to fetch"); return answer(200, { pending: 1 }); } });
    render(<CopyrightRequest />);
    expect(await screen.findByText("The admin server cannot be reached")).toBeInTheDocument();
    expect(screen.getByText(ADMIN_API)).toBeInTheDocument();
    expect(screen.getByText(/admin_panel_backend/)).toBeInTheDocument();
    expect(screen.getByText(/VITE_ADMIN_PANEL_API/)).toBeInTheDocument();
    expect(screen.queryByText("REQUESTS PAGE")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
    up = true;
    fireEvent.click(screen.getByText("Retry"));
    expect(await screen.findByText("REQUESTS PAGE")).toBeInTheDocument();
    expect(calls.filter((c) => c.key === "/summary").length).toBe(2);
  });

  it("not set up on the server (503): lists the three settings by name (never a value)", async () => {
    backend({ summary: () => answer(503, null) });
    render(<CopyrightRequest />);
    expect(await screen.findByText("Copyright claims are not set up on the server yet")).toBeInTheDocument();
    for (const name of ["PAS_NODE_API_URL", "COPYRIGHT_CLAIMS_ADMIN_TOKEN", "COPYRIGHT_CLAIMS_REVIEWERS"]) expect(screen.getByText(new RegExp(name))).toBeInTheDocument();
    expect(screen.queryByText("REQUESTS PAGE")).toBeNull();
  });

  it("not a reviewer (403): says so, has no Retry, and is not sent to the login page", async () => {
    backend({ summary: () => answer(403, null) });
    Object.defineProperty(window, "location", { configurable: true, writable: true, value: { ...realLocation, assign: assignSpy } });
    render(<CopyrightRequest />);
    expect(await screen.findByText("You do not have access to copyright requests")).toBeInTheDocument();
    expect(screen.queryByText("Retry")).toBeNull();
    expect(cookieSpy.remove).not.toHaveBeenCalled();
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it("the claims service is down (502): says so", async () => {
    backend({ summary: () => answer(502, null) });
    render(<CopyrightRequest />);
    expect(await screen.findByText("The claims service is not answering")).toBeInTheDocument();
    expect(screen.getByText(/compliance\.claims\.enabled/)).toBeInTheDocument();
  });

  it("a 401 clears the login and sends the person to the login page; no login at all does the same without asking", async () => {
    Object.defineProperty(window, "location", { configurable: true, writable: true, value: { ...realLocation, assign: assignSpy } });
    backend({ summary: () => answer(401, null) });
    render(<CopyrightRequest />);
    await waitFor(() => expect(assignSpy).toHaveBeenCalledWith("/"));
    expect(cookieSpy.remove).toHaveBeenCalledWith("token");
    cleanup(); assignSpy.mockReset();
    cookieSpy.get.mockReturnValue(undefined);
    const calls = backend({ summary: () => answer(200, { pending: 0 }) });
    render(<CopyrightRequest />);
    await waitFor(() => expect(assignSpy).toHaveBeenCalledWith("/"));
    expect(calls.length).toBe(0);
  });
});
