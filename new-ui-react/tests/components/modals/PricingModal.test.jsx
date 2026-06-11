import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

vi.mock("lucide-react", () => ({
  X: () => <i data-testid="x-ic" />,
  Check: () => <i data-testid="check-ic" />,
}));
vi.mock("../../../src/assets/fb.png", () => ({ default: "fb.png" }));
vi.mock("../../../src/assets/ig.png", () => ({ default: "ig.png" }));
vi.mock("../../../src/assets/yt.png", () => ({ default: "yt.png" }));
vi.mock("../../../src/assets/g.png", () => ({ default: "g.png" }));
vi.mock("../../../src/assets/gdn.png", () => ({ default: "gdn.png" }));
vi.mock("../../../src/assets/linkedin.png", () => ({ default: "linkedin.png" }));
vi.mock("../../../src/assets/native.png", () => ({ default: "native.png" }));
vi.mock("../../../src/assets/rd.png", () => ({ default: "rd.png" }));
vi.mock("../../../src/assets/quora.png", () => ({ default: "quora.png" }));
vi.mock("../../../src/assets/pinterest.png", () => ({ default: "pinterest.png" }));
vi.mock("../../../src/assets/tiktoklogo.jpg", () => ({ default: "tt.jpg" }));
vi.mock("../../../src/assets/poweradspy-logo.webp", () => ({ default: "pas.webp" }));

import PricingModal from "../../../src/components/modals/PricingModal.jsx";

describe("PricingModal", () => {
  it("isOpen=false → renders null", () => {
    const { container } = render(<PricingModal isOpen={false} onClose={() => {}} />);
    expect(container.innerHTML).toBe("");
  });
  it("isOpen=true with no currentPlanTier → shows all 6 plans", () => {
    const { getByText } = render(<PricingModal isOpen onClose={() => {}} />);
    expect(getByText("Choose Your Plan")).toBeInTheDocument();
    for (const p of ["Basic", "Standard", "Premium", "Platinum", "Titanium", "Palladium"]) {
      expect(getByText(p)).toBeInTheDocument();
    }
  });
  it("currentPlanTier='Standard' → filters out Basic + Standard", () => {
    const { getByText, queryByText } = render(
      <PricingModal isOpen onClose={() => {}} currentPlanTier="Standard" />,
    );
    expect(queryByText("Basic")).toBeNull();
    expect(queryByText("Standard")).toBeNull();
    expect(getByText("Premium")).toBeInTheDocument();
    expect(getByText("Platinum")).toBeInTheDocument();
  });
  it("currentPlanTier='Palladium' (highest) → 'already on highest plan' message", () => {
    const { getByText, queryByText } = render(
      <PricingModal isOpen onClose={() => {}} currentPlanTier="Palladium" />,
    );
    expect(getByText("You are already on the highest plan.")).toBeInTheDocument();
    expect(queryByText("Basic")).toBeNull();
  });
  it("unknown currentPlanTier → -1 baseline → all plans shown", () => {
    const { getByText } = render(
      <PricingModal isOpen onClose={() => {}} currentPlanTier="MysteryTier" />,
    );
    expect(getByText("Basic")).toBeInTheDocument();
  });
  it("X button click invokes onClose", () => {
    const onClose = vi.fn();
    const { container } = render(<PricingModal isOpen onClose={onClose} />);
    const closeBtn = container.querySelector('[data-testid="x-ic"]').closest("button");
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });
  it("renders Check icons for enabled features", () => {
    const { container } = render(<PricingModal isOpen onClose={() => {}} />);
    expect(container.querySelectorAll('[data-testid="check-ic"]').length).toBeGreaterThan(20);
  });
  it("renders X icons (close button + disabled features)", () => {
    const { container } = render(<PricingModal isOpen onClose={() => {}} />);
    // 1 close + many disabled
    expect(container.querySelectorAll('[data-testid="x-ic"]').length).toBeGreaterThan(5);
  });
  it("Upgrade button links to SIGNUP_URL with target=_blank", () => {
    const { getAllByText } = render(<PricingModal isOpen onClose={() => {}} />);
    const btns = getAllByText("Upgrade");
    expect(btns.length).toBe(6);
    const link = btns[0].closest("a");
    expect(link.getAttribute("href")).toContain("amember/signup/monthly-plans");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });
  it("renders feature label list", () => {
    const { getByText } = render(<PricingModal isOpen onClose={() => {}} />);
    expect(getByText("Networks")).toBeInTheDocument();
    expect(getByText("Keyword search")).toBeInTheDocument();
    expect(getByText("Favourite and Hidden")).toBeInTheDocument();
  });
  it("renders platform icons via PLATFORM_ICONS map (TikTok has bg-white class)", () => {
    const { container } = render(<PricingModal isOpen onClose={() => {}} />);
    // TikTok appears in Premium+ plans
    const tiktokIcons = Array.from(container.querySelectorAll("img"))
      .filter(i => i.getAttribute("alt") === "TikTok");
    expect(tiktokIcons.length).toBeGreaterThan(0);
    expect(tiktokIcons[0].className).toMatch(/bg-white/);
  });
  it("non-TikTok platform icons do NOT have bg-white", () => {
    const { container } = render(<PricingModal isOpen onClose={() => {}} />);
    const fbIcons = Array.from(container.querySelectorAll("img"))
      .filter(i => i.getAttribute("alt") === "Facebook");
    expect(fbIcons[0].className).not.toMatch(/bg-white/);
  });
  it("PowerAdSpy logo rendered", () => {
    const { container } = render(<PricingModal isOpen onClose={() => {}} />);
    const logo = Array.from(container.querySelectorAll("img"))
      .find(i => i.getAttribute("alt") === "PowerAdSpy Logo");
    expect(logo).toBeTruthy();
    expect(logo.getAttribute("src")).toBe("pas.webp");
  });
  it("price renders amount and /Month label", () => {
    const { getByText } = render(<PricingModal isOpen onClose={() => {}} />);
    expect(getByText("$69")).toBeInTheDocument();
    expect(getByText("$349")).toBeInTheDocument();
  });
  it("last visible plan column lacks border-r (border styling absent on last)", () => {
    const { container } = render(<PricingModal isOpen onClose={() => {}} currentPlanTier="Platinum" />);
    // After Platinum, visible = Titanium + Palladium
    const planCols = container.querySelectorAll('.w-\\[160px\\]');
    expect(planCols.length).toBe(2);
    // Last column should NOT have border-r class
    expect(planCols[planCols.length - 1].className).not.toMatch(/border-r/);
  });
  it("currentPlanTier=null → uses fallback, all plans rendered", () => {
    const { getByText } = render(<PricingModal isOpen onClose={() => {}} currentPlanTier={null} />);
    expect(getByText("Basic")).toBeInTheDocument();
  });
});
