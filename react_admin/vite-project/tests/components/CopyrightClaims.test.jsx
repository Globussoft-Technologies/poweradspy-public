import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";

vi.mock("react-toastify/dist/ReactToastify.css", () => ({}));
const toastSpy = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warn: vi.fn() }));
vi.mock("react-toastify", () => ({ ToastContainer: () => null, toast: toastSpy }));
const cookieSpy = vi.hoisted(() => ({ get: vi.fn(() => "jwt-token"), remove: vi.fn() }));
vi.mock("js-cookie", () => ({ default: cookieSpy }));

import CopyrightClaims from "../../src/components/Pas/CopyrightClaims.jsx";

// the same address the page uses: the .env setting when there is one (a developer's machine), else the default
const BASE = `${import.meta.env.VITE_ADMIN_PANEL_API || "http://localhost:4000/admin-panel"}/copyright-claims`;
const assignSpy = vi.fn();
const realLocation = window.location;
function spyOnLocation() {
  assignSpy.mockReset();
  Object.defineProperty(window, "location", { configurable: true, writable: true, value: { ...realLocation, assign: assignSpy } });
}
const ID = "11111111-1111-4111-8111-111111111111";
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, blob: async () => new Blob(["%PDF-data"]) });
const ok = (data) => reply(200, { code: 200, message: "ok", data });

const LIST_ITEM = { id: 5, complaintId: ID, reference: "CR-ABC234", name: "Example Advertiser", organization: "Example Company", status: "pending", receivedAt: "2026-11-03T10:00:00Z", decidedBy: null, decidedAt: null, processingStatus: "none" };
const claim = (over = {}) => ({
  complaintId: ID, reference: "CR-ABC234", name: "Example Advertiser", reason: "They copied our product photos",
  complainant: { name: "Jane Doe", email: "jane@example.com", organization: "Example Company" },
  evidenceUrl: "https://example.org/proof", sourceReference: null, status: "pending", receivedAt: "2026-11-03T10:00:00Z",
  decision: null, processingStatus: "none", processing: null, processedAt: null, ...over,
});
const FILES = [{ fileId: "22222222-2222-4222-8222-222222222222", name: "notice.pdf", kind: "document", mime: "application/pdf", size: 2048, scanStatus: "clean" }];

/** A fake backend: each handler is [regex on "METHOD path", () => response]. The calls are kept for the checks. */
function backend(handlers) {
  const calls = [];
  global.fetch = vi.fn(async (url, opts = {}) => {
    const key = `${opts.method || "GET"} ${String(url).replace(BASE, "") || "/"}`;
    calls.push({ key, opts });
    for (const [pattern, fn] of handlers) if (pattern.test(key)) return fn(opts);
    throw new Error(`unexpected call: ${key}`);
  });
  return calls;
}
const baseHandlers = (over = []) => [
  ...over,
  [/^GET \/summary/, () => ok({ pending: 3, oldestPendingAt: new Date(Date.now() - 5 * 3600000).toISOString(), failingProcessing: 1 })],
  [/^GET \?/, () => ok({ items: [LIST_ITEM], next: 5 })],
  [new RegExp(`^GET /${ID}$`), () => ok({ claim: claim(), files: FILES, filesError: null })],
];

beforeEach(() => {
  cookieSpy.get.mockReturnValue("jwt-token");
  Object.values(toastSpy).forEach((f) => f.mockReset());
  window.confirm = vi.fn(() => false);
  window.open = vi.fn();
});
afterEach(() => { cleanup(); Object.defineProperty(window, "location", { configurable: true, writable: true, value: realLocation }); });

describe("CopyrightClaims > the list", () => {
  it("shows what waits, the oldest waiting, and the claims, calling the backend with the admin login", async () => {
    const calls = backend(baseHandlers());
    render(<CopyrightClaims />);
    expect(await screen.findByText("Example Advertiser")).toBeInTheDocument();
    expect(screen.getByText("CR-ABC234 · Example Company · " + new Date("2026-11-03T10:00:00Z").toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }))).toBeInTheDocument();
    expect(await screen.findByText("3")).toBeInTheDocument(); // waiting
    expect(screen.getByText("5 h")).toBeInTheDocument();      // oldest waiting
    const list = calls.find((c) => c.key.startsWith("GET ?"));
    expect(list.key).toContain("status=pending");
    expect(list.opts.headers.Authorization).toBe("Bearer jwt-token");
  });

  it("a person who is not a reviewer sees that they have no access, and is not sent to the login page", async () => {
    backend([[/^GET \/summary/, () => reply(403, { code: 403, message: "no" })], [/^GET \?/, () => reply(403, { code: 403, message: "no" })]]);
    spyOnLocation();
    render(<CopyrightClaims />);
    expect(await screen.findByText(/do not have access to review copyright claims/i)).toBeInTheDocument();
    expect(cookieSpy.remove).not.toHaveBeenCalled();
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it("filters by status", async () => {
    const calls = backend(baseHandlers());
    render(<CopyrightClaims />);
    await screen.findByText("Example Advertiser");
    fireEvent.click(screen.getByRole("button", { name: "Accepted" }));
    await waitFor(() => expect(calls.some((c) => c.key.startsWith("GET ?") && c.key.includes("status=accepted"))).toBe(true));
  });

  it("says plainly when the claims cannot be loaded", async () => {
    backend([[/^GET \/summary/, () => ok({ pending: 0, oldestPendingAt: null, failingProcessing: 0 })], [/^GET \?/, () => reply(502, { code: 502, message: "The claims service is unavailable. Please try again." })]]);
    render(<CopyrightClaims />);
    expect(await screen.findByText("The claims service is unavailable. Please try again.")).toBeInTheDocument();
  });
});

