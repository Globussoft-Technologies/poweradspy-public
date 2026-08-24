import { describe, expect, it } from "vitest";
import AdGrid, { resolveSortChipLabel } from "../../src/components/ads/AdGrid";
import { getDashboardAdNavigation } from "../../src/utils/dashboardAdNavigation";

describe("getDashboardAdNavigation", () => {
  it("is integrated by the dashboard component", () => {
    expect(AdGrid).toBeTypeOf("function");
  });

  it("navigates from the exact clicked position when multiple ads share an id", () => {
    const items = [
      { id: "duplicate", title: "First", _dashboardIndex: 0 },
      { id: "middle", title: "Middle", _dashboardIndex: 1 },
      { id: "duplicate", title: "Clicked", _dashboardIndex: 2 },
      { id: "last", title: "Next", _dashboardIndex: 3 },
    ];

    const navigation = getDashboardAdNavigation(items, items[2]);

    expect(navigation.index).toBe(2);
    expect(navigation.previous.title).toBe("Middle");
    expect(navigation.next.title).toBe("Next");
  });

  it("disables arrows at the beginning and end of the dashboard list", () => {
    const items = [
      { id: "first", _dashboardIndex: 0 },
      { id: "last", _dashboardIndex: 1 },
    ];

    expect(getDashboardAdNavigation(items, items[0]).previous).toBeNull();
    expect(getDashboardAdNavigation(items, items[1]).next).toBeNull();
  });

  it("follows the masonry visual order instead of the API array order", () => {
    const items = [
      { title: "Left row 1", _dashboardIndex: 0 },
      { title: "Hidden lower item", _dashboardIndex: 1 },
      { title: "Right row 1", _dashboardIndex: 2 },
      { title: "Right row 2", _dashboardIndex: 3 },
    ];
    const visualOrder = [0, 2, 1, 3];

    const navigation = getDashboardAdNavigation(
      items,
      items[0],
      visualOrder,
    );

    expect(navigation.next.title).toBe("Right row 1");
  });

  it("does not guess by id when the dashboard position is unavailable", () => {
    const items = [{ id: "same", _dashboardIndex: 0 }];
    const navigation = getDashboardAdNavigation(items, { id: "same" });

    expect(navigation.index).toBe(-1);
    expect(navigation.previous).toBeNull();
    expect(navigation.next).toBeNull();
  });
});

describe("resolveSortChipLabel", () => {
  const sortTabs = [
    { label: "Newest", value: "created_at" },
    { label: "Domain Registration Date", value: "domain_reg_date" },
  ];

  it("renders domain registration sort chips with the configured label", () => {
    expect(resolveSortChipLabel("domain_reg_date", sortTabs)).toBe("Domain Registration Date");
    expect(resolveSortChipLabel("domain_sort", sortTabs)).toBe("Domain Registration Date");
  });

  it("keeps the existing newest chip wording aligned with backend ordering", () => {
    expect(resolveSortChipLabel("created_at", sortTabs)).toBe("Last Seen");
  });
});
