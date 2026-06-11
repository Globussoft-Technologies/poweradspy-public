import { describe, it, expect, vi, beforeEach } from "vitest";

function makeThunk(typePrefix) {
  return {
    pending: { type: `${typePrefix}/pending` },
    fulfilled: { type: `${typePrefix}/fulfilled` },
    rejected: { type: `${typePrefix}/rejected` },
  };
}

vi.mock("../../../src/store/actions/powerAdsPyActionsApi", () => ({
  fetchAdsFromAffiliateplatforms: makeThunk("p/fetchAdsFromAffiliateplatforms"),
  fetchAdsFromEcommerceplatforms: makeThunk("p/fetchAdsFromEcommerceplatforms"),
  fetchAdsFromFunnel: makeThunk("p/fetchAdsFromFunnel"),
  fetchNetworksCountries: makeThunk("p/fetchNetworksCountries"),
  fetchNetworkTypesCount: makeThunk("p/fetchNetworkTypesCount"),
  fetchTiktokAdsCountryCount: makeThunk("p/fetchTiktokAdsCountryCount"),
  fetchAccountDetails: makeThunk("p/fetchAccountDetails"),
  fetchSystemDetails: makeThunk("p/fetchSystemDetails"),
  fetchPerticularSystemDetails: makeThunk("p/fetchPerticularSystemDetails"),
  fetchPerticularSystemAccountDetails: makeThunk("p/fetchPerticularSystemAccountDetails"),
  fetchSystemInsites: makeThunk("p/fetchSystemInsites"),
  fetchSystemInfo: makeThunk("p/fetchSystemInfo"),
  fetchSystemInfoAccountsList: makeThunk("p/fetchSystemInfoAccountsList"),
  fetchSystemInfoAccounts: makeThunk("p/fetchSystemInfoAccounts"),
  fetchStatusSystemInfo: makeThunk("p/fetchStatusSystemInfo"),
  fetchStatusAccountInfo: makeThunk("p/fetchStatusAccountInfo"),
  fetchDomaninProcessDetails: makeThunk("p/fetchDomaninProcessDetails"),
}));

let reducer;
let actions;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import("../../../src/store/reducers/powerAdsPySlice");
  reducer = mod.default;
  actions = mod;
});

