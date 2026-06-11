import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const { getAuthTokenSpy } = vi.hoisted(() => ({
  getAuthTokenSpy: vi.fn(() => "tk"),
}));

vi.mock("../../src/hooks/useAuth", () => ({
  getAuthToken: getAuthTokenSpy,
}));

function makeReader(chunks) {
  let i = 0;
  return {
    read: vi.fn(async () => {
      if (i >= chunks.length) return { done: true, value: undefined };
      const out = { done: false, value: new TextEncoder().encode(chunks[i]) };
      i++;
      return out;
    }),
  };
}

function makeSseResponse(chunks, { ok = true, status = 200 } = {}) {
  return {
    ok, status,
    body: { getReader: () => makeReader(chunks) },
  };
}

let useAdInsights;
beforeEach(async () => {
  vi.resetModules();
  getAuthTokenSpy.mockReset().mockReturnValue("tk");
  globalThis.fetch = vi.fn();
  ({ useAdInsights } = await import("../../src/hooks/useAdInsights.js"));
});

describe("useAdInsights > adId absent", () => {
  it("returns initial state, no fetch", () => {
    const { result } = renderHook(() => useAdInsights(null, "facebook"));
    expect(result.current.loading).toBe(false);
    expect(result.current.insights.adDetails).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("useAdInsights > happy path streaming", () => {
  it("posts to the SSE endpoint with correct body", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeSseResponse([
      'event: adDetails\ndata: {"code":200,"data":{"id":1}}\n\n',
      'event: done\ndata: {}\n\n',
    ]));
    renderHook(() => useAdInsights("ad-1", "instagram", 7, "es"));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const call = globalThis.fetch.mock.calls[0];
    expect(call[0]).toMatch(/getAdInsights/);
    expect(call[1].method).toBe("POST");
    const body = JSON.parse(call[1].body);
    expect(body.network).toBe("instagram");
    expect(body.instagram_ad_id).toBe("ad-1");
    expect(body.user_id).toBe(7);
    expect(body.language).toBe("es");
  });

  it("sets insights state from successful events + meta key", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeSseResponse([
      'event: adDetails\ndata: {"code":200,"data":{"id":1,"title":"x"}}\n\n',
    ]));
    const { result } = renderHook(() => useAdInsights("a1"));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(result.current.insights.adDetails).toEqual({ id: 1, title: "x" });
    expect(result.current.insights.adDetailsMeta).toBeDefined();
  });

  it("done event → loading=false", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeSseResponse([
      'event: done\ndata: {}\n\n',
    ]));
    const { result } = renderHook(() => useAdInsights("a1"));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(result.current.loading).toBe(false);
  });

  it("adsLibUserData event → maps to advertiserUserData state key", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeSseResponse([
      'event: adsLibUserData\ndata: {"code":200,"data":{"x":1}}\n\n',
    ]));
    const { result } = renderHook(() => useAdInsights("a1"));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(result.current.insights.advertiserUserData).toEqual({ x: 1 });
  });

  it("error code on adDetails → notFound + notFoundForId set", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeSseResponse([
      'event: adDetails\ndata: {"code":404,"data":null,"message":"Not found"}\n\n',
    ]));
    const { result } = renderHook(() => useAdInsights("missing-id"));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(result.current.notFound).toBe(true);
    expect(result.current.notFoundForId).toBe("missing-id");
    expect(result.current.errors.adDetails).toBe("Not found");
  });

  it("error code on non-adDetails → notFound stays false", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeSseResponse([
      'event: analytics\ndata: {"code":500,"data":null}\n\n',
    ]));
    const { result } = renderHook(() => useAdInsights("a1"));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(result.current.notFound).toBe(false);
    expect(result.current.errors.analytics).toBe("No data");
  });

  it("error data=[] → state becomes []", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeSseResponse([
      'event: outgoingLinks\ndata: {"code":500,"data":[]}\n\n',
    ]));
    const { result } = renderHook(() => useAdInsights("a1"));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(result.current.insights.outgoingLinks).toEqual([]);
  });

  it("error data=null → state becomes []", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeSseResponse([
      'event: pageDetails\ndata: {"code":500,"data":null}\n\n',
    ]));
    const { result } = renderHook(() => useAdInsights("a1"));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(result.current.insights.pageDetails).toEqual([]);
  });

  it("error with object data → state becomes the object", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeSseResponse([
      'event: country\ndata: {"code":500,"data":{"x":1}}\n\n',
    ]));
    const { result } = renderHook(() => useAdInsights("a1"));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(result.current.insights.country).toEqual({ x: 1 });
  });

  it("malformed JSON in event data → ignored", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeSseResponse([
      'event: adDetails\ndata: not-json\n\n',
    ]));
    const { result } = renderHook(() => useAdInsights("a1"));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(result.current.insights.adDetails).toBeNull();
  });

  it("chunk without event line → skipped", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeSseResponse([
      'data: {"x":1}\n\n',
    ]));
    const { result } = renderHook(() => useAdInsights("a1"));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(result.current.insights.adDetails).toBeNull();
  });

  it("chunk without data line → skipped", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeSseResponse([
      'event: adDetails\n\n',
    ]));
    const { result } = renderHook(() => useAdInsights("a1"));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(result.current.insights.adDetails).toBeNull();
  });

  it("multiple events in one chunk are all processed", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeSseResponse([
      'event: adDetails\ndata: {"code":200,"data":{"id":1}}\n\nevent: analytics\ndata: {"code":200,"data":{"v":2}}\n\n',
    ]));
    const { result } = renderHook(() => useAdInsights("a1"));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(result.current.insights.adDetails).toEqual({ id: 1 });
    expect(result.current.insights.analytics).toEqual({ v: 2 });
  });

  it("incomplete chunk: 'event:' alone in last chunk → kept in buffer, no parse", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeSseResponse([
      'event: adDetails\ndata: {"code":200,"data":{"id":1}}\n\nevent: incomplete',
    ]));
    const { result } = renderHook(() => useAdInsights("a1"));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(result.current.insights.adDetails).toEqual({ id: 1 });
  });
});

