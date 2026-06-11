import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("../../src/components/CountLoder/CountLoder.module.css", () => ({
  default: { dotsContainer: "dotsContainer", dot: "dot" },
}));

import CountLoder from "../../src/components/CountLoder/CountLoder.jsx";

describe("CountLoder", () => {
  it("renders a section with five dot divs", () => {
    const { container } = render(<CountLoder />);
    expect(container.querySelector("section")).not.toBeNull();
    expect(container.querySelectorAll("div").length).toBe(5);
  });
});
