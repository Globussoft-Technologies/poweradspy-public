import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";

const { cookieGetSpy } = vi.hoisted(() => ({ cookieGetSpy: vi.fn() }));

vi.mock("js-cookie", () => ({
  default: { get: cookieGetSpy },
}));
vi.mock("react-router-dom", () => ({
  Navigate: ({ to }) => <div data-testid="navigate" data-to={to} />,
}));

import AuthCheck from "../../../src/pages/authentication/AuthCheck.jsx";

beforeEach(() => {
  cookieGetSpy.mockReset();
});

describe("pages/authentication/AuthCheck", () => {
  it("renders children when a token cookie exists", () => {
    cookieGetSpy.mockReturnValueOnce("a-token");
    render(<AuthCheck><div data-testid="child" /></AuthCheck>);
    expect(screen.getByTestId("child")).toBeInTheDocument();
    expect(cookieGetSpy).toHaveBeenCalledWith("token");
  });

  it("Navigates to '/' when no token cookie", () => {
    cookieGetSpy.mockReturnValueOnce(undefined);
    render(<AuthCheck><div data-testid="child" /></AuthCheck>);
    expect(screen.queryByTestId("child")).not.toBeInTheDocument();
    expect(screen.getByTestId("navigate").dataset.to).toBe("/");
  });
});
