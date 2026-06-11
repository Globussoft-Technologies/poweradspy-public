import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { axiosPostSpy, cookieSetSpy, cookieGetSpy, navigateSpy } = vi.hoisted(() => ({
  axiosPostSpy: vi.fn(),
  cookieSetSpy: vi.fn(),
  cookieGetSpy: vi.fn(),
  navigateSpy: vi.fn(),
}));

vi.mock("axios", () => ({ default: { post: axiosPostSpy } }));
vi.mock("js-cookie", () => ({ default: { set: cookieSetSpy, get: cookieGetSpy } }));
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateSpy,
}));
vi.mock("react-icons/ci", () => ({ CiMail: () => <span data-testid="mail-icon" /> }));
vi.mock("react-icons/fi", () => ({
  FiEye: (props) => <span data-testid="eye-icon" {...props} />,
  FiEyeOff: (props) => <span data-testid="eye-off-icon" {...props} />,
}));
vi.mock("../../../src/assets/PasLogoFull.png", () => ({ default: "pas-logo.png" }));

import Login from "../../../src/pages/authentication/Login.jsx";

beforeEach(() => {
  axiosPostSpy.mockReset();
  cookieSetSpy.mockReset();
  cookieGetSpy.mockReset();
  navigateSpy.mockReset();
  localStorage.clear();
  // silence console.error
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("pages/authentication/Login", () => {
  it("on mount: if a token cookie exists, navigates to lastPath", () => {
    cookieGetSpy.mockReturnValueOnce("a-token");
    localStorage.setItem("lastPath", "/pas/saved");
    render(<Login />);
    expect(navigateSpy).toHaveBeenCalledWith("/pas/saved", { replace: true });
  });

  it("on mount: if no token, no navigation; uses default '/pas/system-info' fallback", () => {
    cookieGetSpy.mockReturnValueOnce(undefined);
    render(<Login />);
    expect(navigateSpy).not.toHaveBeenCalled();
    // The `from` const fell back to '/pas/system-info' — verify by setting a token AFTER render won't work,
    // but we can re-render with token+no lastPath to hit the fallback path
  });

  it("on mount with token + no lastPath: uses '/pas/system-info' fallback", () => {
    cookieGetSpy.mockReturnValueOnce("a-token");
    render(<Login />);
    expect(navigateSpy).toHaveBeenCalledWith("/pas/system-info", { replace: true });
  });

  it("toggles password visibility (eye-off → eye → eye-off)", () => {
    render(<Login />);
    expect(screen.getByTestId("eye-off-icon")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("eye-off-icon"));
    expect(screen.getByTestId("eye-icon")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("eye-icon"));
    expect(screen.getByTestId("eye-off-icon")).toBeInTheDocument();
  });

  it("handleLogin success (code 200): sets token cookie, clears error, navigates", async () => {
    axiosPostSpy.mockResolvedValueOnce({
      data: { code: 200, token: "Bearer THE_TOKEN" },
    });
    render(<Login />);
    fireEvent.change(document.getElementById("amember-login"), { target: { value: "u@e.com" } });
    fireEvent.change(document.getElementById("amember-pass"), { target: { value: "pw" } });
    fireEvent.click(screen.getByDisplayValue("Login"));
    await waitFor(() => expect(axiosPostSpy).toHaveBeenCalled());
    const [url, body] = axiosPostSpy.mock.calls[0];
    expect(url).toMatch(/Login$/);
    expect(body).toEqual({ username: "u@e.com", password: "pw" });
    await waitFor(() => expect(cookieSetSpy).toHaveBeenCalledWith("token", "THE_TOKEN"));
    expect(navigateSpy).toHaveBeenCalledWith("/pas/system-info");
  });

  it("handleLogin failure (code != 200): sets error flag and shows error label", async () => {
    axiosPostSpy.mockResolvedValueOnce({ data: { code: 401 } });
    render(<Login />);
    fireEvent.click(screen.getByDisplayValue("Login"));
    await waitFor(() => expect(axiosPostSpy).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByText(/Username or password incorrect/)).toBeInTheDocument()
    );
    expect(cookieSetSpy).not.toHaveBeenCalled();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it("handleLogin: axios throws → caught and logged", async () => {
    axiosPostSpy.mockRejectedValueOnce(new Error("net"));
    render(<Login />);
    fireEvent.click(screen.getByDisplayValue("Login"));
    await waitFor(() => expect(axiosPostSpy).toHaveBeenCalled());
    await waitFor(() => expect(console.error).toHaveBeenCalled());
  });
});
