import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";

import DomainProcessCountTable from "../../../src/pages/user/DomainProcessTable.jsx";

beforeEach(() => {
  // silence the console.log in useEffect
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("pages/user/DomainProcessTable", () => {
  it("loading=true → renders 5 skeleton rows", () => {
    const { container } = render(
      <DomainProcessCountTable loading={true} domains={[]} />
    );
    const animated = container.querySelectorAll(".animate-pulse");
    expect(animated.length).toBe(15); // 5 rows × 3 cells
  });

  it("loading=false + non-empty domains → renders one row per domain", () => {
    render(
      <DomainProcessCountTable
        loading={false}
        domains={[
          { network: "fb", total_domain_date_updated: 5, total_lander_ad_processed: 10 },
          { network: "ig", total_domain_date_updated: 1, total_lander_ad_processed: 2 },
        ]}
      />
    );
    expect(screen.getByText("fb")).toBeInTheDocument();
    expect(screen.getByText("ig")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
  });

  it("loading=false + empty domains → renders 'No Domains found' empty state", () => {
    render(<DomainProcessCountTable loading={false} domains={[]} />);
    expect(screen.getByText("No Domains found")).toBeInTheDocument();
  });

  it("loading=false + nullish domains → empty state", () => {
    render(<DomainProcessCountTable loading={false} domains={null} />);
    expect(screen.getByText("No Domains found")).toBeInTheDocument();
  });

  it("useEffect: setDomainList only when domains truthy AND not loading (loading=true short-circuits)", () => {
    render(
      <DomainProcessCountTable
        loading={true}
        domains={[
          { network: "x", total_domain_date_updated: 1, total_lander_ad_processed: 2 },
        ]}
      />
    );
    // skeleton rows still rendered (state never updated to actual list)
    expect(screen.queryByText("x")).not.toBeInTheDocument();
  });
});
