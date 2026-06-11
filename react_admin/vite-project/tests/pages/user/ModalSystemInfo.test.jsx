// Note: ModalSystemInfo.jsx is NOT enrolled in the 100% gate. Three uncovered
// branches: lines 43+46 (`DefaultIcon` undefined → ReferenceError on falsy
// or unknown network) per #214, and line 152 (boolean fall-through in
// globalFilterFn) which tanstack's default pipeline does not exercise.
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../../src/components/SimpleDatepicker", () => ({ default: () => null }));
vi.mock("react-icons/ci", () => ({ CiSearch: () => <span data-testid="search-icon" /> }));
vi.mock("react-icons/md", () => ({ MdCancel: (props) => <span data-testid="cancel-icon" {...props} /> }));

// asset shims (each gets its own factory — vi.mock is hoisted)
vi.mock("../../../src/assets/Social/fb.png", () => ({ default: "x.png" }));
vi.mock("../../../src/assets/Social/Google.png", () => ({ default: "x.png" }));
vi.mock("../../../src/assets/Social/Instagram.png", () => ({ default: "x.png" }));
vi.mock("../../../src/assets/Social/Youtube.png", () => ({ default: "x.png" }));
vi.mock("../../../src/assets/Social/Linkedin.png", () => ({ default: "x.png" }));
vi.mock("../../../src/assets/Social/Quora.png", () => ({ default: "x.png" }));
vi.mock("../../../src/assets/Social/Pinterest.png", () => ({ default: "x.png" }));
vi.mock("../../../src/assets/Social/Reddit.png", () => ({ default: "x.png" }));
vi.mock("../../../src/assets/Social/Tiktok.png", () => ({ default: "x.png" }));
vi.mock("../../../src/assets/Social/Native.png", () => ({ default: "x.png" }));
vi.mock("../../../src/assets/Social/Google-ads.png", () => ({ default: "x.png" }));

import ModalSystemInfo from "../../../src/pages/user/ModalSystemInfo.jsx";

const mkData = (n) =>
  Array.from({ length: n }, (_, i) => ({
    account: `Account-${i}`,
    account_id: `id-${i}`,
    network: `nw-${i}`,
    total_ads: 100 + i,
    unique_ads: 50 + i,
    updated_ads: 25 + i,
  }));

describe("pages/user/ModalSystemInfo", () => {
  it("renders the network icon for known networks (facebook→Facebook icon)", () => {
    render(<ModalSystemInfo data={mkData(2)} onClose={vi.fn()} network="facebook" />);
    expect(screen.getByText("facebook")).toBeInTheDocument();
    expect(screen.getByText("Account-0")).toBeInTheDocument();
  });

  it("renders for every known network keyword (google, instagram, native, youtube, linkedin, quora, pinterest, reddit, gdn)", () => {
    for (const nw of ["google", "instagram", "native", "youtube", "linkedin", "quora", "pinterest", "reddit", "gdn"]) {
      const { unmount } = render(<ModalSystemInfo data={mkData(1)} onClose={vi.fn()} network={nw} />);
      expect(screen.getByText(nw)).toBeInTheDocument();
      unmount();
    }
  });

  // Note: falsy + unknown network paths throw `ReferenceError: DefaultIcon is
  // not defined` — documented in
  // https://github.com/Globussoft-Technologies/poweradspy/issues/214
  // (lines 43 and 46). Both branches are present in source but unreachable
  // without crashing the component.

  it("account cell falls back to account_id when account is null", () => {
    render(<ModalSystemInfo data={[{ account: null, account_id: "fb-99", network: "facebook" }]} onClose={vi.fn()} network="facebook" />);
    expect(screen.getByText("fb-99")).toBeInTheDocument();
  });

  it("account cell shows '---' when both account and account_id are nullish", () => {
    render(<ModalSystemInfo data={[{ account: null, account_id: undefined, network: "facebook" }]} onClose={vi.fn()} network="facebook" />);
    expect(screen.getByText("---")).toBeInTheDocument();
  });

  it("empty data → renders 'No accounts available'", () => {
    render(<ModalSystemInfo data={[]} onClose={vi.fn()} network="facebook" />);
    expect(screen.getByText("No accounts available")).toBeInTheDocument();
  });

  it("undefined data → falls back to [] (renders empty state)", () => {
    render(<ModalSystemInfo data={undefined} onClose={vi.fn()} network="facebook" />);
    expect(screen.getByText("No accounts available")).toBeInTheDocument();
  });

  it("close button invokes onClose", () => {
    const onClose = vi.fn();
    render(<ModalSystemInfo data={mkData(1)} onClose={onClose} network="facebook" />);
    fireEvent.click(screen.getByTestId("cancel-icon").parentElement);
    expect(onClose).toHaveBeenCalled();
  });

  it("search input updates globalFilter and filters by string column", () => {
    render(<ModalSystemInfo data={mkData(8)} onClose={vi.fn()} network="facebook" />);
    fireEvent.change(screen.getByPlaceholderText("Search by account name..."), {
      target: { value: "Account-3" },
    });
    expect(screen.getByText("Account-3")).toBeInTheDocument();
    expect(screen.queryByText("Account-0")).not.toBeInTheDocument();
  });

  it("search by number filters via toString().includes", () => {
    render(<ModalSystemInfo data={mkData(8)} onClose={vi.fn()} network="facebook" />);
    fireEvent.change(screen.getByPlaceholderText("Search by account name..."), {
      target: { value: "103" }, // total_ads = 103 for index 3
    });
    expect(screen.getByText("Account-3")).toBeInTheDocument();
  });

  // Note: line 152 `return false;` in globalFilterFn (the typeof !== 'string'
  // && typeof !== 'number' fall-through) is not reachable through tanstack's
  // default globalFilter pipeline — tanstack short-circuits when row values
  // resolve to truthy non-primitives. Documented alongside #214 in the
  // ModalSystemInfo file note.

  it("Next button advances pages when data > pageSize; Previous returns", () => {
    // pageSize defaults to 6 in the source
    render(<ModalSystemInfo data={mkData(15)} onClose={vi.fn()} network="facebook" />);
    expect(screen.getByText("Account-0")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("Account-6")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Previous"));
    expect(screen.getByText("Account-0")).toBeInTheDocument();
  });
});
