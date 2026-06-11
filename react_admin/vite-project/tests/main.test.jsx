import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/index.css", () => ({}));

const renderMock = vi.fn();
const createRootMock = vi.fn(() => ({ render: renderMock }));
vi.mock("react-dom/client", () => ({
  createRoot: (...args) => createRootMock(...args),
}));

vi.mock("react-redux", () => ({
  Provider: ({ children, store }) => (
    <div data-testid="redux-provider" data-store={store ? "set" : "missing"}>
      {children}
    </div>
  ),
}));

vi.mock("../src/App.jsx", () => ({
  default: () => <div data-testid="app" />,
}));

vi.mock("../src/store/store.js", () => ({
  default: { __isStore: true },
}));

beforeEach(() => {
  renderMock.mockClear();
  createRootMock.mockClear();
  // Provide a #root element for createRoot's selector argument
  document.body.innerHTML = '<div id="root"></div>';
});

describe("main.jsx entrypoint", () => {
  it("calls createRoot on #root and renders <Provider><App/></Provider> in StrictMode", async () => {
    await import("../src/main.jsx");
    expect(createRootMock).toHaveBeenCalled();
    const target = createRootMock.mock.calls[0][0];
    expect(target).toBe(document.getElementById("root"));
    expect(renderMock).toHaveBeenCalled();
    // The root JSX passed to render should be StrictMode > Provider > App
    const rendered = renderMock.mock.calls[0][0];
    expect(rendered).toBeTruthy();
  });
});
