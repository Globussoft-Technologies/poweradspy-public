import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const cookieSpy = vi.hoisted(() => ({ get: vi.fn(() => "jwt-token"), remove: vi.fn() }));
vi.mock("js-cookie", () => ({ default: cookieSpy }));

import TakedownMonitor from "../../src/components/Pas/TakedownMonitor.jsx";

// the same address the page uses: the .env setting when there is one (a developer's machine), else the default
const ROOT = `${import.meta.env.VITE_ADMIN_PANEL_API || "http://localhost:4000/admin-panel"}/copyright-claims`;
const RUN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DRY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const COMPLAINT = "11111111-1111-4111-8111-111111111111";
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const ok = (data) => reply(200, { code: 200, message: "ok", data });
const when = "2026-11-04T09:00:00Z";

const OVERVIEW = {
  networks: [
    { network: "facebook", takedown: { available: true, runs: { total: 5, byGroup: { done: 3, failed: 1, running: 1 }, byStatus: {} }, items: { planned: 60, deleted: 39, failed: 6, waiting: 15 }, dryRuns: { total: 7, byStatus: {} }, lastRunAt: when }, hashJobs: { available: true, total: 3, byStatus: { done: 2, pending: 1 } } },
    { network: "reddit", takedown: { available: false, reason: "no_table" }, hashJobs: { available: false, reason: "no_table" } },
  ],
  totals: { runs: { total: 5, byGroup: { done: 3, failed: 1, running: 1 } }, items: { planned: 60, deleted: 39, failed: 6, waiting: 15 }, hashJobs: { total: 3, byStatus: { done: 2, pending: 1 } }, unavailable: [{ network: "reddit", what: "takedown", reason: "no_table" }, { network: "reddit", what: "hashJobs", reason: "no_table" }] },
  groups: {},
};
const run = (over = {}) => ({ runId: RUN, network: "facebook", complaintId: COMPLAINT, triggerType: "complaint", mode: "execute", status: "failed", group: "failed", startedAt: when, finishedAt: null, itemsPlanned: 10, itemsSucceeded: 4, itemsFailed: 6, operator: "anij", reportUri: null, proofUri: null, details: null, createdAt: when, ...over });
const step = (id, over = {}) => ({ id, targetType: "ad", targetId: `ad${id}`, internalAdId: String(id), targetValue: null, targetUrl: null, system: "sql", operation: "delete", status: "succeeded", group: "done", errorMessage: null, details: null, attempts: 1, proofUri: null, nextRetryAt: null, startedAt: when, finishedAt: when, createdAt: when, ...over });

/** A fake backend: [regex on "GET path", () => response]. Every call is kept. */
function backend(handlers) {
  const calls = [];
  global.fetch = vi.fn(async (url, opts = {}) => {
    const key = `${opts.method || "GET"} ${String(url).replace(ROOT, "") || "/"}`;
    calls.push({ key, opts });
    for (const [pattern, fn] of handlers) if (pattern.test(key)) return fn(opts);
    throw new Error(`unexpected call: ${key}`);
  });
  return calls;
}
const base = (over = []) => [
  ...over,
  [/^GET \/monitor\/overview/, () => ok(OVERVIEW)],
  [/^GET \/monitor\/runs\?/, () => ok({ items: [run(), run({ runId: DRY, mode: "dry_run", status: "succeeded", group: "done", itemsPlanned: 700, itemsSucceeded: 700, itemsFailed: 0 })], unavailable: [], next: null })],
];
const show = () => render(<MemoryRouter><TakedownMonitor /></MemoryRouter>);

const realLocation = window.location;
const assignSpy = vi.fn();
beforeEach(() => { cookieSpy.get.mockReturnValue("jwt-token"); cookieSpy.remove.mockReset(); assignSpy.mockReset(); });
afterEach(() => { cleanup(); Object.defineProperty(window, "location", { configurable: true, writable: true, value: realLocation }); });

