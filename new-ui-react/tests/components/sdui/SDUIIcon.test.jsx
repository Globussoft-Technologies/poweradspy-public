import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import SDUIIcon from "../../../src/components/sdui/SDUIIcon.jsx";

describe("SDUIIcon", () => {
  it("returns null when icon is falsy", () => {
    const { container } = render(<SDUIIcon icon={null} />);
    expect(container.innerHTML).toBe("");
  });
  it("returns null when type='none'", () => {
    const { container } = render(<SDUIIcon icon={{ type: "none", value: "x" }} />);
    expect(container.innerHTML).toBe("");
  });
  it("returns null when value missing", () => {
    const { container } = render(<SDUIIcon icon={{ type: "svg" }} />);
    expect(container.innerHTML).toBe("");
  });
  it("type='svg' renders inline SVG via dangerouslySetInnerHTML", () => {
    const { container } = render(<SDUIIcon icon={{ type: "svg", value: "<circle/>" }} />);
    expect(container.innerHTML).toContain("<circle");
  });
  it("type='svg' respects size + className", () => {
    const { container } = render(
      <SDUIIcon icon={{ type: "svg", value: "<x/>" }} size={20} className="custom" />,
    );
    const span = container.querySelector("span");
    expect(span.style.width).toBe("20px");
    expect(span.style.height).toBe("20px");
    expect(span.className).toMatch(/custom/);
  });
  it("type='url' renders an <img>", () => {
    const { container } = render(
      <SDUIIcon icon={{ type: "url", value: "http://x/icon.png" }} size={18} />,
    );
    const img = container.querySelector("img");
    expect(img.src).toBe("http://x/icon.png");
    expect(img.width).toBe(18);
    expect(img.height).toBe(18);
  });
  it("type='url' applies className", () => {
    const { container } = render(
      <SDUIIcon icon={{ type: "url", value: "x" }} className="extra" />,
    );
    expect(container.querySelector("img").className).toMatch(/extra/);
  });
  it("unknown type returns null", () => {
    const { container } = render(<SDUIIcon icon={{ type: "weird", value: "x" }} />);
    expect(container.innerHTML).toBe("");
  });
});
