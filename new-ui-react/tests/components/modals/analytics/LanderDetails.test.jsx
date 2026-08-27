import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";

vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    ExternalLink: () => <i data-testid="extlink-ic" />,
    ShieldCheck: () => <i data-testid="shield-ic" />,
    Monitor: () => <i data-testid="mon-ic" />,
    MessageCircle: () => <i data-testid="msg-ic" />,
    Phone: () => <i data-testid="phone-ic" />,
    Maximize2: () => <i data-testid="maximize-ic" />,
    Download: () => <i data-testid="download-ic" />,
    X: () => <i data-testid="close-ic" />,
  };
});

const useThemeMock = vi.fn(() => ({ theme: "dark" }));
vi.mock("../../../../src/hooks/useTheme", () => ({ useTheme: () => useThemeMock() }));

import LanderDetails from "../../../../src/components/modals/analytics/LanderDetails.jsx";

beforeEach(() => {
  vi.restoreAllMocks();
  useThemeMock.mockReturnValue({ theme: "dark" });
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LanderDetails", () => {
  it("returns null when screenshotUrl falsy (processing)", () => {
    const { container } = render(<LanderDetails screenshotUrl="" />);
    expect(container.innerHTML).toBe("");
  });

  it("returns null when screenshotUrl includes 'processing.gif'", () => {
    const { container } = render(<LanderDetails screenshotUrl="/x/processing.gif" />);
    expect(container.innerHTML).toBe("");
  });

  it("returns null when screenshotUrl includes '[null]'", () => {
    const { container } = render(<LanderDetails screenshotUrl="[null]" />);
    expect(container.innerHTML).toBe("");
  });

  it("renders with absolute http URL", () => {
    const { getByText, getByAltText } = render(
      <LanderDetails screenshotUrl="http://x.com/img.png" />,
    );
    expect(getByText("Lander Details")).toBeInTheDocument();
    expect(getByAltText("Lander Screenshot").src).toBe("http://x.com/img.png");
  });

  it("parses JSON array string and uses first entry", () => {
    const { getByAltText } = render(
      <LanderDetails screenshotUrl='["http://x.com/first.png"]' />,
    );
    expect(getByAltText("Lander Screenshot").src).toBe("http://x.com/first.png");
  });

  it("invalid JSON array falls through to raw string", () => {
    const { getByAltText } = render(
      <LanderDetails screenshotUrl="[malformed" />,
    );
    expect(getByAltText("Lander Screenshot").src).toContain("[malformed");
  });

  it("empty JSON array still parses and renders the screenshot area", () => {
    const { getByAltText } = render(
      <LanderDetails screenshotUrl="[]" />,
    );
    expect(getByAltText("Lander Screenshot")).toBeInTheDocument();
  });

  it("absolute path (leading /) prepends NAS base", () => {
    const { getByAltText } = render(
      <LanderDetails screenshotUrl="/path/img.png" />,
    );
    expect(getByAltText("Lander Screenshot").src).toContain("/path/img.png");
  });

  it("relative path (no leading /) prepends NAS base with a slash", () => {
    const { getByAltText } = render(
      <LanderDetails screenshotUrl="path/img.png" />,
    );
    expect(getByAltText("Lander Screenshot").src).toContain("/path/img.png");
  });

  it("protocol-relative URL is preserved as a media URL", () => {
    const { getByAltText } = render(
      <LanderDetails screenshotUrl="//cdn.example/x.png" />,
    );
    expect(getByAltText("Lander Screenshot").src).toContain("cdn.example/x.png");
  });

  it("Visit link points to the resolved URL", () => {
    const { getByText } = render(
      <LanderDetails screenshotUrl="http://x.com/y.png" />,
    );
    expect(getByText("Visit").closest("a").href).toBe("http://x.com/y.png");
  });

  it("renders a Download button beside Preview", () => {
    const { getByText } = render(
      <LanderDetails screenshotUrl="http://x.com/y.png" />,
    );
    expect(getByText("Preview")).toBeInTheDocument();
    expect(getByText("Download")).toBeInTheDocument();
  });

  it("renders a WhatsApp subsection with rotator count and deduped phone numbers", () => {
    const { getByText, queryAllByText } = render(
      <LanderDetails
        screenshotUrl="http://x.com/y.png"
        whatsappRotatorCount={2}
        whatsappEntries={[
          { phone: "917340407207", countrty: "IN" },
          { url: "https://wa.me/+917340407207?text=Hi" },
          { phone: "918810993624", country: "IN" },
        ]}
      />,
    );

    expect(getByText("WhatsApp Details")).toBeInTheDocument();
    expect(getByText("Rotator Count")).toBeInTheDocument();
    expect(getByText("2")).toBeInTheDocument();
    expect(queryAllByText("+91 73404 07207")).toHaveLength(1);
    expect(getByText("+91 88109 93624")).toBeInTheDocument();
  });

  it("falls back to a prefixed value when a number cannot be fully parsed", () => {
    const { getByText } = render(
      <LanderDetails
        screenshotUrl="http://x.com/y.png"
        whatsappRotatorCount={1}
        whatsappEntries={[
          { phone: "12345" },
        ]}
      />,
    );

    expect(getByText("+12345")).toBeInTheDocument();
  });

  it("hides the phone numbers field when the rotator count is zero", () => {
    const { getByText, queryByText } = render(
      <LanderDetails
        screenshotUrl="http://x.com/y.png"
        whatsappRotatorCount={0}
        whatsappEntries={[]}
      />,
    );

    expect(getByText("WhatsApp Details")).toBeInTheDocument();
    expect(queryByText("Phone Numbers Found")).not.toBeInTheDocument();
  });

  it("downloads the lander screenshot through the image proxy with a clean filename", async () => {
    const blob = new Blob(["lander"], { type: "image/png" });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      blob: async () => blob,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const createObjectURL = vi.fn(() => "blob:lander");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(window.URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: createObjectURL,
    });
    Object.defineProperty(window.URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: revokeObjectURL,
    });

    const appendSpy = vi.spyOn(document.body, "appendChild");
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const { getByText } = render(
      <LanderDetails screenshotUrl="http://x.com/folder/lander-shot.png" downloadId={2084} />,
    );

    fireEvent.click(getByText("Download"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/common/image-proxy?url=http%3A%2F%2Fx.com%2Ffolder%2Flander-shot.png"),
        { headers: {} },
      );
    });
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(appendSpy).toHaveBeenCalled();
    expect(appendSpy.mock.calls.at(-1)?.[0]?.download).toBe("lander-2084.png");
    expect(clickSpy).toHaveBeenCalled();
    await waitFor(() => {
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:lander");
    });
  });

  it("img onError triggers null render on next render cycle", () => {
    const { getByAltText, container } = render(
      <LanderDetails screenshotUrl="http://x.com/y.png" />,
    );
    fireEvent.error(getByAltText("Lander Screenshot"));
    expect(container.innerHTML).toBe("");
  });

  it("returns null when the screenshot payload resolves to a non-string entry", () => {
    const { container } = render(<LanderDetails screenshotUrl="[123]" />);
    expect(container.innerHTML).toBe("");
  });

  it("light theme applies bg-white styling", () => {
    useThemeMock.mockReturnValueOnce({ theme: "light" });
    const { container } = render(
      <LanderDetails screenshotUrl="http://x.com/y.png" />,
    );
    expect(container.innerHTML).toMatch(/bg-white/);
  });
});
