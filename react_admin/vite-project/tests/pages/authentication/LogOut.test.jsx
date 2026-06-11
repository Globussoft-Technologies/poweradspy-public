import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render } from "@testing-library/react";

const { cookieRemoveSpy, navigateSpy } = vi.hoisted(() => ({
  cookieRemoveSpy: vi.fn(),
  navigateSpy: vi.fn(),
}));

vi.mock("js-cookie", () => ({
  default: { remove: cookieRemoveSpy },
}));
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateSpy,
}));

import LogOut from "../../../src/pages/authentication/LogOut.jsx";

beforeEach(() => {
  cookieRemoveSpy.mockReset();
  navigateSpy.mockReset();
  localStorage.setItem("userId", "X");
  localStorage.setItem("misc", "Y");
});

describe("pages/authentication/LogOut", () => {
  it("removes token cookie, clears localStorage, and navigates to '/'", () => {
    const { container } = render(<LogOut />);
    expect(cookieRemoveSpy).toHaveBeenCalledWith("token", { path: "/" });
    expect(localStorage.getItem("userId")).toBeNull();
    expect(localStorage.getItem("misc")).toBeNull();
    expect(navigateSpy).toHaveBeenCalledWith("/");
    expect(container.innerHTML).toBe("");
  });
});
