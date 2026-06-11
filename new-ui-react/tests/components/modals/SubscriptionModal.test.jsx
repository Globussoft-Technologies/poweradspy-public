import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

import SubscriptionModal from "../../../src/components/modals/SubscriptionModal.jsx";

describe("SubscriptionModal", () => {
  it("isOpen=false → renders null", () => {
    const { container } = render(<SubscriptionModal isOpen={false} onClose={() => {}} />);
    expect(container.innerHTML).toBe("");
  });
  it("isOpen=true → renders heading + plan details", () => {
    const { getByText } = render(<SubscriptionModal isOpen onClose={() => {}} />);
    expect(getByText(/Discover more Ads with a Premium Subscription/)).toBeInTheDocument();
    expect(getByText("MOST POPULAR")).toBeInTheDocument();
    expect(getByText("PALLADIUM PLAN")).toBeInTheDocument();
    expect(getByText("$399/Month")).toBeInTheDocument();
  });
  it("renders all 17 feature chips + 1 Networks chip", () => {
    const { getByText } = render(<SubscriptionModal isOpen onClose={() => {}} />);
    // sampling
    expect(getByText("Keyword Search")).toBeInTheDocument();
    expect(getByText("Filter by IOS,Android,Desktop,Mobile")).toBeInTheDocument();
    expect(getByText("Networks -")).toBeInTheDocument();
  });
  it("renders 10 network color dots", () => {
    const { container } = render(<SubscriptionModal isOpen onClose={() => {}} />);
    const dots = Array.from(container.querySelectorAll("div"))
      .filter(d => d.getAttribute("title") &&
        ["Facebook", "Instagram", "Google", "YouTube", "Reddit",
          "Quora", "Native", "GDN", "Pinterest", "LinkedIn"]
          .includes(d.getAttribute("title")));
    expect(dots.length).toBe(10);
  });
  it("close button (×) invokes onClose", () => {
    const onClose = vi.fn();
    const { getByText } = render(<SubscriptionModal isOpen onClose={onClose} />);
    const closeBtn = getByText("×");
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });
  it("close button mouseEnter sets color white", () => {
    const { getByText } = render(<SubscriptionModal isOpen onClose={() => {}} />);
    const btn = getByText("×");
    fireEvent.mouseEnter(btn);
    expect(btn.style.color).toBe("rgb(255, 255, 255)");
  });
  it("close button mouseLeave resets color to #ccc", () => {
    const { getByText } = render(<SubscriptionModal isOpen onClose={() => {}} />);
    const btn = getByText("×");
    fireEvent.mouseEnter(btn);
    fireEvent.mouseLeave(btn);
    expect(btn.style.color).toBe("rgb(204, 204, 204)");
  });
  it("Upgrade Now button → SIGNUP url with target=_blank", () => {
    const { getByText } = render(<SubscriptionModal isOpen onClose={() => {}} />);
    const link = getByText("Upgrade Now").closest("a");
    expect(link.getAttribute("href")).toContain("amember/signup/monthly-plans");
    expect(link.getAttribute("target")).toBe("_blank");
  });
  it("Learn More button → app.poweradspy.com with target=_blank", () => {
    const { getByText } = render(<SubscriptionModal isOpen onClose={() => {}} />);
    const link = getByText("Learn More").closest("a");
    expect(link.getAttribute("href")).toBe("https://app.poweradspy.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });
  it("renders body paragraph with upgrade copy", () => {
    const { getByText } = render(<SubscriptionModal isOpen onClose={() => {}} />);
    expect(getByText(/take your brand to new heights/)).toBeInTheDocument();
  });
  it("renders inline svg checkmarks for each feature chip", () => {
    const { container } = render(<SubscriptionModal isOpen onClose={() => {}} />);
    // one svg per feature, 17 features
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBe(17);
  });
});
