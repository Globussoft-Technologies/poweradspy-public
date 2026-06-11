import { describe, it, expect, vi, beforeEach } from "vitest";

const { createRootSpy, renderSpy } = vi.hoisted(() => {
  const renderSpy = vi.fn();
  const createRootSpy = vi.fn(() => ({ render: renderSpy }));
  return { createRootSpy, renderSpy };
});

vi.mock("react-dom/client", () => ({ default: { createRoot: createRootSpy } }));
vi.mock("../src/i18n.js", () => ({ default: { t: vi.fn() } }));
vi.mock("../src/App.jsx", () => ({ default: () => null }));
vi.mock("../src/hooks/useTheme.jsx", () => ({ ThemeProvider: ({ children }) => children }));
vi.mock("../src/hooks/useAuth.jsx", () => ({ AuthProvider: ({ children }) => children }));
vi.mock("react-redux", () => ({ Provider: ({ children }) => children }));
vi.mock("redux-persist/integration/react", () => ({ PersistGate: ({ children }) => children }));
vi.mock("react-router-dom", () => ({ BrowserRouter: ({ children }) => children }));
vi.mock("react-i18next", () => ({ I18nextProvider: ({ children }) => children }));
vi.mock("../src/store/store.js", () => ({ store: {}, persistor: {} }));
vi.mock("../src/index.css", () => ({}));

beforeEach(() => {
  vi.resetModules();
  createRootSpy.mockClear();
  renderSpy.mockClear();
  document.body.innerHTML = `<div id="root"></div>`;
});

describe("main.jsx bootstrap", () => {
  it("suppresses Google Translate badge on import", async () => {
    document.body.innerHTML = `<div id="root"></div><div class="VIpgJd-x"></div><div id="goog-gt-tt"></div>`;
    await import("../src/main.jsx");
    const vipEl = document.querySelector('[class*="VIpgJd"]');
    expect(vipEl.style.getPropertyValue("display")).toBe("none");
    const ggEl = document.getElementById("goog-gt-tt");
    expect(ggEl.style.getPropertyValue("display")).toBe("none");
  });
  it("MutationObserver re-hides GT badges added later", async () => {
    await import("../src/main.jsx");
    const late = document.createElement("div");
    late.className = "VIpgJd-late";
    document.documentElement.appendChild(late);
    await new Promise((r) => setTimeout(r, 5));
    expect(late.style.getPropertyValue("display")).toBe("none");
  });
  it("creates root on #root and renders the App tree", async () => {
    await import("../src/main.jsx");
    expect(createRootSpy).toHaveBeenCalled();
    const rootEl = createRootSpy.mock.calls[0][0];
    expect(rootEl.id).toBe("root");
    expect(renderSpy).toHaveBeenCalled();
  });
});
