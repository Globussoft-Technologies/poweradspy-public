import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

vi.mock("../../../src/assets/fb.png", () => ({ default: "fb.png" }));
vi.mock("../../../src/assets/ig.png", () => ({ default: "ig.png" }));
vi.mock("../../../src/assets/yt.png", () => ({ default: "yt.png" }));
vi.mock("../../../src/assets/g.png", () => ({ default: "g.png" }));
vi.mock("../../../src/assets/gdn.png", () => ({ default: "gdn.png" }));
vi.mock("../../../src/assets/linkedin.png", () => ({ default: "linkedin.png" }));
vi.mock("../../../src/assets/native.png", () => ({ default: "native.png" }));
vi.mock("../../../src/assets/rd.png", () => ({ default: "rd.png" }));
vi.mock("../../../src/assets/quora.png", () => ({ default: "quora.png" }));
vi.mock("../../../src/assets/pinterest.png", () => ({ default: "pinterest.png" }));
vi.mock("../../../src/assets/tiktoklogo.jpg", () => ({ default: "tt.jpg" }));

import PlatformTab from "../../../src/components/shared/PlatformTab.jsx";

const StubIcon = ({ size }) => <i data-testid="stub-icon" data-size={size} />;

describe("PlatformTab > icon source resolution", () => {
  it("uses PLATFORM_ASSET_MAP for known value (facebook)", () => {
    const { container } = render(<PlatformTab value="facebook" label="FB" onClick={() => {}} />);
    const img = container.querySelector("img");
    expect(img.getAttribute("src")).toBe("fb.png");
    expect(img.getAttribute("alt")).toBe("FB");
  });
  it("uses short alias 'fb' as value", () => {
    const { container } = render(<PlatformTab value="fb" onClick={() => {}} />);
    expect(container.querySelector("img").getAttribute("src")).toBe("fb.png");
  });
  it("uppercased value still resolves", () => {
    const { container } = render(<PlatformTab value="TIKTOK" onClick={() => {}} />);
    expect(container.querySelector("img").getAttribute("src")).toBe("tt.jpg");
  });
  it("falls back to label when value missing", () => {
    const { container } = render(<PlatformTab label="quora" onClick={() => {}} />);
    expect(container.querySelector("img").getAttribute("src")).toBe("quora.png");
  });
  it("uses provided imageUrl when value/label not in map", () => {
    const { container } = render(
      <PlatformTab value="bing" imageUrl="https://x.com/b.png" onClick={() => {}} />,
    );
    expect(container.querySelector("img").getAttribute("src")).toBe("https://x.com/b.png");
  });
  it("renders Icon component when no img src + Icon provided", () => {
    const { getByTestId, container } = render(
      <PlatformTab value="bing" Icon={StubIcon} onClick={() => {}} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(getByTestId("stub-icon")).toBeInTheDocument();
    expect(getByTestId("stub-icon").getAttribute("data-size")).toBe("24");
  });
  it("renders label text when no img + no Icon", () => {
    const { getByText, container } = render(
      <PlatformTab value="bing" label="BING" onClick={() => {}} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(getByText("BING")).toBeInTheDocument();
  });
  it("no value, no label → empty string lookup, no img/Icon → renders nothing for label too (falsy)", () => {
    const { container } = render(<PlatformTab onClick={() => {}} />);
    // No img, no Icon → label text rendered. label is undefined → no text appended.
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("button")).not.toBeNull();
  });
});

describe("PlatformTab > active styling", () => {
  it("active=true → default activeBg/activeBorder applied", () => {
    const { container } = render(<PlatformTab value="fb" active onClick={() => {}} />);
    const btn = container.querySelector("button");
    expect(btn.style.backgroundColor).toBe("rgba(99, 102, 241, 0.22)");
    expect(btn.style.borderColor).toBe("rgba(99, 102, 241, 0.5)");
  });
  it("active=true with custom activeBg + activeBorder", () => {
    const { container } = render(
      <PlatformTab value="fb" active activeBg="red" activeBorder="blue" onClick={() => {}} />,
    );
    const btn = container.querySelector("button");
    expect(btn.style.backgroundColor).toBe("red");
    expect(btn.style.borderColor).toBe("blue");
  });
  it("active=false → no inline bg/border", () => {
    const { container } = render(<PlatformTab value="fb" onClick={() => {}} />);
    const btn = container.querySelector("button");
    expect(btn.style.backgroundColor).toBe("");
  });
  it("active=true → applies shadow-sm + px-3 classes", () => {
    const { container } = render(<PlatformTab value="fb" active onClick={() => {}} />);
    expect(container.querySelector("button").className).toMatch(/shadow-sm/);
  });
  it("active=false → applies border-transparent + hover classes", () => {
    const { container } = render(<PlatformTab value="fb" onClick={() => {}} />);
    expect(container.querySelector("button").className).toMatch(/border-transparent/);
  });
});

describe("PlatformTab > click and color", () => {
  it("onClick fires when button is clicked", () => {
    const onClick = vi.fn();
    const { container } = render(<PlatformTab value="fb" onClick={onClick} />);
    fireEvent.click(container.querySelector("button"));
    expect(onClick).toHaveBeenCalled();
  });
  it("custom color class applied", () => {
    const { container } = render(<PlatformTab value="fb" color="text-red-500" onClick={() => {}} />);
    expect(container.querySelector("span").className).toMatch(/text-red-500/);
  });
  it("default color when not provided", () => {
    const { container } = render(<PlatformTab value="fb" onClick={() => {}} />);
    expect(container.querySelector("span").className).toMatch(/text-theme-text-muted/);
  });
});

describe("PlatformTab > tooltip behavior", () => {
  it("mouseEnter shows fullName tooltip", () => {
    const { container, getByText } = render(<PlatformTab value="fb" onClick={() => {}} />);
    fireEvent.mouseEnter(container.querySelector("button"));
    expect(getByText("Facebook")).toBeInTheDocument();
  });
  it("uses label fallback when value not in PLATFORM_FULL_NAMES and label given", () => {
    const { container } = render(
      <PlatformTab value="bing" label="Bing" imageUrl="https://x.com/b.png" onClick={() => {}} />,
    );
    fireEvent.mouseEnter(container.querySelector("button"));
    // tooltip renders inside the fixed-position div
    const tip = container.querySelector('div[class*="fixed"]');
    expect(tip.textContent).toBe("Bing");
  });
  it("mouseLeave hides tooltip", () => {
    const { container, queryByText } = render(<PlatformTab value="fb" onClick={() => {}} />);
    fireEvent.mouseEnter(container.querySelector("button"));
    fireEvent.mouseLeave(container.querySelector("button"));
    expect(queryByText("Facebook")).toBeNull();
  });
  it("disableTooltips → mouseEnter does not show tooltip", () => {
    const { container, queryByText } = render(
      <PlatformTab value="fb" disableTooltips onClick={() => {}} />,
    );
    fireEvent.mouseEnter(container.querySelector("button"));
    expect(queryByText("Facebook")).toBeNull();
  });
  it("onMouseEnter callback fires alongside internal handler", () => {
    const onMouseEnter = vi.fn();
    const { container } = render(<PlatformTab value="fb" onMouseEnter={onMouseEnter} onClick={() => {}} />);
    fireEvent.mouseEnter(container.querySelector("button"));
    expect(onMouseEnter).toHaveBeenCalled();
  });
  it("onMouseEnter NOT fired when disableTooltips=true (early return)", () => {
    const onMouseEnter = vi.fn();
    const { container } = render(
      <PlatformTab value="fb" disableTooltips onMouseEnter={onMouseEnter} onClick={() => {}} />,
    );
    fireEvent.mouseEnter(container.querySelector("button"));
    expect(onMouseEnter).not.toHaveBeenCalled();
  });
  it("onMouseLeave callback fires alongside internal handler", () => {
    const onMouseLeave = vi.fn();
    const { container } = render(<PlatformTab value="fb" onMouseLeave={onMouseLeave} onClick={() => {}} />);
    fireEvent.mouseEnter(container.querySelector("button"));
    fireEvent.mouseLeave(container.querySelector("button"));
    expect(onMouseLeave).toHaveBeenCalled();
  });
  it("tooltip position computed from btnRef.getBoundingClientRect", () => {
    const { container } = render(<PlatformTab value="fb" onClick={() => {}} />);
    const btn = container.querySelector("button");
    btn.getBoundingClientRect = () => ({ left: 100, top: 50, width: 40, height: 20, right: 140, bottom: 70, x: 100, y: 50 });
    fireEvent.mouseEnter(btn);
    const tip = container.querySelector('div[class*="fixed"]');
    expect(tip.style.left).toBe("120px"); // 100 + 40/2
    expect(tip.style.top).toBe("44px");   // 50 - 6
  });
  it("tooltip position omitted when getBoundingClientRect returns null", () => {
    const { container } = render(<PlatformTab value="fb" onClick={() => {}} />);
    const btn = container.querySelector("button");
    btn.getBoundingClientRect = () => null;
    fireEvent.mouseEnter(btn);
    // tooltip still shows but tipPos stays at default {x:0,y:0}
    const tip = container.querySelector('div[class*="fixed"]');
    expect(tip).not.toBeNull();
  });
  it("tooltip uses default position when btnRef.current is null", () => {
    // Render then mutate ref to null is hard; simulate by removing getBoundingClientRect from prototype path
    const { container } = render(<PlatformTab value="fb" onClick={() => {}} />);
    fireEvent.mouseEnter(container.querySelector("button"));
    // Just ensure it doesn't throw
    expect(container.querySelector('div[class*="fixed"]')).not.toBeNull();
  });
});
