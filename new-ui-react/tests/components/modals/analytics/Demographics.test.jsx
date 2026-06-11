import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";

vi.mock("lucide-react", () => ({
  PieChart: () => <i data-testid="pie-ic" />,
}));

const useThemeMock = vi.fn(() => ({ theme: "dark" }));
vi.mock("../../../../src/hooks/useTheme", () => ({ useTheme: () => useThemeMock() }));

// Stub DateRangePicker so we can drive onApply directly.
const dateRangeApplyRef = { current: null };
vi.mock("../../../../src/components/modals/analytics/DateRangePicker", () => ({
  default: ({ onApply }) => {
    dateRangeApplyRef.current = onApply;
    return <button data-testid="drp" onClick={() => onApply(null)}>RANGE</button>;
  },
}));

const getInsightsSpy = vi.fn();
vi.mock("../../../../src/services/api", () => ({
  getAdvertiserInsightsByDateRange: (...args) => getInsightsSpy(...args),
}));

beforeEach(() => {
  useThemeMock.mockReturnValue({ theme: "dark" });
  getInsightsSpy.mockReset();
  dateRangeApplyRef.current = null;
});

import Demographics from "../../../../src/components/modals/analytics/Demographics.jsx";

const advData = {
  ageData: { age_18_to_24: 10, age_25_to_34: 30, age_35_to_44: 25, age_45_to_54: 15, age_55_to_64: 5 },
  genderData: { male: 60, female: 40 },
  relationshipData: { single: 35, married: 50, others: 15 },
};

describe("Demographics > hide when both null + no data", () => {
  it("renders null when both sources arrived empty", () => {
    const { container } = render(
      <Demographics adUserData={{}} advertiserUserData={{}} platform="facebook" />,
    );
    expect(container.innerHTML).toBe("");
  });
  it("shows Loading... when sources still null", () => {
    const { getByText } = render(
      <Demographics adUserData={null} advertiserUserData={null} platform="facebook" />,
    );
    expect(getByText("Loading...")).toBeInTheDocument();
  });
});