describe("TakedownMonitor > the numbers", () => {
  it("shows deleted, waiting and failed, the networks, and says which are not available (never as zero)", async () => {
    const calls = backend(base());
    show();
    // each number is on its stat card and in the facebook row of the table
    expect((await screen.findAllByText("39")).length).toBe(2);   // deleted
    expect(screen.getAllByText("15").length).toBe(2);            // waiting
    expect(screen.getAllByText("6").length).toBeGreaterThanOrEqual(2); // failed
    expect(screen.getAllByText("Deleted").length).toBeGreaterThan(0);
    expect(screen.getByText(/Not available \(tables missing or not readable\): reddit/)).toBeInTheDocument();
    expect(screen.getByText("Takedown: not available")).toBeInTheDocument();
    expect(calls.find((c) => c.key.startsWith("GET /monitor/overview")).opts.headers.Authorization).toBe("Bearer jwt-token");
  });

  it("a person who is not a reviewer is told so and is not sent to the login page", async () => {
    backend([[/^GET \/monitor\/overview/, () => reply(403, { code: 403, message: "no" })]]);
    Object.defineProperty(window, "location", { configurable: true, writable: true, value: { ...realLocation, assign: assignSpy } });
    show();
    expect(await screen.findByText(/do not have access to the takedown monitor/i)).toBeInTheDocument();
    expect(cookieSpy.remove).not.toHaveBeenCalled();
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it("a 401 clears the login and sends the person to the login page", async () => {
    backend([[/^GET \/monitor\/overview/, () => reply(401, { code: 401 })], [/^GET \/monitor\/runs\?/, () => reply(401, { code: 401 })]]);
    Object.defineProperty(window, "location", { configurable: true, writable: true, value: { ...realLocation, assign: assignSpy } });
    show();
    await waitFor(() => expect(assignSpy).toHaveBeenCalledWith("/"));
    expect(cookieSpy.remove).toHaveBeenCalledWith("token");
  });
});

describe("TakedownMonitor > takedown runs and their log", () => {
  it("lists the runs of the chosen network; a dry run is marked as having deleted nothing", async () => {
    const calls = backend(base());
    show();
    expect(await screen.findByText("dry run: deleted nothing")).toBeInTheDocument();
    expect(screen.getAllByText("failed").length).toBeGreaterThan(0);
    const list = calls.find((c) => c.key.startsWith("GET /monitor/runs?"));
    expect(list.key).toContain("network=facebook");
  });

  it("opens one run and shows every step with its system, error, tries and retry time", async () => {
    const calls = backend(base([[new RegExp(`^GET /monitor/runs/${RUN}/logs`), () => ok({
      run: run(), steps: { byGroup: { done: 2, failed: 1 }, bySystem: { sql: { total: 2, byStatus: { succeeded: 2 } }, elastic: { total: 1, byStatus: { failed: 1 } } } },
      items: [step(1), step(2), step(3, { system: "elastic", status: "failed", group: "failed", errorMessage: "connection timeout", attempts: 3, nextRetryAt: "2026-11-04T12:00:00Z" })], next: null,
    })]]));
    show();
    fireEvent.click((await screen.findAllByText(RUN.slice(0, 8)))[0].closest("tr"));
    const dialog = await screen.findByRole("dialog", { name: "Run log" });
    expect(await within(dialog).findByText("connection timeout")).toBeInTheDocument();
    expect(within(dialog).getByText("elastic: failed 1")).toBeInTheDocument();
    expect(within(dialog).getByText("sql: succeeded 2")).toBeInTheDocument();
    expect(within(dialog).getByText(/retry /)).toBeInTheDocument();
    expect(calls.some((c) => c.key.includes(`/monitor/runs/${RUN}/logs?network=facebook`))).toBe(true);
    // filtering by a system asks the server again
    fireEvent.click(within(dialog).getByText("elastic: failed 1"));
    await waitFor(() => expect(calls.some((c) => c.key.includes("system=elastic"))).toBe(true));
    fireEvent.click(within(dialog).getByLabelText("Close"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("finds the runs of a complaint by its id, in every network, and refuses text that is not an id", async () => {
    const calls = backend(base());
    show();
    await screen.findByText("dry run: deleted nothing");
    fireEvent.change(screen.getByLabelText("Complaint id"), { target: { value: "nonsense" } });
    fireEvent.click(screen.getByLabelText("Search"));
    expect(await screen.findByText("That is not a complaint id.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Complaint id"), { target: { value: COMPLAINT } });
    fireEvent.click(screen.getByLabelText("Search"));
    await waitFor(() => expect(calls.some((c) => c.key.includes(`complaintId=${COMPLAINT}`) && !c.key.includes("network="))).toBe(true));
  });
});

describe("TakedownMonitor > failed steps, hash jobs and claim requests", () => {
  it("shows the failed steps with their error", async () => {
    backend(base([[/^GET \/monitor\/failures/, () => ok({ items: [{ ...step(9, { system: "mongo", status: "failed", group: "failed", errorMessage: "E11000 duplicate", attempts: 2 }), runId: RUN }], next: null })]]));
    show();
    fireEvent.click(await screen.findByText("Failed steps"));
    expect(await screen.findByText("E11000 duplicate")).toBeInTheDocument();
    expect(screen.getByText("mongo / delete")).toBeInTheDocument();
  });

  it("lists the hash jobs and opens one to see what it did with each image", async () => {
    const calls = backend(base([
      [/^GET \/monitor\/hash-jobs\?/, () => ok({ items: [{ id: 12, network: "facebook", entryType: "advertiser", value: "Example Advertiser", status: "failed", attempts: 3, updatedAt: when, lastError: "image service down" }], next: 12 })],
      [/^GET \/monitor\/hash-jobs\/12\/results/, () => ok({ job: { id: 12, entryType: "advertiser", value: "Example Advertiser", status: "failed", lastError: "image service down", stats: { hashed: 4 } }, generation: 1, latestGeneration: 1, items: [{ id: 1, platformAdId: "ad77", internalAdId: "5", sourceUrl: "https://cdn/x.jpg", outcome: "failed", reason: "download_failed", updatedAt: when }], next: null })],
    ]));
    show();
    fireEvent.click(await screen.findByText("Hash jobs", { selector: "button" }));
    fireEvent.click(await screen.findByText("Example Advertiser", { exact: false }));
    const dialog = await screen.findByRole("dialog", { name: "Job results" });
    expect(await within(dialog).findByText("download_failed")).toBeInTheDocument();
    expect(within(dialog).getByText("ad77")).toBeInTheDocument();
    expect(calls.some((c) => c.key.includes("/monitor/hash-jobs/12/results?network=facebook"))).toBe(true);
  });

  it("lists the claim requests that came in, with who sent them and what was decided", async () => {
    const calls = backend(base([[/^GET \?/, () => ok({ items: [
      { id: 5, complaintId: COMPLAINT, reference: "CR-ABC234", name: "Example Advertiser", organization: "Example Company", status: "pending", receivedAt: when, decidedBy: null, decidedAt: null, processingStatus: "none" },
      { id: 4, complaintId: "22222222-2222-4222-8222-222222222222", reference: "CR-XYZ789", name: "Other Brand", organization: "Other Co", status: "accepted", receivedAt: when, decidedBy: "Asha.Rao", decidedAt: when, processingStatus: "partial" },
    ], next: null })]]));
    show();
    fireEvent.click(await screen.findByText("Claim requests"));
    expect(await screen.findByText("CR-ABC234")).toBeInTheDocument();
    expect(screen.getByText("Other Co")).toBeInTheDocument();
    expect(screen.getByText("Partly done")).toBeInTheDocument();
    expect(screen.getByText(/Asha\.Rao/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Copyright Claims page/ })).toHaveAttribute("href", "/pas/copyright-claims");
    fireEvent.click(screen.getByText("Accepted", { selector: "button" }));
    await waitFor(() => expect(calls.some((c) => c.key.startsWith("GET ?") && c.key.includes("status=accepted"))).toBe(true));
  });
});

describe("TakedownMonitor > blocked list and rejected ads", () => {
  const HASH = "ab".repeat(32);
  const blockRow = (over = {}) => ({ id: 7, network: "facebook", entryType: "advertiser", value: "Test Brand", reason: "blocklist test", source: "intake", complaintId: COMPLAINT, status: "active", expiresAt: null, createdAt: when, addedBy: "landing-form", removedAt: null, removedBy: null, ...over });
  const blocklistReply = (items, over = {}) => ok({ counts: { total: 8, byStatus: { active: 7, revoked: 1 }, activeByType: { advertiser: 2, image_hash: 5 } }, items, next: null, ...over });

  it("shows who and what is blocked in the chosen network, with the counts", async () => {
    const calls = backend(base([[/^GET \/monitor\/blocklist\?/, () => blocklistReply([blockRow(), blockRow({ id: 6, entryType: "image_hash", value: HASH, addedBy: "imagematch-worker", source: null, reason: null }), blockRow({ id: 5, value: "Old Brand", status: "revoked", removedBy: "Admin", removedAt: when })])]]));
    show();
    fireEvent.click(await screen.findByText("Blocked list", { selector: "button" }));
    expect(await screen.findByText("Test Brand")).toBeInTheDocument();
    expect(screen.getAllByText("blocklist test").length).toBe(2); // the two rows that carry a reason
    expect(screen.getByText("Blocked (active)")).toBeInTheDocument();
    expect(screen.getByText("Blocked (active)").parentElement).toHaveTextContent("7"); // the card, not any other "7" on the page
    expect(screen.getByText("advertiser 2 · image_hash 5")).toBeInTheDocument();
    expect(screen.getByText("Old Brand")).toBeInTheDocument();
    expect(screen.getByText(/by Admin/)).toBeInTheDocument();
    expect(screen.getByText(`${HASH.slice(0, 16)}…`)).toBeInTheDocument(); // an image hash is shortened, the full value is in the tooltip
    expect(calls.find((c) => c.key.startsWith("GET /monitor/blocklist?")).key).toContain("network=facebook");
  });

  it("asks the server again when a filter or the search changes", async () => {
    const calls = backend(base([[/^GET \/monitor\/blocklist\?/, () => blocklistReply([blockRow()])]]));
    show();
    fireEvent.click(await screen.findByText("Blocked list", { selector: "button" }));
    await screen.findByText("Test Brand");
    fireEvent.click(screen.getByRole("button", { name: "Active" }));
    await waitFor(() => expect(calls.some((c) => c.key.startsWith("GET /monitor/blocklist?") && c.key.includes("status=active"))).toBe(true));
    fireEvent.change(screen.getByLabelText("Block type"), { target: { value: "advertiser" } });
    await waitFor(() => expect(calls.some((c) => c.key.includes("entryType=advertiser"))).toBe(true));
    fireEvent.change(screen.getByLabelText("Search blocked"), { target: { value: "test brand" } });
    fireEvent.click(screen.getByLabelText("Search blocked list"));
    await waitFor(() => expect(calls.some((c) => c.key.includes("q=test+brand") || c.key.includes("q=test%20brand"))).toBe(true));
  });

  it("says plainly that nothing is blocked, and shows the server's error when it cannot be read", async () => {
    backend(base([[/^GET \/monitor\/blocklist\?/, () => blocklistReply([], { counts: { total: 0, byStatus: {}, activeByType: {} } })]]));
    show();
    fireEvent.click(await screen.findByText("Blocked list", { selector: "button" }));
    expect(await screen.findByText("Nothing is blocked here yet.")).toBeInTheDocument();
    cleanup();
    backend(base([[/^GET \/monitor\/blocklist\?/, () => reply(503, { code: 503, message: "the blocklist table does not exist in that database yet" })]]));
    show();
    fireEvent.click(await screen.findByText("Blocked list", { selector: "button" }));
    expect(await screen.findByText("the blocklist table does not exist in that database yet")).toBeInTheDocument();
  });

  it("lists the ads the blocklist refused, and why", async () => {
    const calls = backend(base([[/^GET \/monitor\/attempts\?/, () => ok({ items: [
      { id: 12, network: "facebook", platformAdId: "990001110002", advertiser: "Test Brand", imageUrl: null, blocklistId: 7, matchType: "advertiser", distance: null, source: "ingestion:facebook", createdAt: when },
      { id: 11, network: "facebook", platformAdId: "990001110003", advertiser: null, imageUrl: "https://cdn.example/x.jpg", blocklistId: 9, matchType: "phash", distance: 3, source: null, createdAt: when },
    ], next: null })]]));
    show();
    fireEvent.click(await screen.findByText("Rejected ads", { selector: "button" }));
    expect(await screen.findByText("Advertiser name")).toBeInTheDocument();
    expect(screen.getByText("990001110002")).toBeInTheDocument();
    expect(screen.getByText("Similar image")).toBeInTheDocument();
    expect(screen.getByText("3 bits apart")).toBeInTheDocument();
    expect(screen.getByText("https://cdn.example/x.jpg")).toBeInTheDocument();
    expect(calls.find((c) => c.key.startsWith("GET /monitor/attempts?")).key).toContain("network=facebook");
  });

  it("says no ad has been refused yet", async () => {
    backend(base([[/^GET \/monitor\/attempts\?/, () => ok({ items: [], next: null })]]));
    show();
    fireEvent.click(await screen.findByText("Rejected ads", { selector: "button" }));
    expect(await screen.findByText("No ad has been refused here yet.")).toBeInTheDocument();
  });
});

describe("TakedownMonitor > read only", () => {
  it("only ever sends GET requests", async () => {
    const calls = backend(base([
      [/^GET \/monitor\/failures/, () => ok({ items: [], next: null })],
      [/^GET \/monitor\/hash-jobs\?/, () => ok({ items: [], next: null })],
      [/^GET \?/, () => ok({ items: [], next: null })],
    ]));
    show();
    for (const label of ["Failed steps", "Hash jobs", "Claim requests", "Takedown runs"]) fireEvent.click(await screen.findByText(label, { selector: "button" }));
    await screen.findByText("dry run: deleted nothing");
    expect(calls.length).toBeGreaterThan(4);
    for (const c of calls) expect(c.key.startsWith("GET ")).toBe(true);
  });
});
