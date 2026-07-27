import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import PlanLockedSection from "../../../src/components/shared/PlanLockedSection.jsx";

describe("PlanLockedSection", () => {
  it("does not place protected content in the DOM and shows the upgrade action when denied", () => {
    const onUpgrade = vi.fn();
    const { getByRole, getByText, queryByText } = render(
      <PlanLockedSection allowed={false} title="SERP slot mix" onUpgrade={onUpgrade}>
        <div>SECRET SERP DATA</div>
      </PlanLockedSection>,
    );

    expect(queryByText("SECRET SERP DATA")).toBeNull();
    expect(getByText("SERP slot mix")).toBeTruthy();
    fireEvent.click(getByRole("button", { name: /upgrade plan/i }));
    expect(onUpgrade).toHaveBeenCalledTimes(1);
  });

  it("renders the real content without an upgrade action when allowed", () => {
    const { getByText, queryByRole } = render(
      <PlanLockedSection allowed title="SERP slot mix">
        <div>ALLOWED SERP DATA</div>
      </PlanLockedSection>,
    );

    expect(getByText("ALLOWED SERP DATA")).toBeTruthy();
    expect(queryByRole("button", { name: /upgrade plan/i })).toBeNull();
  });
});
