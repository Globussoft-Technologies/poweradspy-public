import afAwin from "../assets/afiliate_network/awin.png";
import afCj from "../assets/afiliate_network/cj.png";
import afClickbank from "../assets/afiliate_network/ClickBank.png";
import afClicksco from "../assets/afiliate_network/clicksco.png";
import afDigistore24 from "../assets/afiliate_network/digistore24.png";
import afImpact from "../assets/afiliate_network/impact.png";
import afMaxbounty from "../assets/afiliate_network/maxbounty.png";
import afPartnerstack from "../assets/afiliate_network/partnerstack.png";
import afRakuten from "../assets/afiliate_network/rakuten.png";
import afShareasale from "../assets/afiliate_network/shareasale.png";
import afAmazonAssociates from "../assets/afiliate_network/Amazon_Associates.png";
import afSkimlinks from "../assets/afiliate_network/SKIMLINKS.jpg";
import afRefersion from "../assets/afiliate_network/Refersion.webp";
import afVertoz from "../assets/afiliate_network/vertoz.jpg";
import afEbayPartnerNetwork from "../assets/afiliate_network/ebay_affiliate_network.png";
import afPepperjam from "../assets/afiliate_network/pepperjam.webp";
import afLinkConnector from "../assets/afiliate_network/linkconnector.png";
import afLeadDyno from "../assets/afiliate_network/leadDyno.webp";
import afJumbleberry from "../assets/afiliate_network/jumbleberry.png";
import afGiddyUp from "../assets/afiliate_network/GiddyUp.png";
import afA4d from "../assets/afiliate_network/a4d.png";
import afMadrivo from "../assets/afiliate_network/madrivo.webp";
import afMarketcall from "../assets/afiliate_network/marketcall.png";
import afClickBooth from "../assets/afiliate_network/clickbooth.png";
import afGuruMedia from "../assets/afiliate_network/guruMedia.webp";
import afCashNetwork from "../assets/afiliate_network/cashNetwork.png";
import afClickdealer from "../assets/afiliate_network/clickdealer.png";
import afBuyGoods from "../assets/afiliate_network/buy_goods.jpg";
import afYaariDigital from "../assets/afiliate_network/yaaridigital.png";

export const normalizeAffiliateNetworkKey = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

export const AFFILIATE_NETWORK_LOGOS = {
  awin: afAwin,
  clickbank: afClickbank,
  clicksco: afClicksco,
  commissionjunction: afCj,
  cj: afCj,
  cjaffiliate: afCj,
  digistore24: afDigistore24,
  impact: afImpact,
  maxbounty: afMaxbounty,
  partnerstack: afPartnerstack,
  rakuten: afRakuten,
  shareasale: afShareasale,
  amazonassociates: afAmazonAssociates,
  amazon: afAmazonAssociates,
  skimlinks: afSkimlinks,
  refersion: afRefersion,
  vertoz: afVertoz,
  ebaypartnernetwork: afEbayPartnerNetwork,
  pepperjam: afPepperjam,
  linkconnector: afLinkConnector,
  leaddyno: afLeadDyno,
  jumbleberry: afJumbleberry,
  giddyup: afGiddyUp,
  a4d: afA4d,
  madrivo: afMadrivo,
  marketcall: afMarketcall,
  clickbooth: afClickBooth,
  gurumedia: afGuruMedia,
  cashnetwork: afCashNetwork,
  clickdealer: afClickdealer,
  buygoods: afBuyGoods,
  yaaridigital: afYaariDigital,
};

export const getAffiliateNetworkLogo = (name) =>
  AFFILIATE_NETWORK_LOGOS[normalizeAffiliateNetworkKey(name)];