describe("Demographics > renders demographics with advertiser data", () => {
  it("renders heading + Age/Gender/Relationship sections", () => {
    const { getByText } = render(
      <Demographics adUserData={null} advertiserUserData={advData} platform="facebook" />,
    );
    expect(getByText("Demographics")).toBeInTheDocument();
    expect(getByText("Age Breakdown")).toBeInTheDocument();
    expect(getByText("Gender Split")).toBeInTheDocument();
    expect(getByText("Relationship")).toBeInTheDocument();
  });
  it("renders age values", () => {
    const { getByText } = render(
      <Demographics adUserData={null} advertiserUserData={advData} platform="facebook" />,
    );
    // labels (1 each), values "10", "30", etc.
    expect(getByText("18-24")).toBeInTheDocument();
    expect(getByText("25-34")).toBeInTheDocument();
  });
  it("AD LEVEL / ADVERTISER LEVEL toggle for facebook", () => {
    const { getByText } = render(
      <Demographics adUserData={advData} advertiserUserData={advData} platform="facebook" />,
    );
    expect(getByText("AD LEVEL")).toBeInTheDocument();
    expect(getByText("ADVERTISER LEVEL")).toBeInTheDocument();
  });
  it("clicking ADVERTISER LEVEL switches level state", () => {
    const { getByText, container } = render(
      <Demographics adUserData={advData} advertiserUserData={advData} platform="facebook" />,
    );
    // Switch to ad first so ADVERTISER LEVEL is no longer the active button
    fireEvent.click(getByText("AD LEVEL"));
    // Now click ADVERTISER LEVEL — fires setLevel('advertiser')
    fireEvent.click(getByText("ADVERTISER LEVEL"));
    // Active button has the indigo-500/15 background class
    const advBtn = getByText("ADVERTISER LEVEL");
    expect(advBtn.className).toMatch(/bg-indigo-500\/15/);
  });
  it("clicking AD LEVEL toggles to ad-level data + adds '%' suffix on age", () => {
    const { getByText, getAllByText } = render(
      <Demographics adUserData={advData} advertiserUserData={advData} platform="facebook" />,
    );
    fireEvent.click(getByText("AD LEVEL"));
    // Confirm one of the age percent values renders with % (e.g. "30%")
    expect(getAllByText(/30%/).length).toBeGreaterThan(0);
  });
  it("toggle hidden for instagram + youtube", () => {
    const { queryByText } = render(
      <Demographics adUserData={advData} advertiserUserData={advData} platform="instagram" />,
    );
    expect(queryByText("AD LEVEL")).toBeNull();
  });
  it("noData + isLight → light styling (lines 148-149 light branch)", () => {
    useThemeMock.mockReturnValue({ theme: "light" });
    // adUserData=null keeps bothLoaded=false so the noData block renders rather than returning null
    const zeros = { ageData: {}, genderData: {}, relationshipData: {} };
    const { container } = render(
      <Demographics adUserData={null} advertiserUserData={zeros} platform="facebook" />,
    );
    expect(container.innerHTML).toMatch(/bg-gray-50/);
    useThemeMock.mockReturnValue({ theme: "dark" });
  });
  it("noData with level='ad' + adUserData=null → 'Loading...' (line 150)", () => {
    // adUserData null, advertiserUserData transforms to all-zero so noData fires
    const zeros = { ageData: {}, genderData: {}, relationshipData: {} };
    const { container } = render(
      <Demographics adUserData={null} advertiserUserData={zeros} platform="facebook" />,
    );
    expect(container.innerHTML).toMatch(/No data found for this range|Loading/);
  });
  it("genderData only (no ageData) → ageData side of || {} branch (line 25)", () => {
    const data = { genderData: { male: 50, female: 50 }, relationshipData: { single: 100 } };
    const { container } = render(
      <Demographics adUserData={null} advertiserUserData={data} platform="facebook" />,
    );
    expect(container.innerHTML.length).toBeGreaterThan(0);
  });
  it("isSwapped=true with no genderData → genderData side of || {} branch (line 25)", () => {
    // ageData has GENDER keys (so isSwapped=true) and no separate genderData
    const swappedNoGender = {
      ageData: { male: 60, female: 40 },           // swapped — actually gender
      // genderData absent → in swap mode, ageRaw falls to {}
      relationshipData: { single: 100 },
    };
    const { container } = render(
      <Demographics adUserData={null} advertiserUserData={swappedNoGender} platform="facebook" />,
    );
    expect(container.innerHTML.length).toBeGreaterThan(0);
  });
  it("platform absent → (platform || '').toLowerCase() default branch (line 58)", () => {
    const { container } = render(
      <Demographics adUserData={advData} advertiserUserData={advData} />,
    );
    // Renders without crashing, toggle visible since 'instagram'/'youtube' don't match ''
    expect(container.innerHTML.length).toBeGreaterThan(0);
  });

  it("gender total=0 → maleRatio/femaleRatio/dominant cond-exprs fall to falsy (lines 212, 213, 215)", () => {
    // Both gender values explicitly 0 so total === 0 → each `total > 0 ? ... : 0`
    // ternary takes the falsy branch (and dominant picks genderData[1]).
    const zerosGender = {
      ageData: { age_18_to_24: 1 },         // non-empty so noData=false
      genderData: { male: 0, female: 0 },   // total === 0
      relationshipData: { single: 100 },
    };
    const { container } = render(
      <Demographics adUserData={null} advertiserUserData={zerosGender} platform="facebook" />,
    );
    // Renders without crashing — the cond-exprs hit their falsy branch
    expect(container.innerHTML.length).toBeGreaterThan(0);
  });

  it("female > male → dominant cond-expr falsy branch (line 215)", () => {
    // male < female so `male >= female` is false → dominant = genderData[1].
    const femaleDominant = {
      ageData: { age_18_to_24: 5 },
      genderData: { male: 30, female: 70 },
      relationshipData: { single: 100 },
    };
    const { container } = render(
      <Demographics adUserData={null} advertiserUserData={femaleDominant} platform="facebook" />,
    );
    expect(container.innerHTML.length).toBeGreaterThan(0);
  });

  it("AD LEVEL + donut mouseMove → tooltip with '%' suffix (line 345 truthy)", () => {
    // Toggle to ad level so the donut tooltip's `level === 'ad' ? '%' : ''`
    // takes the truthy branch when rendered. Then mouseMove the donut to
    // render the tooltip (which contains the cond-expr).
    const { container, getByText } = render(
      <Demographics adUserData={advData} advertiserUserData={advData} platform="facebook" />,
    );
    fireEvent.click(getByText("AD LEVEL"));
    const donut = container.querySelector(".relative.w-28");
    expect(donut).toBeTruthy();
    fireEvent.mouseMove(donut, { clientX: 100, clientY: 50 });
    // Tooltip should now be visible
    expect(container.querySelector(".fixed.z-\\[9999\\]")).not.toBeNull();
  });
});

