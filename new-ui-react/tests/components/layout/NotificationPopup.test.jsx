import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

vi.mock("lucide-react", () => ({
  Search: () => <i data-testid="search-ic" />,
  User: () => <i data-testid="user-ic" />,
  Globe: () => <i data-testid="globe-ic" />,
  CheckCheck: () => <i data-testid="checkcheck-ic" />,
  Bell: () => <i data-testid="bell-ic" />,
}));

import NotificationPopup from "../../../src/components/layout/NotificationPopup.jsx";

describe("NotificationPopup", () => {
  it("empty list shows empty-state message", () => {
    const { getByText } = render(
      <NotificationPopup notifications={[]} onMarkAllRead={() => {}} onClose={() => {}} />,
    );
    expect(getByText("No new notifications")).toBeInTheDocument();
    expect(getByText(/You'll be notified/)).toBeInTheDocument();
  });
  it("empty list: 'Mark all read' button hidden", () => {
    const { queryByText } = render(
      <NotificationPopup notifications={[]} onMarkAllRead={() => {}} onClose={() => {}} />,
    );
    expect(queryByText("Mark all read")).toBeNull();
  });
  it("notifications shown with count badge", () => {
    const notifs = [
      { id: 1, type: 0, keyword: "shoes", created_at: new Date().toISOString() },
      { id: 2, type: 1, keyword: "Nike", created_at: new Date(Date.now() - 60_000 * 5).toISOString() },
    ];
    const { getByText } = render(
      <NotificationPopup notifications={notifs} onMarkAllRead={() => {}} onClose={() => {}} />,
    );
    expect(getByText("2")).toBeInTheDocument();
  });
  it("type=0 → 'Keyword' label", () => {
    const { getByText } = render(
      <NotificationPopup notifications={[{ id: 1, type: 0, keyword: "k", created_at: "2025-01-01" }]}
        onMarkAllRead={() => {}} onClose={() => {}} />,
    );
    expect(getByText("Keyword")).toBeInTheDocument();
  });
  it("type=1 → 'Advertiser' label", () => {
    const { getByText } = render(
      <NotificationPopup notifications={[{ id: 1, type: 1, keyword: "k", created_at: "2025-01-01" }]}
        onMarkAllRead={() => {}} onClose={() => {}} />,
    );
    expect(getByText("Advertiser")).toBeInTheDocument();
  });
  it("type=2 → 'Domain' label", () => {
    const { getByText } = render(
      <NotificationPopup notifications={[{ id: 1, type: 2, keyword: "k", created_at: "2025-01-01" }]}
        onMarkAllRead={() => {}} onClose={() => {}} />,
    );
    expect(getByText("Domain")).toBeInTheDocument();
  });
  it("unknown type → falls back to 'Keyword'", () => {
    const { getByText } = render(
      <NotificationPopup notifications={[{ id: 1, type: 99, keyword: "k", created_at: "2025-01-01" }]}
        onMarkAllRead={() => {}} onClose={() => {}} />,
    );
    expect(getByText("Keyword")).toBeInTheDocument();
  });
  it("Mark all read button fires onMarkAllRead", () => {
    const onMarkAllRead = vi.fn();
    const { getByText } = render(
      <NotificationPopup notifications={[{ id: 1, type: 0, keyword: "k" }]}
        onMarkAllRead={onMarkAllRead} onClose={() => {}} />,
    );
    fireEvent.click(getByText("Mark all read"));
    expect(onMarkAllRead).toHaveBeenCalled();
  });
});

describe("NotificationPopup > timeAgo helper (via rendered text)", () => {
  function renderWith(date) {
    return render(
      <NotificationPopup notifications={[{ id: 1, type: 0, keyword: "k", created_at: date }]}
        onMarkAllRead={() => {}} onClose={() => {}} />,
    );
  }
  it("just now (<1 min)", () => {
    const { getByText } = renderWith(new Date().toISOString());
    expect(getByText("Just now")).toBeInTheDocument();
  });
  it("Nm ago (<60 min)", () => {
    const { getByText } = renderWith(new Date(Date.now() - 60_000 * 30).toISOString());
    expect(getByText("30m ago")).toBeInTheDocument();
  });
  it("Nh ago (<24h)", () => {
    const { getByText } = renderWith(new Date(Date.now() - 60_000 * 60 * 5).toISOString());
    expect(getByText("5h ago")).toBeInTheDocument();
  });
  it("Nd ago (>=24h)", () => {
    const { getByText } = renderWith(new Date(Date.now() - 60_000 * 60 * 24 * 3).toISOString());
    expect(getByText("3d ago")).toBeInTheDocument();
  });
  it("falsy date → '' (no time text)", () => {
    const { container } = renderWith(null);
    expect(container.querySelector("[class*='text-theme-text-muted']")).not.toBeNull();
  });
});
