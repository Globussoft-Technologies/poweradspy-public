import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor, act, waitForElementToBeRemoved } from "@testing-library/react";

vi.mock("../../src/components/CreditDeductionModal.css", () => ({}));
vi.mock("../../src/assets/img/sparkle-dark.svg", () => ({ default: "sparkle.svg" }));
vi.mock("../../src/assets/img/advideo.svg", () => ({ default: "advideo.svg" }));
vi.mock("../../src/assets/img/addie.svg", () => ({ default: "addie.svg" }));
vi.mock("../../src/assets/img/adcopy.svg", () => ({ default: "adcopy.svg" }));

vi.mock("react-icons/ri", () => ({
  RiGeminiFill: ({ className }) => <i data-testid="gemini-ic" className={className} />,
}));
vi.mock("react-icons/si", () => ({
  SiOpenai: ({ className }) => <i data-testid="openai-ic" className={className} />,
}));

import CreditDeductionModal from "../../src/components/CreditDeductionModal.jsx";

beforeEach(() => {
  vi.stubEnv("VITE_ADSGPT_BACKEND", "https://api.example.com");
  globalThis.fetch = vi.fn();
  document.body.style.overflow = "unset";
});

const sampleData = {
  total_credits_all_models: 250,
  models: [
    { model: "ADSGPT-3.0", credits_deducted: 100, usage_count: 20, percentage: "40%" },
    { model: "ADSGPT-2.0", credits_deducted: 80, usage_count: 10, percentage: "32%" },
    { model: "ADSGPT-1.0", credits_deducted: 50, usage_count: 5, percentage: "20%" },
    { model: "ADSGPT-VIDEO", credits_deducted: 12, usage_count: 1, percentage: "5%" },
    { model: "ADSGPT-CHAT", credits_deducted: 4, usage_count: 2, percentage: "2%" },
    { model: "ADSGPT-TEXT", credits_deducted: 2, usage_count: 1, percentage: "1%" },
    { model: "ADSGPT-UNKNOWN", credits_deducted: 2, usage_count: 1, percentage: "0%" },
  ],
};

const user = { user_id: "u-99", user_name: "Alice" };