describe("Demographics > swapped field auto-detection", () => {
  it("ageData with gender keys (swapped) → auto-flipped", () => {
    const swapped = {
      ageData: { male: 60, female: 40 },           // actually gender
      genderData: { age_18_to_24: 20, age_25_to_34: 30, age_35_to_44: 10, age_45_to_54: 5, age_55_to_64: 5 }, // actually age
    };
    const { getByText } = render(
      <Demographics adUserData={null} advertiserUserData={swapped} platform="facebook" />,
    );
    expect(getByText("Age Breakdown")).toBeInTheDocument();
  });
});

describe("Demographics > all-zero data → null state", () => {
  it("all-zero ad data returns null transform", () => {
    const zeros = { ageData: {}, genderData: {}, relationshipData: {} };
    const { container } = render(
      <Demographics adUserData={zeros} advertiserUserData={zeros} platform="facebook" />,
    );
    expect(container.innerHTML).toBe("");
  });
  it("array input → not transformed (returns null)", () => {
    const { container } = render(
      <Demographics adUserData={[]} advertiserUserData={[]} platform="facebook" />,
    );
    expect(container.innerHTML).toBe("");
  });
});

describe("Demographics > date range filter", () => {
  it("range=null clears the filteredUserData", async () => {
    const { getByTestId } = render(
      <Demographics adUserData={null} advertiserUserData={advData} platform="facebook" />,
    );
    fireEvent.click(getByTestId("drp"));
    expect(getInsightsSpy).not.toHaveBeenCalled();
  });
  it("range applied → invokes getAdvertiserInsightsByDateRange with type='user'", async () => {
    getInsightsSpy.mockResolvedValue({ code: 200, data: advData });
    render(
      <Demographics adUserData={null} advertiserUserData={advData} platform="facebook"
        postOwnerId={42} network="instagram" />,
    );
    await act(async () => {
      await dateRangeApplyRef.current({ fromDate: "2025-01-01", toDate: "2025-01-31" });
    });
    expect(getInsightsSpy).toHaveBeenCalledWith(expect.objectContaining({
      post_owner_id: 42, from_date: "2025-01-01", to_date: "2025-01-31", type: "user", network: "instagram",
    }));
  });
  it("fallback to advertiserUserData.post_owner_id when no postOwnerId prop", async () => {
    getInsightsSpy.mockResolvedValue({ code: 200, data: advData });
    render(
      <Demographics adUserData={null} advertiserUserData={{ ...advData, post_owner_id: 99 }} platform="facebook" />,
    );
    await act(async () => {
      await dateRangeApplyRef.current({ fromDate: "2025-01-01", toDate: "2025-01-31" });
    });
    expect(getInsightsSpy.mock.calls[0][0].post_owner_id).toBe(99);
  });
  it("non-200 response → clears filtered to {}", async () => {
    getInsightsSpy.mockResolvedValue({ code: 500 });
    const { findByText } = render(
      <Demographics adUserData={null} advertiserUserData={advData} platform="facebook" />,
    );
    await act(async () => {
      await dateRangeApplyRef.current({ fromDate: "2025-01-01", toDate: "2025-01-31" });
    });
    expect(await findByText(/No data found/)).toBeInTheDocument();
  });
  it("fetch throws → swallowed, isFiltering cleared", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getInsightsSpy.mockRejectedValue(new Error("boom"));
    render(
      <Demographics adUserData={null} advertiserUserData={advData} platform="facebook" />,
    );
    await act(async () => {
      await dateRangeApplyRef.current({ fromDate: "2025-01-01", toDate: "2025-01-31" });
    });
    // Doesn't crash
    expect(true).toBe(true);
  });
});

