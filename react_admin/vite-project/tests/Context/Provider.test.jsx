import { describe, it, expect } from "vitest";
import React, { useContext } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import AdminContext from "../../src/Context/Context";
import AdminProvider from "../../src/Context/Provider";

function TestConsumer() {
  const ctx = useContext(AdminContext);
  return (
    <div>
      <span data-testid="filter">{ctx.searchdataFilterTable}</span>
      <span data-testid="sidebar">{ctx.sidebarOpen ? "open" : "closed"}</span>
      <button onClick={() => ctx.setsearchdataFilterTable(9)}>set-filter</button>
      <button onClick={() => ctx.setsidebarOpen(false)}>close-sidebar</button>
    </div>
  );
}

describe("Context/Provider > AdminProvider", () => {
  it("provides default values to children", () => {
    render(
      <AdminProvider>
        <TestConsumer />
      </AdminProvider>
    );
    expect(screen.getByTestId("filter").textContent).toBe("3");
    expect(screen.getByTestId("sidebar").textContent).toBe("open");
  });

  it("set functions update context state", () => {
    render(
      <AdminProvider>
        <TestConsumer />
      </AdminProvider>
    );
    fireEvent.click(screen.getByText("set-filter"));
    expect(screen.getByTestId("filter").textContent).toBe("9");
    fireEvent.click(screen.getByText("close-sidebar"));
    expect(screen.getByTestId("sidebar").textContent).toBe("closed");
  });
});