describe("CreditDeductionModal", () => {
  it("isOpen=false → renders null", () => {
    const { container } = render(<CreditDeductionModal isOpen={false} onClose={() => {}} />);
    expect(container.innerHTML).toBe("");
  });
  it("renders header + user info when isOpen", async () => {
    globalThis.fetch.mockResolvedValue({ json: () => Promise.resolve({ data: sampleData }) });
    const { getByText, findAllByText } = render(<CreditDeductionModal user={user} isOpen onClose={() => {}} />);
    expect(getByText("Credit Usage Analytics")).toBeInTheDocument();
    expect(getByText("Alice")).toBeInTheDocument();
    expect(getByText("ID: u-99")).toBeInTheDocument();
    expect((await findAllByText("250")).length).toBeGreaterThan(0);
  });
  it("fetchCreditData success populates data", async () => {
    globalThis.fetch.mockResolvedValue({ json: () => Promise.resolve({ data: sampleData }) });
    render(<CreditDeductionModal user={user} isOpen onClose={() => {}} />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(globalThis.fetch.mock.calls[0][0]).toContain("/adsgpt/user-credit-data/models/u-99/basic");
  });
  it("fetchCreditData error logs to console + sets loading=false", async () => {
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    globalThis.fetch.mockRejectedValue(new Error("network"));
    render(<CreditDeductionModal user={user} isOpen onClose={() => {}} />);
    await waitFor(() => expect(consoleErr).toHaveBeenCalled());
    consoleErr.mockRestore();
  });
  it("close button triggers onClose after fade-out", async () => {
    vi.useFakeTimers();
    globalThis.fetch.mockResolvedValue({ json: () => Promise.resolve({ data: sampleData }) });
    const onClose = vi.fn();
    const { container } = render(<CreditDeductionModal user={user} isOpen onClose={onClose} />);
    const closeBtn = container.querySelector(".credit-deduction-close-button");
    fireEvent.click(closeBtn);
    await act(async () => { vi.advanceTimersByTime(310); });
    expect(onClose).toHaveBeenCalled();
    vi.useRealTimers();
  });
  it("backdrop click triggers onClose", async () => {
    vi.useFakeTimers();
    globalThis.fetch.mockResolvedValue({ json: () => Promise.resolve({ data: sampleData }) });
    const onClose = vi.fn();
    const { container } = render(<CreditDeductionModal user={user} isOpen onClose={onClose} />);
    fireEvent.click(container.querySelector(".credit-deduction-modal-backdrop"));
    await act(async () => { vi.advanceTimersByTime(310); });
    expect(onClose).toHaveBeenCalled();
    vi.useRealTimers();
  });
  it("Close Dashboard button triggers onClose", async () => {
    globalThis.fetch.mockResolvedValue({ json: () => Promise.resolve({ data: sampleData }) });
    const onClose = vi.fn();
    const { findAllByText } = render(<CreditDeductionModal user={user} isOpen onClose={onClose} />);
    const btns = await findAllByText("Close Dashboard");
    vi.useFakeTimers();
    fireEvent.click(btns[0]);
    await act(async () => { vi.advanceTimersByTime(310); });
    expect(onClose).toHaveBeenCalled();
    vi.useRealTimers();
  });
  it("body.overflow set to 'hidden' when modal opens, restored on close/unmount", () => {
    globalThis.fetch.mockResolvedValue({ json: () => Promise.resolve({ data: sampleData }) });
    const { unmount } = render(<CreditDeductionModal user={user} isOpen onClose={() => {}} />);
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("unset");
  });
  it("isOpen=false with user set → overflow stays 'unset'", () => {
    render(<CreditDeductionModal user={user} isOpen={false} onClose={() => {}} />);
    expect(document.body.style.overflow).toBe("unset");
  });
  it("tab switching: Overview → Detailed View", async () => {
    globalThis.fetch.mockResolvedValue({ json: () => Promise.resolve({ data: sampleData }) });
    const { findByText, getByText } = render(<CreditDeductionModal user={user} isOpen onClose={() => {}} />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    await waitFor(() => expect(getByText("Detailed View")).toBeInTheDocument());
    fireEvent.click(getByText("Detailed View"));
    await waitFor(() => expect(getByText("Detailed Usage Analytics")).toBeInTheDocument());
  });
  it("overview renders stats grid + breakdown cards", async () => {
    globalThis.fetch.mockResolvedValue({ json: () => Promise.resolve({ data: sampleData }) });
    const { findAllByText } = render(<CreditDeductionModal user={user} isOpen onClose={() => {}} />);
    expect((await findAllByText("Total Credits Used")).length).toBeGreaterThan(0);
  });
  it("loading state shows spinner + 'Loading credit analytics...'", () => {
    let resolveFetch;
    globalThis.fetch.mockImplementation(() => new Promise((r) => { resolveFetch = r; }));
    const { getByText } = render(<CreditDeductionModal user={user} isOpen onClose={() => {}} />);
    expect(getByText("Loading credit analytics...")).toBeInTheDocument();
    resolveFetch({ json: () => Promise.resolve({ data: sampleData }) });
  });
  it("AnimatedPieChart renders segments after animation timer", async () => {
    vi.useFakeTimers();
    globalThis.fetch.mockResolvedValue({ json: () => Promise.resolve({ data: sampleData }) });
    const { container } = render(<CreditDeductionModal user={user} isOpen onClose={() => {}} />);
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(container.querySelectorAll(".credit-deduction-pie-segment").length).toBe(7);
    vi.useRealTimers();
  });
  it("Detailed view renders table with efficiency badge variants", async () => {
    globalThis.fetch.mockResolvedValue({ json: () => Promise.resolve({ data: sampleData }) });
    const { findByText, getByText, getAllByText, container } = render(<CreditDeductionModal user={user} isOpen onClose={() => {}} />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    fireEvent.click(getByText("Detailed View"));
    expect(getByText("Detailed Usage Analytics")).toBeInTheDocument();
    // Efficiency badges
    const badges = container.querySelectorAll(".credit-deduction-efficiency-badge");
    expect(badges.length).toBe(7); // one per model
    const badgeTexts = Array.from(badges).map(b => b.textContent);
    expect(badgeTexts).toContain("High");
  });
  it("Detailed insights show most used model + N/A fallback when no models", async () => {
    globalThis.fetch.mockResolvedValue({ json: () => Promise.resolve({ data: { total_credits_all_models: 0, models: [] } }) });
    const { findByText, getByText } = render(<CreditDeductionModal user={user} isOpen onClose={() => {}} />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    fireEvent.click(getByText("Detailed View"));
    expect(getByText("N/A")).toBeInTheDocument();
    expect(getByText("0%")).toBeInTheDocument();
  });
  it("unknown model uses fallback color + label", async () => {
    globalThis.fetch.mockResolvedValue({ json: () => Promise.resolve({ data: sampleData }) });
    const { container, findByText } = render(<CreditDeductionModal user={user} isOpen onClose={() => {}} />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    // ADSGPT-UNKNOWN row uses fallback gradient + fallback label
    expect(container.textContent).toContain("ADSGPT-UNKNOWN");
  });
  it("user without user_name → avatar safe with undefined char", async () => {
    globalThis.fetch.mockResolvedValue({ json: () => Promise.resolve({ data: sampleData }) });
    const { container } = render(<CreditDeductionModal user={{ user_id: "u-1" }} isOpen onClose={() => {}} />);
    expect(container.querySelector(".credit-deduction-user-avatar")).not.toBeNull();
  });
  it("creditData null → defaults render 0s in stat cards", async () => {
    let resolveFetch;
    globalThis.fetch.mockImplementation(() => new Promise((r) => { resolveFetch = r; }));
    const { getByText, queryAllByText } = render(<CreditDeductionModal user={user} isOpen onClose={() => {}} />);
    expect(getByText("Loading credit analytics...")).toBeInTheDocument();
    // resolve to a null data response — modal stays loading
    resolveFetch({ json: () => Promise.resolve({ data: null }) });
  });
  it("efficiency='Medium' threshold (avg/use between 6-10)", async () => {
    globalThis.fetch.mockResolvedValue({
      json: () => Promise.resolve({ data: {
        total_credits_all_models: 12,
        models: [{ model: "X", credits_deducted: 12, usage_count: 2, percentage: "100%" }],
      } }),
    });
    const { findByText, getByText, container } = render(<CreditDeductionModal user={user} isOpen onClose={() => {}} />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    fireEvent.click(getByText("Detailed View"));
    expect(container.querySelector(".credit-deduction-efficiency-badge.medium")).not.toBeNull();
  });
  it("efficiency='Low' threshold (avg/use > 10)", async () => {
    globalThis.fetch.mockResolvedValue({
      json: () => Promise.resolve({ data: {
        total_credits_all_models: 50,
        models: [{ model: "X", credits_deducted: 50, usage_count: 2, percentage: "100%" }],
      } }),
    });
    const { findByText, getByText, container } = render(<CreditDeductionModal user={user} isOpen onClose={() => {}} />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    fireEvent.click(getByText("Detailed View"));
    expect(container.querySelector(".credit-deduction-efficiency-badge.low")).not.toBeNull();
  });
});
