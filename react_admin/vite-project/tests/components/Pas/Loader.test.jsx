import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

// App.css is a side-effect import — no-op in tests
vi.mock("../../../src/App.css", () => ({}));

import Loader from "../../../src/components/Pas/Loader.jsx";

describe("Loader", () => {
  it("renders the loader div", () => {
    const { container } = render(<Loader />);
    expect(container.querySelector(".loader")).not.toBeNull();
  });
  it("wraps loader in a centered flex container", () => {
    const { container } = render(<Loader />);
    expect(container.firstChild.className).toMatch(/flex.*justify-center.*items-center/);
  });
});