describe("useAdInsights > error paths", () => {
  it("non-ok response → loading=false, no parsing", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 500, body: null });
    const { result } = renderHook(() => useAdInsights("a1"));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(result.current.loading).toBe(false);
  });

  it("fetch throws non-Abort → loading=false", async () => {
    globalThis.fetch.mockRejectedValueOnce(new Error("net-down"));
    const { result } = renderHook(() => useAdInsights("a1"));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(result.current.loading).toBe(false);
  });

  it("fetch throws AbortError → loading STAYS true (effect cleanup case)", async () => {
    const err = new Error("aborted"); err.name = "AbortError";
    globalThis.fetch.mockRejectedValueOnce(err);
    const { result } = renderHook(() => useAdInsights("a1"));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    // The branch `if (err.name !== 'AbortError')` is false; setLoading(false) not called
    expect(result.current.loading).toBe(true);
  });

  it("aborts in-flight fetch when component unmounts", async () => {
    let abortedSignal = false;
    globalThis.fetch.mockImplementation((_, opts) => {
      opts.signal.addEventListener("abort", () => { abortedSignal = true; });
      return new Promise(() => {}); // never resolves
    });
    const { unmount } = renderHook(() => useAdInsights("a1"));
    await act(async () => { await Promise.resolve(); });
    unmount();
    expect(abortedSignal).toBe(true);
  });

  it("changing adId triggers a fresh fetch and resets insights", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(makeSseResponse([
        'event: adDetails\ndata: {"code":200,"data":{"id":1}}\n\nevent: done\ndata: {}\n\n',
      ]))
      .mockResolvedValueOnce(makeSseResponse([
        'event: adDetails\ndata: {"code":200,"data":{"id":2}}\n\nevent: done\ndata: {}\n\n',
      ]));
    const { result, rerender } = renderHook(({ id }) => useAdInsights(id), {
      initialProps: { id: "a1" },
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(result.current.insights.adDetails).toEqual({ id: 1 });
    rerender({ id: "a2" });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(result.current.insights.adDetails).toEqual({ id: 2 });
  });

  it("unknown network → falls back to facebook_ad_id field", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeSseResponse(['event: done\ndata: {}\n\n']));
    renderHook(() => useAdInsights("a1", "twitter"));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.facebook_ad_id).toBe("a1");
  });

  it("network undefined → defaults to facebook in body", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeSseResponse(['event: done\ndata: {}\n\n']));
    renderHook(() => useAdInsights("a1", undefined));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.network).toBe("facebook");
  });

  it("network=null (falsy non-undefined) → || 'facebook' branch taken", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeSseResponse(['event: done\ndata: {}\n\n']));
    renderHook(() => useAdInsights("a1", null));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.network).toBe("facebook");
    expect(body.facebook_ad_id).toBe("a1");
  });
});

describe("useAdInsights > token env fallback", () => {
  it("getAuthToken returns falsy → falls back to VITE_PAS_API_TOKEN (line 5 branch)", async () => {
    vi.resetModules();
    getAuthTokenSpy.mockReturnValue(null);
    const mod = await import("../../src/hooks/useAdInsights.js");
    globalThis.fetch.mockResolvedValueOnce(makeSseResponse(['event: done\ndata: {}\n\n']));
    renderHook(() => mod.useAdInsights("a1", "facebook"));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(globalThis.fetch).toHaveBeenCalled();
  });
});
