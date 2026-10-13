import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, within } from "@testing-library/react";

vi.mock("lucide-react", () => ({
  AlertCircle: () => <i data-testid="alert-ic" />,
  Bell: () => <i data-testid="bell-ic" />,
  Globe: () => <i data-testid="globe-ic" />,
  RefreshCw: () => <i data-testid="refresh-ic" />,
  Search: () => <i data-testid="search-ic" />,
  Sparkle: () => <i data-testid="sparkle-ic" />,
  User: () => <i data-testid="user-ic" />,
}));

import NotificationPopup from "../../../src/components/layout/NotificationPopup.jsx";

// Fixed "now" (13 Oct 2026, 3:00 PM local) so TODAY/YESTERDAY/EARLIER grouping
// never depends on what time of day the suite runs. Only Date is faked —
// floating-ui's positioning still uses real timers.
const NOW = new Date(2026, 9, 13, 15, 0, 0);
const minsAgo = (m) => new Date(NOW.getTime() - m * 60_000).toISOString();

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

/** Keyword/advertiser/domain notifications as useNotifications provides them:
 * `notifications` = unread (server only returns unread), `allNotifications` = session list. */
function renderKeyword(list, props = {}) {
  return render(
    <NotificationPopup
      notifications={list.filter((n) => !n.read)}
      allNotifications={list}
      onMarkAllRead={() => {}}
      onClose={() => {}}
      {...props}
    />,
  );
}

describe("NotificationPopup — keyword / advertiser / domain search notifications", () => {
  it("type=0 → keyword row: title, 'Keyword' label, time", () => {
    const { getByText } = renderKeyword([{ id: 1, type: 0, keyword: "shoes", created_at: minsAgo(12) }]);
    expect(getByText("New ads found for “shoes”")).toBeInTheDocument();
    expect(getByText("Keyword · 12 min ago")).toBeInTheDocument();
  });
  it("type=1 → 'Advertiser' label", () => {
    const { getByText } = renderKeyword([{ id: 1, type: 1, keyword: "Nike", created_at: minsAgo(5) }]);
    expect(getByText("New ads found for “Nike”")).toBeInTheDocument();
    expect(getByText("Advertiser · 5 min ago")).toBeInTheDocument();
  });
  it("type=2 → 'Domain' label", () => {
    const { getByText } = renderKeyword([{ id: 1, type: 2, keyword: "nike.com", created_at: minsAgo(5) }]);
    expect(getByText("Domain · 5 min ago")).toBeInTheDocument();
  });
  it("unknown type → falls back to 'Keyword'", () => {
    const { getByText } = renderKeyword([{ id: 1, type: 99, keyword: "k", created_at: minsAgo(5) }]);
    expect(getByText("Keyword · 5 min ago")).toBeInTheDocument();
  });
  it("clicking a keyword notification fires onNotificationClick with it", () => {
    const onNotificationClick = vi.fn();
    const notif = { id: 7, type: 1, keyword: "Nike", network: "facebook", created_at: minsAgo(3) };
    const { getByText } = renderKeyword([notif], { onNotificationClick });
    fireEvent.click(getByText("New ads found for “Nike”"));
    expect(onNotificationClick).toHaveBeenCalledTimes(1);
    expect(onNotificationClick.mock.calls[0][0]).toMatchObject({ id: 7, keyword: "Nike", network: "facebook" });
  });
  it("Enter key on a keyword row also opens it", () => {
    const onNotificationClick = vi.fn();
    const { getByText } = renderKeyword([{ id: 1, type: 0, keyword: "shoes", created_at: minsAgo(3) }], { onNotificationClick });
    fireEvent.keyDown(getByText("New ads found for “shoes”").closest(".np-it"), { key: "Enter" });
    expect(onNotificationClick).toHaveBeenCalledTimes(1);
  });
  it("unread row is highlighted and shows the unread dot; read row doesn't", () => {
    const { getByText } = renderKeyword([
      { id: 1, type: 0, keyword: "new", created_at: minsAgo(2) },
      { id: 2, type: 0, keyword: "old", created_at: minsAgo(9), read: true },
    ]);
    const unreadRow = getByText("New ads found for “new”").closest(".np-it");
    const readRow = getByText("New ads found for “old”").closest(".np-it");
    expect(unreadRow).toHaveClass("unread");
    expect(unreadRow.querySelector(".np-unread-dot")).not.toBeNull();
    expect(readRow).not.toHaveClass("unread");
    expect(readRow.querySelector(".np-unread-dot")).toBeNull();
  });
  it("'Mark all as read' shows only with unread items and fires onMarkAllRead", () => {
    const onMarkAllRead = vi.fn();
    const { getByText } = renderKeyword([{ id: 1, type: 0, keyword: "k", created_at: minsAgo(1) }], { onMarkAllRead });
    fireEvent.click(getByText("Mark all as read"));
    expect(onMarkAllRead).toHaveBeenCalledTimes(1);
  });
  it("no unread → no 'Mark all as read'", () => {
    const { queryByText } = renderKeyword([{ id: 1, type: 0, keyword: "k", created_at: minsAgo(1), read: true }]);
    expect(queryByText("Mark all as read")).toBeNull();
  });
  it("Unread tab shows the count and only unread items", () => {
    const { getByText, queryByText } = renderKeyword([
      { id: 1, type: 0, keyword: "new", created_at: minsAgo(2) },
      { id: 2, type: 0, keyword: "old", created_at: minsAgo(9), read: true },
    ]);
    fireEvent.click(getByText("Unread · 1"));
    expect(getByText("New ads found for “new”")).toBeInTheDocument();
    expect(queryByText("New ads found for “old”")).toBeNull();
  });
  it("Unread tab label without a count when nothing is unread", () => {
    const { getByText } = renderKeyword([{ id: 1, type: 0, keyword: "k", created_at: minsAgo(1), read: true }]);
    expect(getByText("Unread")).toBeInTheDocument();
  });
  it("empty → 'You're all caught up'", () => {
    const { getByText } = renderKeyword([]);
    expect(getByText("You're all caught up")).toBeInTheDocument();
  });
  it("no 'View all in MySpace' footer", () => {
    const { queryByText } = renderKeyword([{ id: 1, type: 0, keyword: "k", created_at: minsAgo(1) }]);
    expect(queryByText(/View all in MySpace/)).toBeNull();
  });
  it("no onNotificationClick → clicking is a no-op (no throw)", () => {
    const { getByText } = renderKeyword([{ id: 1, type: 0, keyword: "shoes", created_at: minsAgo(1) }]);
    expect(() => fireEvent.click(getByText("New ads found for “shoes”"))).not.toThrow();
  });
});