describe("store/reducers/powerAdsPySlice", () => {
  it("returns initial state", () => {
    const s = reducer(undefined, { type: "@@INIT" });
    expect(s.countData).toEqual([]);
    expect(s.error).toBeNull();
    expect(s.network).toBe("");
  });

  it("updateCountData reducer", () => {
    const s = reducer(undefined, actions.updateCountData([1, 2]));
    expect(s.countData).toEqual([1, 2]);
  });

  const simpleThunks = [
    ["p/fetchNetworkTypesCount", "countData", "loadingData"],
    ["p/fetchNetworksCountries", "countryData", "loadingData"],
    ["p/fetchTiktokAdsCountryCount", "countryData", "loadingData"],
    ["p/fetchAccountDetails", "accountData", "loadingData"],
    ["p/fetchDomaninProcessDetails", "domainProcessData", "loadingDomainsData"],
    ["p/fetchSystemDetails", "systemDetails", "loadingSystemData"],
    ["p/fetchPerticularSystemDetails", "perticularSystemDetails", "loadingAccoutData"],
    ["p/fetchPerticularSystemAccountDetails", "systemAccountDetails", "loadingAccoutData"],
    ["p/fetchSystemInfo", "SystemInfo", "loadingSystemInfo"],
    ["p/fetchSystemInfoAccounts", "SystemInfoAccount", "loadingSystemInfoAccount"],
    ["p/fetchSystemInfoAccountsList", "SystemInfoAccountLists", "loadingSystemInfoAccountLists"],
    ["p/fetchStatusSystemInfo", "StatusSystemInfo", "loadingStatusSystemInfo"],
    ["p/fetchStatusAccountInfo", "AccountInfo", "loadingStatusAccountInfo"],
  ];

  describe.each(simpleThunks)("%s pending/fulfilled/rejected", (typePrefix, field, loadingField) => {
    it("pending: loadingField=true", () => {
      const s = reducer(undefined, { type: `${typePrefix}/pending` });
      expect(s[loadingField]).toBe(true);
    });
    it("fulfilled: sets target field, clears loadingField", () => {
      const s = reducer({ [loadingField]: true }, { type: `${typePrefix}/fulfilled`, payload: "P" });
      expect(s[field]).toBe("P");
      expect(s[loadingField]).toBe(false);
    });
    it("rejected: sets error, clears loadingField", () => {
      const s = reducer({ [loadingField]: true }, { type: `${typePrefix}/rejected`, payload: "E" });
      expect(s.error).toBe("E");
      expect(s[loadingField]).toBe(false);
    });
  });

  describe("fetchSystemInsites: splits payload into detailsData + summary", () => {
    it("pending", () => {
      const s = reducer(undefined, { type: "p/fetchSystemInsites/pending" });
      expect(s.loadingSystemInsites).toBe(true);
    });
    it("fulfilled", () => {
      const s = reducer(undefined, {
        type: "p/fetchSystemInsites/fulfilled",
        payload: { detailsData: [{ a: 1 }], summary: { total: 5 } },
      });
      expect(s.SystemInsites).toEqual([{ a: 1 }]);
      expect(s.SystemInsitesAdsCount).toEqual({ total: 5 });
    });
    it("rejected", () => {
      const s = reducer(undefined, { type: "p/fetchSystemInsites/rejected", payload: "E" });
      expect(s.error).toBe("E");
    });
  });

  describe("fetchAdsFromFunnel: cursor stack management", () => {
    it("fulfilled with cursor + !isPrev: pushes cursor onto stack", () => {
      const s = reducer(undefined, {
        type: "p/fetchAdsFromFunnel/fulfilled",
        payload: { data: [1], searchAfter: "next", isPrev: false, cursor: "c1", network: "fb" },
      });
      expect(s.cursorStackForFunnel).toContain("c1");
      expect(s.nextCursorForFunnel).toBe("next");
      expect(s.network).toBe("fb");
    });
    it("fulfilled with isPrev: pops cursor stack", () => {
      const s = reducer(
        { cursorStackForFunnel: ["c1", "c2"], funnelData: [] },
        { type: "p/fetchAdsFromFunnel/fulfilled", payload: { data: [], isPrev: true } }
      );
      expect(s.cursorStackForFunnel).toEqual(["c1"]);
    });
    it("pending clears error", () => {
      const s = reducer({ error: "old" }, { type: "p/fetchAdsFromFunnel/pending" });
      expect(s.error).toBeNull();
    });
    it("fulfilled with no cursor and !isPrev: cursor stack untouched", () => {
      const s = reducer(undefined, {
        type: "p/fetchAdsFromFunnel/fulfilled",
        payload: { data: [], cursor: null, isPrev: false, network: "fb" },
      });
      expect(s.cursorStackForFunnel).toEqual([]);
    });
    it("rejected sets error", () => {
      const s = reducer(undefined, { type: "p/fetchAdsFromFunnel/rejected", payload: "E" });
      expect(s.error).toBe("E");
    });
  });

  describe("fetchAdsFromEcommerceplatforms: cursor stack management", () => {
    it("fulfilled with cursor + !isPrev: pushes onto Ecommerce stack", () => {
      const s = reducer(undefined, {
        type: "p/fetchAdsFromEcommerceplatforms/fulfilled",
        payload: { data: [], searchAfter: "next", isPrev: false, cursor: "c1", network: "ec" },
      });
      expect(s.cursorStackForEcommerce).toContain("c1");
    });
    it("fulfilled with isPrev: pops Ecommerce stack", () => {
      const s = reducer(
        { cursorStackForEcommerce: ["c1"], adsEcommerceplatFormsData: [] },
        { type: "p/fetchAdsFromEcommerceplatforms/fulfilled", payload: { isPrev: true } }
      );
      expect(s.cursorStackForEcommerce).toEqual([]);
    });
    it("pending clears error and sets loading", () => {
      const s = reducer({ error: "old" }, { type: "p/fetchAdsFromEcommerceplatforms/pending" });
      expect(s.error).toBeNull();
      expect(s.loadingData).toBe(true);
    });
    it("fulfilled with no cursor and !isPrev: Ecommerce stack untouched", () => {
      const s = reducer(undefined, {
        type: "p/fetchAdsFromEcommerceplatforms/fulfilled",
        payload: { cursor: null, isPrev: false },
      });
      expect(s.cursorStackForEcommerce).toEqual([]);
    });
    it("rejected sets error", () => {
      const s = reducer(undefined, { type: "p/fetchAdsFromEcommerceplatforms/rejected", payload: "E" });
      expect(s.error).toBe("E");
    });
  });

  describe("fetchAdsFromAffiliateplatforms: cursor stack management", () => {
    it("fulfilled with cursor + !isPrev: pushes onto Affiliate stack", () => {
      const s = reducer(undefined, {
        type: "p/fetchAdsFromAffiliateplatforms/fulfilled",
        payload: { data: [], searchAfter: "next", isPrev: false, cursor: "c1", network: "af" },
      });
      expect(s.cursorStackForAffiliateData).toContain("c1");
    });
    it("fulfilled with isPrev: pops Affiliate stack", () => {
      const s = reducer(
        { cursorStackForAffiliateData: ["c1"], adsAffiliateData: [] },
        { type: "p/fetchAdsFromAffiliateplatforms/fulfilled", payload: { isPrev: true } }
      );
      expect(s.cursorStackForAffiliateData).toEqual([]);
    });
    it("pending clears error and sets loading", () => {
      const s = reducer({ error: "old" }, { type: "p/fetchAdsFromAffiliateplatforms/pending" });
      expect(s.error).toBeNull();
      expect(s.loadingData).toBe(true);
    });
    it("fulfilled with no cursor and !isPrev: Affiliate stack untouched", () => {
      const s = reducer(undefined, {
        type: "p/fetchAdsFromAffiliateplatforms/fulfilled",
        payload: { cursor: null, isPrev: false },
      });
      expect(s.cursorStackForAffiliateData).toEqual([]);
    });
    it("rejected sets error", () => {
      const s = reducer(undefined, { type: "p/fetchAdsFromAffiliateplatforms/rejected", payload: "E" });
      expect(s.error).toBe("E");
    });
  });
});