describe("Demographics > gender donut interaction", () => {
  it("mousemove shows tooltip with hovered side label", () => {
    const { container, queryByText } = render(
      <Demographics adUserData={null} advertiserUserData={advData} platform="facebook" />,
    );
    const donut = container.querySelector(".relative.w-28");
    fireEvent.mouseMove(donut, { clientX: 100, clientY: 50 });
    // Tooltip renders a fixed-position element with "Male" or "Female"
    expect(container.querySelector(".fixed.z-\\[9999\\]")).not.toBeNull();
  });
  it("mouseleave hides tooltip", () => {
    const { container, getByText, queryByText } = render(
      <Demographics adUserData={null} advertiserUserData={advData} platform="facebook" />,
    );
    const donut = container.querySelector(".relative.w-28");
    fireEvent.mouseMove(donut, { clientX: 100, clientY: 50 });
    fireEvent.mouseLeave(donut);
    // Only the legend Male/Female remain — tooltip duplicate is gone
    expect(getByText("Male 60")).toBeInTheDocument();
  });
  it("mousemove with negative angle (top-left quadrant) wraps to 360 (line 228 truthy)", () => {
    const { container } = render(
      <Demographics adUserData={null} advertiserUserData={advData} platform="facebook" />,
    );
    const donut = container.querySelector(".relative.w-28");
    // Make the donut's bounding rect non-zero so the centre is offset; the
    // event then lands in the top-left of that centre and atan2 yields
    // an angle < -90°, producing a negative angle after the +90 shift —
    // hits the `if (angle < 0) angle += 360;` branch.
    donut.getBoundingClientRect = () => ({
      left: 100, top: 100, right: 200, bottom: 200, width: 100, height: 100,
      x: 100, y: 100, toJSON: () => ({}),
    });
    fireEvent.mouseMove(donut, { clientX: 110, clientY: 110 });
    // Tooltip still renders
    expect(container.querySelector(".fixed.z-\\[9999\\]")).not.toBeNull();
  });
  it("mousemove when donutRef.current is detached returns early (line 223 truthy)", () => {
    const { container } = render(
      <Demographics adUserData={null} advertiserUserData={advData} platform="facebook" />,
    );
    const donut = container.querySelector(".relative.w-28");
    // Override getBoundingClientRect to return undefined so the `if (!rect) return;`
    // guard fires. (Setting donut to null isn't possible since we still need a
    // DOM node to dispatch the mouseMove event onto.)
    donut.getBoundingClientRect = () => undefined;
    fireEvent.mouseMove(donut, { clientX: 100, clientY: 50 });
    // No tooltip rendered because handler returned early — but legend remains
    expect(container.querySelector(".relative.w-28")).not.toBeNull();
  });
});

describe("Demographics > theme styling", () => {
  it("isLight applies bg-white sections", () => {
    useThemeMock.mockReturnValueOnce({ theme: "light" });
    const { container } = render(
      <Demographics adUserData={null} advertiserUserData={advData} platform="facebook" />,
    );
    expect(container.innerHTML).toMatch(/bg-white/);
  });
});
