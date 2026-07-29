import { describe, expect, it } from "vitest";
import {
  getAffiliateNetworkLogo,
  normalizeAffiliateNetworkKey,
} from "../../src/utils/affiliateLogos";

describe("affiliate logo resolver", () => {
  it.each([
    "Pepperjam",
    "LinkConnector",
    "LeadDyno",
    "Jumbleberry",
    "GiddyUp",
    "A4D",
    "Madrivo",
    "Marketcall",
    "ClickBooth",
    "GuruMedia",
    "Cash_Network",
    "Clickdealer",
    "BuyGoods",
    "yaari_digital",
  ])("resolves the %s logo", (network) => {
    expect(getAffiliateNetworkLogo(network)).toBeTruthy();
  });

  it("normalizes spaces, underscores, hyphens, and punctuation", () => {
    expect(normalizeAffiliateNetworkKey("  Yaari-Digital  ")).toBe(
      "yaaridigital",
    );
    expect(getAffiliateNetworkLogo("Cash Network")).toBe(
      getAffiliateNetworkLogo("Cash_Network"),
    );
  });
});
