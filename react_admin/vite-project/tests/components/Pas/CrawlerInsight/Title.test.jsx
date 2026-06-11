import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("react-icons/fi", () => ({
  FiInfo: () => <i data-testid="info-ic" />,
}));

import Title from "../../../../src/components/Pas/CrawlerInsight/Title.jsx";

describe("Title", () => {
  it("renders title text + tooltipText + info icon", () => {
    const { getByText, getByTestId } = render(
      <Title className="header" title="Hello" tooltipText="Helpful tip" />,
    );
    expect(getByText("Hello")).toBeInTheDocument();
    expect(getByText("Helpful tip")).toBeInTheDocument();
    expect(getByTestId("info-ic")).toBeInTheDocument();
  });
  it("applies the passed className to outer container", () => {
    const { container } = render(
      <Title className="my-header" title="X" tooltipText="Y" />,
    );
    expect(container.firstChild.className).toBe("my-header");
  });
});