describe("CopyrightClaims > one claim", () => {
  async function openClaim(extra = []) {
    const calls = backend(baseHandlers(extra));
    render(<CopyrightClaims />);
    fireEvent.click(await screen.findByText("Example Advertiser"));
    await screen.findByText("Jane Doe · Example Company");
    return calls;
  }

  it("shows the claimant, the reason, the files and the link as plain text (not a clickable link)", async () => {
    await openClaim();
    expect(screen.getByText("jane@example.com")).toBeInTheDocument();
    expect(screen.getByText("They copied our product photos")).toBeInTheDocument();
    expect(screen.getByText("notice.pdf")).toBeInTheDocument();
    const link = screen.getByText("https://example.org/proof");
    expect(link.closest("a")).toBeNull();
  });

  it("opens the claimant's link only after a confirmation", async () => {
    await openClaim();
    fireEvent.click(screen.getByRole("button", { name: /Open…/ }));
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(window.open).not.toHaveBeenCalled(); // the person said no
    window.confirm = vi.fn(() => true);
    fireEvent.click(screen.getByRole("button", { name: /Open…/ }));
    expect(window.open).toHaveBeenCalledWith("https://example.org/proof", "_blank", "noopener,noreferrer");
  });

  it("downloads a file through the login (an Authorization header), not through a plain link", async () => {
    URL.createObjectURL = vi.fn(() => "blob:fake");
    URL.revokeObjectURL = vi.fn();
    const calls = await openClaim([[/\/files\//, () => reply(200, null)]]);
    fireEvent.click(screen.getByRole("button", { name: /Download/ }));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    const call = calls.find((c) => c.key.includes("/files/"));
    expect(call.key).toBe(`GET /${ID}/files/${FILES[0].fileId}`);
    expect(call.opts.headers.Authorization).toBe("Bearer jwt-token");
  });

  it("does not let a file that is not scanned be downloaded", async () => {
    const calls = backend(baseHandlers([[new RegExp(`^GET /${ID}$`), () => ok({ claim: claim(), files: [{ ...FILES[0], scanStatus: "pending" }], filesError: null })]]));
    render(<CopyrightClaims />);
    fireEvent.click(await screen.findByText("Example Advertiser"));
    await screen.findByText("Jane Doe · Example Company");
    expect(screen.getByRole("button", { name: /Download/ })).toBeDisabled();
    expect(calls.some((c) => c.key.includes("/files/"))).toBe(false);
  });

  it("says 'unable to check' for a network that could not be searched, never 'no ads found'", async () => {
    await openClaim([[new RegExp(`^GET /${ID}/precheck$`), () => ok({ networks: [
      { network: "facebook", check: "found", owners: 2, ads: 120 },
      { network: "reddit", check: "unable_to_check", reason: "connect ETIMEDOUT" },
      { network: "google", check: "not_supported" },
    ] })]]);
    fireEvent.click(screen.getByRole("button", { name: /Search networks/ }));
    expect(await screen.findByText("Found")).toBeInTheDocument();
    expect(screen.getByText("120 ads, 2 advertiser(s)")).toBeInTheDocument();
    expect(screen.getByText("Unable to check")).toBeInTheDocument();
    expect(screen.getByText("connect ETIMEDOUT")).toBeInTheDocument();
    expect(screen.getByText("Not supported")).toBeInTheDocument();
    expect(screen.queryByText(/no ads found/i)).toBeNull();
  });
});

describe("CopyrightClaims > the decision", () => {
  async function ready(extra = []) {
    const calls = backend(baseHandlers(extra));
    render(<CopyrightClaims />);
    fireEvent.click(await screen.findByText("Example Advertiser"));
    await screen.findByText("Jane Doe · Example Company");
    return calls;
  }

  it("accept needs the confirmation that the documents were reviewed, then sends it, and the claim is reloaded", async () => {
    const calls = await ready([[new RegExp(`^POST /${ID}/accept$`), () => ok({ status: "accepted", processingStatus: "ok" })]]);
    fireEvent.click(screen.getByRole("button", { name: "Accept…" }));
    const dialog = screen.getByText("Accept this claim?").closest("div.bg-white");
    const submit = within(dialog).getByRole("button", { name: "Accept claim" });
    expect(submit).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("checkbox"));
    expect(submit).toBeEnabled();
    fireEvent.change(within(dialog).getByPlaceholderText("Note (optional)"), { target: { value: "documents fine" } });
    fireEvent.click(submit);
    await waitFor(() => expect(toastSpy.success).toHaveBeenCalled());
    const post = calls.find((c) => c.key === `POST /${ID}/accept`);
    expect(JSON.parse(post.opts.body)).toEqual({ evidenceReviewed: true, note: "documents fine" });
    expect(post.opts.headers.Authorization).toBe("Bearer jwt-token");
    expect(JSON.parse(post.opts.body)).not.toHaveProperty("reviewedBy"); // the name comes from the login, on the server
  });

  it("an accept whose processing did not finish says so, instead of 'done'", async () => {
    await ready([[new RegExp(`^POST /${ID}/accept$`), () => ok({ status: "accepted", processingStatus: "partial" })]]);
    fireEvent.click(screen.getByRole("button", { name: "Accept…" }));
    const dialog = screen.getByText("Accept this claim?").closest("div.bg-white");
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Accept claim" }));
    await waitFor(() => expect(toastSpy.warn).toHaveBeenCalledWith(expect.stringMatching(/some steps did not finish/)));
    expect(toastSpy.success).not.toHaveBeenCalled();
  });

  it("reject needs a reason", async () => {
    const calls = await ready([[new RegExp(`^POST /${ID}/reject$`), () => ok({ status: "rejected" })]]);
    fireEvent.click(screen.getByRole("button", { name: "Reject…" }));
    const dialog = screen.getByText("Reject this claim?").closest("div.bg-white");
    const submit = within(dialog).getByRole("button", { name: "Reject claim" });
    expect(submit).toBeDisabled();
    fireEvent.change(within(dialog).getByPlaceholderText("Reason for rejecting (required)"), { target: { value: "no proof of ownership" } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(toastSpy.success).toHaveBeenCalledWith("Rejected."));
    expect(JSON.parse(calls.find((c) => c.key === `POST /${ID}/reject`).opts.body)).toEqual({ reason: "no proof of ownership" });
  });

  it("shows the server's refusal (for example 'already decided') and does not pretend it worked", async () => {
    await ready([[new RegExp(`^POST /${ID}/reject$`), () => reply(409, { code: 409, message: "this claim was already accepted", data: null })]]);
    fireEvent.click(screen.getByRole("button", { name: "Reject…" }));
    const dialog = screen.getByText("Reject this claim?").closest("div.bg-white");
    fireEvent.change(within(dialog).getByPlaceholderText("Reason for rejecting (required)"), { target: { value: "x" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reject claim" }));
    await waitFor(() => expect(toastSpy.error).toHaveBeenCalledWith("this claim was already accepted"));
  });

  it("an accepted claim shows what each network did and a Retry when something did not finish", async () => {
    const accepted = claim({
      status: "accepted", decision: { by: "asha.rao", at: "2026-11-03T11:00:00Z", reason: null, evidenceReviewed: true }, processingStatus: "partial",
      processing: { ok: true, networks: [
        { network: "facebook", blocklist: "ok", hashing: "queued", ads: 120 },
        { network: "quora", blocklist: "failed", hashing: "not_supported", ads: null, error: "no table" },
      ] },
    });
    const calls = await ready([
      [new RegExp(`^GET /${ID}$`), () => ok({ claim: accepted, files: [], filesError: null })],
      [new RegExp(`^POST /${ID}/retry$`), () => ok({ processingStatus: "ok" })],
    ]);
    expect(screen.getByText(/Accepted by asha\.rao/)).toBeInTheDocument();
    expect(screen.getByText("Partly done")).toBeInTheDocument();
    expect(screen.getByText("no table")).toBeInTheDocument();
    expect(screen.getByText(/takedown/i)).toBeInTheDocument(); // it says that taking the ads down is a separate step
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(calls.some((c) => c.key === `POST /${ID}/retry`)).toBe(true));
  });
});

describe("CopyrightClaims > the login", () => {
  it("sends the person to the login page when the server says the login is not valid", async () => {
    spyOnLocation();
    backend([[/^GET \/summary/, () => reply(401, {})], [/^GET \?/, () => reply(401, {})]]);
    render(<CopyrightClaims />);
    await waitFor(() => expect(cookieSpy.remove).toHaveBeenCalledWith("token"));
    expect(assignSpy).toHaveBeenCalledWith("/");
  });
});
