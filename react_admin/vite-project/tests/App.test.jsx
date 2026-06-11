import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("../src/App.css", () => ({}));

vi.mock("react-router-dom", () => ({
  RouterProvider: ({ router }) => (
    <div data-testid="router-provider" data-router={typeof router} />
  ),
}));

vi.mock("../src/routes/index", () => ({
  routes: { __isRouter: true, routes: [] },
}));

vi.mock("../src/Context/Provider", () => ({
  default: ({ children }) => <div data-testid="admin-provider">{children}</div>,
}));

import App from "../src/App.jsx";

describe("App", () => {
  it("renders AdminProvider wrapping RouterProvider", () => {
    const { getByTestId } = render(<App />);
    const provider = getByTestId("admin-provider");
    expect(provider).toBeInTheDocument();
    expect(provider.querySelector('[data-testid="router-provider"]')).not.toBeNull();
  });
  it("passes the routes object to RouterProvider", () => {
    const { getByTestId } = render(<App />);
    // RouterProvider mock records that it received a router prop of type 'object'
    expect(getByTestId("router-provider").getAttribute("data-router")).toBe("object");
  });
});
