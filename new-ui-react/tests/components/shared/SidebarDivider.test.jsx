import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import SidebarDivider from "../../../src/components/shared/SidebarDivider.jsx";

describe("SidebarDivider", () => {
  it("renders a divider div", () => {
    const { container } = render(<SidebarDivider />);
    expect(container.querySelector("div.border-t")).not.toBeNull();
  });
});
