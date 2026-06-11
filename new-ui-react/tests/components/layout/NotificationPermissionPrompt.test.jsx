import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";

vi.mock("lucide-react", () => ({
  Bell: () => <i data-testid="bell-ic" />,
  X: () => <i data-testid="x-ic" />,
  Check: () => <i data-testid="check-ic" />,
}));

const pushState = { current: {
  isSupported: true,
  permission: "default",
  requestPermissionAndRegister: vi.fn(),
  error: null,
}};
vi.mock("../../../src/hooks/usePushNotifications", () => ({
  usePushNotifications: () => pushState.current,
}));

import NotificationPermissionPrompt from "../../../src/components/layout/NotificationPermissionPrompt.jsx";

beforeEach(() => {
  pushState.current = {
    isSupported: true, permission: "default",
    requestPermissionAndRegister: vi.fn().mockResolvedValue(true),
    error: null,
  };
});

describe("NotificationPermissionPrompt", () => {
  it("renders when isSupported + permission='default'", () => {
    const { getByText } = render(<NotificationPermissionPrompt />);
    expect(getByText("Get Instant Notifications")).toBeInTheDocument();
  });
  it("returns null when isSupported=false", () => {
    pushState.current.isSupported = false;
    const { container } = render(<NotificationPermissionPrompt />);
    expect(container.innerHTML).toBe("");
  });
  it("returns null when permission='granted'", () => {
    pushState.current.permission = "granted";
    const { container } = render(<NotificationPermissionPrompt />);
    expect(container.innerHTML).toBe("");
  });
  it("returns null when permission='denied'", () => {
    pushState.current.permission = "denied";
    const { container } = render(<NotificationPermissionPrompt />);
    expect(container.innerHTML).toBe("");
  });
  it("Enable click → requestPermissionAndRegister, on success dismisses", async () => {
    const { getByText, container } = render(<NotificationPermissionPrompt />);
    await act(async () => {
      fireEvent.click(getByText("Enable"));
      await Promise.resolve();
    });
    expect(pushState.current.requestPermissionAndRegister).toHaveBeenCalled();
    expect(container.innerHTML).toBe("");
  });
  it("Enable click failure → prompt stays visible", async () => {
    pushState.current.requestPermissionAndRegister.mockResolvedValue(false);
    const { getByText } = render(<NotificationPermissionPrompt />);
    await act(async () => {
      fireEvent.click(getByText("Enable"));
      await Promise.resolve();
    });
    expect(getByText("Enable")).toBeInTheDocument();
  });
  it("Enable shows 'Enabling...' while in-flight", async () => {
    let resolve;
    pushState.current.requestPermissionAndRegister = vi.fn(() => new Promise((r) => { resolve = r; }));
    const { getByText, queryByText } = render(<NotificationPermissionPrompt />);
    fireEvent.click(getByText("Enable"));
    expect(getByText("Enabling...")).toBeInTheDocument();
    await act(async () => { resolve(true); });
    expect(queryByText("Enabling...")).toBeNull();
  });
  it("Later button dismisses without enabling", () => {
    const { getByText, container } = render(<NotificationPermissionPrompt />);
    fireEvent.click(getByText("Later"));
    expect(container.innerHTML).toBe("");
    expect(pushState.current.requestPermissionAndRegister).not.toHaveBeenCalled();
  });
  it("X button dismisses", () => {
    const { getByTestId, container } = render(<NotificationPermissionPrompt />);
    fireEvent.click(getByTestId("x-ic").closest("button"));
    expect(container.innerHTML).toBe("");
  });
  it("renders error message when error present", () => {
    pushState.current.error = "Permission denied";
    const { getByText } = render(<NotificationPermissionPrompt />);
    expect(getByText(/Permission denied/)).toBeInTheDocument();
  });
});