describe("NotificationPopup — grouping and time format", () => {
  it("TODAY: 'Just now' / 'N min ago' / 'N h ago'", () => {
    const { getByText } = renderKeyword([
      { id: 1, type: 0, keyword: "a", created_at: minsAgo(0) },
      { id: 2, type: 0, keyword: "b", created_at: minsAgo(30) },
      { id: 3, type: 0, keyword: "c", created_at: minsAgo(5 * 60) },
    ]);
    expect(getByText("TODAY")).toBeInTheDocument();
    expect(getByText("Keyword · Just now")).toBeInTheDocument();
    expect(getByText("Keyword · 30 min ago")).toBeInTheDocument();
    expect(getByText("Keyword · 5 h ago")).toBeInTheDocument();
  });
  it("YESTERDAY: time only", () => {
    const { getByText } = renderKeyword([{ id: 1, type: 0, keyword: "a", created_at: new Date(2026, 9, 12, 18, 15).toISOString() }]);
    expect(getByText("YESTERDAY")).toBeInTheDocument();
    expect(getByText("Keyword · 6:15 PM")).toBeInTheDocument();
  });
  it("EARLIER: 'Oct 10, 6:15 PM'", () => {
    const { getByText } = renderKeyword([{ id: 1, type: 0, keyword: "a", created_at: new Date(2026, 9, 10, 18, 15).toISOString() }]);
    expect(getByText("EARLIER")).toBeInTheDocument();
    expect(getByText("Keyword · Oct 10, 6:15 PM")).toBeInTheDocument();
  });
  it("keyword and AI Recreate notifications are merged newest-first", () => {
    const { getAllByText } = render(
      <NotificationPopup
        notifications={[{ id: 1, type: 0, keyword: "older", created_at: minsAgo(20) }]}
        allNotifications={[{ id: 1, type: 0, keyword: "older", created_at: minsAgo(20) }]}
        imageGenNotifications={[{ id: "n1", job_id: "j1", status: "succeeded", read: false, created_at: minsAgo(2), data: { advertiser: "Acme" } }]}
        onMarkAllRead={() => {}} onClose={() => {}}
      />,
    );
    const titles = getAllByText((_, el) => el?.classList?.contains("np-title")).map((el) => el.textContent);
    expect(titles).toEqual(["Your ad is ready", "New ads found for “older”"]);
  });
});

describe("NotificationPopup — AI Recreate notifications", () => {
  const base = { id: "n1", job_id: "j1", read: false, created_at: minsAgo(4), data: { advertiser: "Acme" } };
  it("success: 'Your ad is ready' + '{advertiser} · {time}'", () => {
    const { getByText } = render(<NotificationPopup notifications={[]} imageGenNotifications={[{ ...base, status: "succeeded" }]} onMarkAllRead={() => {}} onClose={() => {}} />);
    expect(getByText("Your ad is ready")).toBeInTheDocument();
    expect(getByText("Acme · 4 min ago")).toBeInTheDocument();
  });
  it("failed: title + 'Credit refunded' pill + inline Try again", () => {
    const onImageGenTryAgain = vi.fn();
    const onImageGenNotificationClick = vi.fn();
    const { getByText } = render(
      <NotificationPopup notifications={[]} imageGenNotifications={[{ ...base, status: "failed" }]}
        onImageGenTryAgain={onImageGenTryAgain} onImageGenNotificationClick={onImageGenNotificationClick}
        onMarkAllRead={() => {}} onClose={() => {}} />,
    );
    const row = getByText("Credit refunded").closest(".np-it");
    expect(within(row).getByText(/Generation failed/)).toBeInTheDocument();
    fireEvent.click(within(row).getByText("Try again"));
    expect(onImageGenTryAgain).toHaveBeenCalledTimes(1);
    expect(onImageGenNotificationClick).not.toHaveBeenCalled(); // Try again doesn't also open the row
  });
});
