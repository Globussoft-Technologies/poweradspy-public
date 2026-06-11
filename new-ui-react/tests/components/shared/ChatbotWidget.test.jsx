import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import ChatbotWidget from "../../../src/components/shared/ChatbotWidget.jsx";

beforeEach(() => {
  // Clean DOM
  document.getElementById("Freshchat-js-sdk")?.remove();
  // Stub fcWidget
  window.fcWidget = { init: vi.fn(), destroy: vi.fn() };
});

describe("ChatbotWidget", () => {
  it("renders null (no DOM markup)", () => {
    const { container } = render(<ChatbotWidget />);
    expect(container.innerHTML).toBe("");
  });
  it("first mount: injects Freshchat script tag", () => {
    render(<ChatbotWidget />);
    const script = document.getElementById("Freshchat-js-sdk");
    expect(script).not.toBeNull();
    expect(script.src).toContain("freshchat.com/js/widget.js");
    expect(script.async).toBe(true);
  });
  it("second mount: reuses existing script + calls init directly", () => {
    render(<ChatbotWidget />);
    const init = window.fcWidget.init;
    init.mockClear();
    render(<ChatbotWidget />);
    expect(init).toHaveBeenCalled();
  });
  it("script.onload triggers init", () => {
    render(<ChatbotWidget />);
    const script = document.getElementById("Freshchat-js-sdk");
    script.onload();
    expect(window.fcWidget.init).toHaveBeenCalled();
  });
  it("unmount calls fcWidget.destroy", () => {
    const { unmount } = render(<ChatbotWidget />);
    unmount();
    expect(window.fcWidget.destroy).toHaveBeenCalled();
  });
  it("unmount swallows destroy errors", () => {
    window.fcWidget.destroy = vi.fn(() => { throw new Error("oops"); });
    const { unmount } = render(<ChatbotWidget />);
    expect(() => unmount()).not.toThrow();
  });
  it("unmount with no fcWidget.destroy → skipped", () => {
    window.fcWidget = {}; // no destroy
    const { unmount } = render(<ChatbotWidget />);
    expect(() => unmount()).not.toThrow();
  });
  it("unmount with no fcWidget at all → skipped", () => {
    delete window.fcWidget;
    const { unmount } = render(<ChatbotWidget />);
    expect(() => unmount()).not.toThrow();
  });
});
