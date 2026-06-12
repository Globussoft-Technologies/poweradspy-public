import path from "path";
import fs from "fs";
import sgMail from "@sendgrid/mail";
import config from "config";
import logger from "../../resources/logs/logger.log.js";
import { newSendId, logSend } from "./emailAudit.js";
import { isBlacklisted, BLACKLISTED_SKIP_REASON } from "./bounceGuard.js";

// Diagnostic logging gate — toggled via MAIL_DEBUG_LOG in config. Errors
// (lines containing "❌" or "FAILED") still print even when the flag is
// off, so production never goes silent on real send failures.
const MAIL_DEBUG_LOG = (() => {
  try { return !!config.get("MAIL_DEBUG_LOG"); } catch { return false; }
})();
function dlog(...args) {
  if (MAIL_DEBUG_LOG) { console.log(...args); return; }
  const first = String(args[0] || "");
  if (first.includes("❌") || /\bFAILED\b/i.test(first)) console.log(...args);
}

const ASSETS_BASE = (() => {
  try { return config.get("assets_base_url"); }
  catch { return "http://localhost:3000/public"; }
})().replace(/\/+$/, "");

const ASSETS_MODE = (() => {
  try { return config.get("assets_mode"); }
  catch { return "inline"; }
})();

const PUBLIC_DIR = path.resolve("public");

const MIME = { ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml" };

function fileToDataUri(filename) {
  try {
    const full = path.join(PUBLIC_DIR, filename);
    const buf = fs.readFileSync(full);
    const ext = path.extname(filename).toLowerCase();
    const mime = MIME[ext] || "application/octet-stream";
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch (e) {
    logger.error(`fileToDataUri failed for ${filename}: ${e.message}`);
    return "";
  }
}

function assetUrl(filename) {
  return ASSETS_MODE === "url" ? `${ASSETS_BASE}/${filename}` : fileToDataUri(filename);
}

const PLATFORM_ICONS = {
  facebook: assetUrl("fb.png"),
  instagram: assetUrl("ig.png"),
  google: assetUrl("g.png"),
};

const PLATFORM_LABELS = {
  facebook: "Facebook",
  instagram: "Instagram",
  google: "Google",
};

// Logo asset filename. When assets_mode is "url" this resolves to
// `${assets_base_url}/poweradspy-logo.webp` (production CDN). The PNG
// version is preferable for Gmail mobile / Outlook compatibility — once
// `poweradspy-logo.png` is uploaded to the same public/ folder on the
// CDN, change the filename below to "poweradspy-logo.png".
const BRAND_LOGO_URL = assetUrl("poweradspy-logo.webp");

function safeEncode(str) {
  return encodeURIComponent(str || "")
    .replace(/'/g, "%27")
    .replace(/"/g, "%22");
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function compactNumber(n) {
  const num = Number(n) || 0;
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(num >= 10_000_000 ? 0 : 1).replace(/\.0$/, "") + "M";
  }
  if (num >= 1_000) {
    return (num / 1_000).toFixed(num >= 10_000 ? 0 : 1).replace(/\.0$/, "") + "k";
  }
  return String(num);
}

function todayLabel() {
  const d = new Date();
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

// Dark card background (Outlook fallback) + bottom scrim band color per
// platform, so white creative text stays readable over any ad image.
const PLATFORM_CARD_BG = {
  facebook: "#0a2540",
  instagram: "#3a1d5c",
  google: "#062b1f",
};
const PLATFORM_SCRIM = {
  facebook: "rgba(8,18,34,0.55)",
  instagram: "rgba(30,12,54,0.55)",
  google: "rgba(6,28,20,0.55)",
};

const AVATAR_COLORS = [
  "#15c39a", "#000000", "#7b3ff2", "#f39b2c", "#d6297a",
  "#1877f2", "#22c55e", "#1a2240", "#ef4444", "#0a2540",
];

function hashIdx(seed, len) {
  const s = String(seed || "?");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % len;
}

function avatarColorFor(name) {
  return AVATAR_COLORS[hashIdx(name, AVATAR_COLORS.length)];
}

function platformIconImg(platform, px) {
  const src = PLATFORM_ICONS[platform];
  if (!src) return "";
  // No white background — the icon PNGs have their own transparency, so
  // adding bg:#ffffff would put an ugly white square behind the colorful
  // logos when they sit on a dark creative card.
  return `<img src="${src}" alt="${PLATFORM_LABELS[platform] || ""}" width="${px}" height="${px}" style="display:inline-block;width:${px}px;height:${px}px;border:0;outline:none;vertical-align:middle;background:transparent;" />`;
}

function truncate(text, max) {
  const t = (text || "").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}

function normalizeAd(a) {
  if (!a) return null;
  // Keep title and post_owner_name separate — the card renders the owner
  // (advertiser/page name) at the TOP and the ad title beneath it.
  const post_owner_name = (a.post_owner_name || "").toString().trim();
  const title = (a.title || "").toString().trim();
  const body = (a.ad_text || a.body || "").toString().trim();
  const cta = (a.call_to_action || a.cta || "").toString().trim();
  const image_url = (a.image_url || a.creative_image_url || a.media_url || "").toString().trim();
  const post_owner_image_url = (a.post_owner_image_url || "").toString().trim();
  if (!post_owner_name && !title && !body && !cta && !image_url) return null;
  return { platform: a.platform, post_owner_name, title, body, cta, image_url, post_owner_image_url };
}

// ===== COUNT CARD — one fluid column (Facebook / Instagram / Google).
// All styles inline + tables only (no classes, no media queries) so it
// renders identically across email clients. Percentage widths keep the
// row N-up and fluid without media queries. pad is the per-column gap. =====
function buildCountCard(platform, countObj, widthPct, pad, advertiserName, appUrl) {
  const icon = platformIconImg(platform, 14);
  const label = PLATFORM_LABELS[platform] || "";
  const last24h = (countObj && typeof countObj === "object") ? (Number(countObj.last24h) || 0) : (Number(countObj) || 0);
  const total   = (countObj && typeof countObj === "object") ? (Number(countObj.total)   || 0) : (Number(countObj) || 0);
  const enc = safeEncode(advertiserName);
  const link = `${appUrl}?advertiser=${enc}&platform=${platform}`;

  // When the platform had no ads in the last 24h, show a muted em-dash +
  // "No ads today" instead of a count — so the card (and the platform, e.g.
  // Google, which is often zero) still appears in the row rather than being
  // dropped. When total all-time ads exist, still surface them.
  const body = last24h > 0
    ? `<p style="margin:0; white-space:nowrap; line-height:1;"><span style="font-size:21px; font-weight:800; color:#1a2240; letter-spacing:-0.4px; vertical-align:middle;">${compactNumber(last24h)}</span><span style="font-size:8px; font-weight:700; color:#9aa3bd; text-transform:uppercase; letter-spacing:0.6px; margin-left:5px; vertical-align:middle;">Today</span></p>
                <div style="height:1px; line-height:1px; font-size:0; background:#f0e2c8; margin:8px 0 7px;">&nbsp;</div>
                <p style="margin:0; white-space:nowrap; line-height:1;"><span style="font-size:10px; font-weight:700; color:#6b7590;">${compactNumber(total)}</span><span style="font-size:8px; font-weight:600; color:#9aa3bd; text-transform:uppercase; letter-spacing:0.6px; margin-left:5px;">All time</span></p>`
    : `<p style="margin:0; white-space:nowrap; line-height:1;"><span style="font-size:21px; font-weight:800; color:#c8cad6; letter-spacing:-0.4px; vertical-align:middle;">—</span></p>
                <div style="height:1px; line-height:1px; font-size:0; background:#f0e2c8; margin:8px 0 7px;">&nbsp;</div>
                <p style="margin:0; white-space:nowrap; line-height:1;"><span style="font-size:9px; font-weight:600; color:#9aa3bd;">No ads today</span></p>`;

  return `
        <td width="${widthPct}" style="width:${widthPct}; padding:${pad}; vertical-align:top; box-sizing:border-box;">
          <a href="${link}" target="_blank" style="text-decoration:none; color:inherit; display:block;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; border-collapse:separate; border:1px solid #f0e2c8; border-radius:10px; background:#ffffff;">
              <tr><td style="padding:10px 11px 9px;">
                <p style="margin:0 0 7px; white-space:nowrap; line-height:1;">${icon}<span style="font-size:11px; font-weight:600; color:#6b7590; vertical-align:middle; margin-left:6px;">${label}</span></p>
                ${body}
              </td></tr>
            </table>
          </a>
        </td>`;
}

function buildCountRow(counts, advertiserName, appUrl) {
  // Always render all three platform cards (Facebook / Instagram / Google),
  // even when a platform had no ads today (it shows a muted "No ads today"
  // state). This keeps every competitor's row consistent and ensures Google
  // — which often has 0 ads in the last 24h — is never silently dropped.
  const platforms = ["facebook", "instagram", "google"];
  const n = platforms.length;
  const pct = (100 / n).toFixed(2) + "%";
  const cells = platforms.map((p, i) => {
    let pad;
    if (i === 0) pad = "0 4px 0 0";
    else if (i === n - 1) pad = "0 0 0 4px";
    else pad = "0 4px";
    return buildCountCard(p, counts[p], pct, pad, advertiserName, appUrl);
  }).join("");
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; border-collapse:separate; border-spacing:0; table-layout:fixed; mso-table-lspace:0pt; mso-table-rspace:0pt;">
      <tr>${cells}</tr>
    </table>`;
}

// ===== CREATIVE CARD — large card with the ad photo as a bulletproof
// background: the `background` HTML attribute (Gmail/Apple/Yahoo) AND a
// single-url background-image CSS (no gradient in the url declaration, so
// weak clients don't drop the whole rule). A VML <v:image> paints the same
// photo in Outlook (Word). White text sits on a semi-transparent scrim
// band so it stays readable over any image. =====
function buildCreativeCard(ad, widthPct, vmlPx, pad, advertiserName, appUrl) {
  const platform = ad.platform;
  const icon = platformIconImg(platform, 12);
  const owner = escapeHtml(truncate(ad.post_owner_name || PLATFORM_LABELS[platform] || "", 24));
  const title = escapeHtml(truncate(ad.title || ad.body || "", 50));
  const cta = escapeHtml(ad.cta || "View ad →");
  const enc = safeEncode(advertiserName);
  const link = `${appUrl}?advertiser=${enc}&platform=${platform}`;
  const cardBg = PLATFORM_CARD_BG[platform] || "#0a2540";
  const scrim = PLATFORM_SCRIM[platform] || "rgba(8,18,34,0.55)";
  const imageUrl = (ad.image_url || "").trim();
  const H = 150;

  const bgImg = imageUrl
    ? `background-image: url('${imageUrl}'); background-size:cover; background-position:center; background-repeat:no-repeat;`
    : "";
  const vmlOpen = imageUrl
    ? `
                <!--[if gte mso 9]>
                <v:image xmlns:v="urn:schemas-microsoft-com:vml" style="width:${vmlPx}px;height:${H}px;border-radius:12px;" src="${imageUrl}" />
                <v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="false" stroke="false" style="position:absolute;width:${vmlPx}px;height:${H}px;">
                <v:textbox inset="0,0,0,0"><![endif]-->`
    : "";
  const vmlClose = imageUrl
    ? `
                <!--[if gte mso 9]></v:textbox></v:rect><![endif]-->`
    : "";

  return `
        <td width="${widthPct}" style="width:${widthPct}; padding:${pad}; vertical-align:top; box-sizing:border-box;">
          <table role="presentation" width="100%" height="${H}" cellpadding="0" cellspacing="0" border="0" style="width:100%; height:${H}px; border-collapse:separate; border-radius:12px; overflow:hidden; background-color:${cardBg}; box-shadow:0 1px 2px rgba(20,30,60,0.14);">
            <tr>
              <td height="${H}" valign="bottom" bgcolor="${cardBg}"${imageUrl ? ` background="${imageUrl}"` : ""} style="height:${H}px; padding:0; border-radius:12px; background-color:${cardBg}; ${bgImg}">${vmlOpen}
                <table role="presentation" width="100%" height="${H}" cellpadding="0" cellspacing="0" border="0" style="width:100%; height:${H}px;">
                  <tr>
                    <td valign="top" align="right" style="padding:8px 8px 0;">
                      <span style="display:inline-block; background:rgba(0,0,0,0.45); color:#ffffff; font-size:7px; font-weight:700; letter-spacing:0.5px; text-transform:uppercase; padding:2px 6px; border-radius:4px;">Sponsored</span>
                    </td>
                  </tr>
                  <tr>
                    <td valign="bottom" bgcolor="${cardBg}" style="padding:8px 12px 13px; background-color:${scrim};">
                      <p style="font-size:9px; font-weight:600; color:#ffffff; margin:0 0 5px; line-height:1; text-shadow:0 1px 2px rgba(0,0,0,0.6);">${icon}<span style="vertical-align:middle; margin-left:5px;">${owner}</span></p>
                      ${title ? `<p style="font-size:13px; font-weight:800; color:#ffffff; margin:0 0 9px; line-height:15px; letter-spacing:-0.2px; text-shadow:0 1px 3px rgba(0,0,0,0.7);">${title}</p>` : ""}
                      <a href="${link}" target="_blank" style="text-decoration:none; display:inline-block; background:#ffffff; color:#111111; font-size:9px; font-weight:700; padding:5px 11px; border-radius:6px; letter-spacing:0.2px;">${cta}</a>
                    </td>
                  </tr>
                </table>${vmlClose}
              </td>
            </tr>
          </table>
        </td>`;
}

function buildCreativeRow(ads, advertiserName, appUrl) {
  const picked = (ads || []).slice(0, 2);
  if (!picked.length) return "";
  let cells;
  if (picked.length === 1) {
    cells = buildCreativeCard(picked[0], "100%", 560, "0", advertiserName, appUrl);
  } else {
    cells =
      buildCreativeCard(picked[0], "50%", 272, "0 4px 0 0", advertiserName, appUrl) +
      buildCreativeCard(picked[1], "50%", 272, "0 0 0 4px", advertiserName, appUrl);
  }
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; border-collapse:separate; border-spacing:0; table-layout:fixed; mso-table-lspace:0pt; mso-table-rspace:0pt;">
      <tr>${cells}</tr>
    </table>`;
}

function buildCompetitorBlock(comp, appUrl) {
  const name = escapeHtml(comp.name);
  const domain = escapeHtml(comp.domain || "");
  const initial = (comp.name || "?").trim().charAt(0).toUpperCase();
  const enc = safeEncode(comp.name);
  const viewAllHref = `${appUrl}?advertiser=${enc}`;
  const avatarBg = avatarColorFor(comp.name);

  const counts = comp.counts || {};

  // Active platforms = those whose last-24h count is > 0. A platform with
  // last24h=0 is dropped entirely — no count card AND no creative for it.
  const PLATFORM_ORDER = ["facebook", "instagram", "google"];
  const activePlatforms = PLATFORM_ORDER.filter((p) => {
    const v = counts[p];
    if (v == null) return false;
    if (typeof v === "object") return (Number(v.last24h) || 0) > 0;
    return Number(v) > 0;
  });

  // No active platforms → hide the competitor entirely.
  if (activePlatforms.length === 0) return "";

  // Bucket one ad per active platform, then pick the top 2 (by content
  // richness) for the 2-up creative row.
  const adByPlatform = {};
  for (const a of (Array.isArray(comp.ads) ? comp.ads : []).map(normalizeAd).filter(Boolean)) {
    if (activePlatforms.includes(a.platform) && !adByPlatform[a.platform]) adByPlatform[a.platform] = a;
  }
  const candidateAds = activePlatforms.map((p) => adByPlatform[p]).filter(Boolean);
  const creativeAds = candidateAds
    .map((a) => ({ ad: a, score: (a.title ? 2 : 0) + (a.body ? 1 : 0) + (a.cta ? 1 : 0) + (a.image_url ? 1 : 0) }))
    .sort((x, y) => y.score - x.score)
    .slice(0, 2)
    .map((s) => s.ad);

  // Avatar: prefer post_owner_image_url from ES, otherwise the first ad's
  // owner image, otherwise the initial-letter colored circle.
  const adOwnerImage = candidateAds.map((a) => a && a.post_owner_image_url).find((u) => !!u) || "";
  const ownerImageUrl = (comp.post_owner_image_url || adOwnerImage || "").trim();
  const avatarHtml = ownerImageUrl
    ? `<img src="${ownerImageUrl}" alt="${name}" width="42" height="42" style="width:42px; height:42px; border-radius:50%; object-fit:cover; display:inline-block; border:0; outline:none; box-shadow:0 0 0 1px rgba(0,0,0,0.06); background:${avatarBg};" />`
    : `<span style="width:42px; height:42px; border-radius:50%; color:#ffffff; font-weight:800; font-size:21px; text-align:center; line-height:42px; display:inline-block; text-transform:uppercase; letter-spacing:-0.5px; box-shadow:0 0 0 1px rgba(0,0,0,0.06); background:${avatarBg};">${escapeHtml(initial)}</span>`;

  const headHtml = `
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%; border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; margin-bottom:14px;">
      <tr>
        <td width="52" style="vertical-align:middle;">
          ${avatarHtml}
        </td>
        <td style="vertical-align:middle;">
          <p style="font-size:16px; font-weight:800; color:#1a2240; margin:0; line-height:19px; letter-spacing:-0.1px;">${name}</p>
          ${domain ? `<p style="font-size:11.5px; color:#6b7590; margin:2px 0 0; word-break:break-all; font-weight:400;">${domain}</p>` : ""}
        </td>
        <td align="right" width="80" style="vertical-align:middle;">
          <a href="${viewAllHref}" target="_blank" style="text-decoration:none; display:inline-block; background:#fff1d8; color:#f39b2c; font-size:11px; font-weight:700; padding:7px 12px; border-radius:999px; white-space:nowrap;">View all →</a>
        </td>
      </tr>
    </table>`;

  const countRow = buildCountRow(counts, comp.name, appUrl);
  const creativeRow = buildCreativeRow(creativeAds, comp.name, appUrl);
  const spacer = (countRow && creativeRow)
    ? `<div style="height:12px; line-height:12px; font-size:0;">&nbsp;</div>`
    : "";

  return `${headHtml}${countRow}${spacer}${creativeRow}`;
}

function buildBrandCard(brand, appUrl) {
  const competitors = Array.isArray(brand.competitors) ? brand.competitors : [];
  const name = escapeHtml(brand.brand_name || "Untitled brand");

  // Render each competitor, but drop the ones with no data on any network.
  const renderedCompetitors = competitors
    .map((c) => ({ block: buildCompetitorBlock(c, appUrl) }))
    .filter((x) => !!x.block);

  // If no competitor under this brand has any data, hide the brand entirely
  // — no head, no name, nothing.
  if (!renderedCompetitors.length) return "";

  // Each competitor sits inside its own white card (inline styles only).
  const competitorsHtml = renderedCompetitors
    .map((x) => `
    <div style="background:#ffffff; border:1px solid #f0e2c8; border-radius:14px; padding:18px 14px; margin-bottom:14px; box-shadow:0 2px 10px rgba(28,40,80,0.04);">${x.block}
    </div>`)
    .join("");

  const shownCount = renderedCompetitors.length;

  return `
    <div style="padding:6px 6px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%; border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt;">
        <tr>
          <td style="vertical-align:middle;">
            <span style="width:5px; height:22px; background:#f39b2c; border-radius:4px; display:inline-block; margin-right:10px; vertical-align:middle;">&nbsp;</span><span style="display:inline-block; font-size:10px; font-weight:700; color:#6b7590; letter-spacing:1px; text-transform:uppercase; vertical-align:middle; margin-right:10px;">Your brand</span><h2 style="display:inline-block; font-size:18px; font-weight:800; color:#1a2240; letter-spacing:-0.2px; line-height:22px; vertical-align:middle; margin:0;">${name}</h2>
          </td>
          <td align="right" style="vertical-align:middle; font-size:12px; color:#6b7590; font-weight:400; text-align:right; white-space:nowrap;">${shownCount} competitor${shownCount === 1 ? "" : "s"}</td>
        </tr>
      </table>
    </div>
    ${competitorsHtml}`;
}

function brandsFromLegacy(variables) {
  const names = variables.competitor_name || [];
  const fb = variables.facebook_platform || [];
  const ig = variables.instagram_platform || [];
  const g = variables.google_platform || [];
  const competitors = names.map((n, i) => ({
    name: n,
    domain: "",
    counts: { facebook: fb[i] || 0, instagram: ig[i] || 0, google: g[i] || 0 },
    ads: [],
  }));
  return [
    {
      brand_name: "Your tracked competitors",
      project_name: "Daily update",
      competitors,
    },
  ];
}

class emailService {
  constructor() {
    sgMail.setApiKey(config.get("SENDGRID_API_KEY"));
  }

  renderTemplate(templateName, variables) {
    const filePath = path.resolve("mail-template", templateName);
    let html = fs.readFileSync(filePath, "utf-8");

    const appUrl = config.get("app_url");
    const brands = Array.isArray(variables.brands) && variables.brands.length
      ? variables.brands
      : brandsFromLegacy(variables);

    // Counts are either a number (legacy) or { last24h, total }. Helpers.
    const last24hOf = (v) => (v && typeof v === "object") ? (Number(v.last24h) || 0) : (Number(v) || 0);
    const totalOf   = (v) => (v && typeof v === "object") ? (Number(v.total)   || 0) : (Number(v) || 0);

    // Pre-filter: a competitor only appears if it shipped at least one ad
    // on any platform in the last 24 hours. All-time totals or ad creatives
    // alone are NOT enough to surface a zero-last24h competitor.
    const competitorHasData = (c) => {
      const counts = c.counts || {};
      return ["facebook", "instagram", "google"].some(
        (p) => last24hOf(counts[p]) > 0
      );
    };

    // Score a competitor / brand by today's ad count (sum of last24h across platforms).
    const competitorScore = (c) => {
      const counts = c.counts || {};
      return last24hOf(counts.facebook) + last24hOf(counts.instagram) + last24hOf(counts.google);
    };

    // CONDITION (no split): send ONE focused email — the user's TOP 5 brands by
    // today's ad count, and within each brand the TOP 3 competitors by today's
    // ad count. Template/UI unchanged; we only trim + sort the data fed to it.
    // This also keeps the HTML small, so the size-based splitter never triggers.
    const TOP_BRANDS = 5;
    const TOP_COMPETITORS = 3;

    let visibleBrands = brands
      .map((b) => {
        const comps = (Array.isArray(b.competitors) ? b.competitors : []).filter(competitorHasData);
        comps.sort((a, c) => competitorScore(c) - competitorScore(a)); // top competitors first
        const brandScore = comps.reduce((s, c) => s + competitorScore(c), 0);
        return { ...b, competitors: comps.slice(0, TOP_COMPETITORS), _brandScore: brandScore };
      })
      .filter((b) => b.competitors.length > 0);

    visibleBrands.sort((a, b) => b._brandScore - a._brandScore); // top brands first
    visibleBrands = visibleBrands.slice(0, TOP_BRANDS);

    // Hero "ads in last 24 hours" = sum of last24h across all visible
    // platforms × competitors.
    let totalAds = 0;
    let competitorsCount = 0;
    for (const b of visibleBrands) {
      competitorsCount += b.competitors.length;
      for (const c of b.competitors) {
        totalAds +=
          last24hOf(c.counts?.facebook)  +
          last24hOf(c.counts?.instagram) +
          last24hOf(c.counts?.google);
      }
    }

    const brandsHtml = visibleBrands.map((b) => buildBrandCard(b, appUrl)).join("");
    const ctaUrl = `${appUrl}project`;
    const manageUrl = `${appUrl}`;
    const unsubscribeLink = `${appUrl}facebook/unsubscribe-page?email=${encodeURIComponent(variables.email || "")}&page=competitor`;
    const dateLabel = variables.dateLabel || todayLabel();

    const replacements = {
      name: escapeHtml(variables.name || "there"),
      dateLabel: escapeHtml(dateLabel),
      brandsCount: String(visibleBrands.length),
      competitorsCount: String(competitorsCount),
      totalAds: compactNumber(totalAds),
      brandsHtml,
      ctaUrl,
      manageUrl,
      logoUrl: BRAND_LOGO_URL,
      unsubscribe_link: unsubscribeLink,
    };

    for (const [key, value] of Object.entries(replacements)) {
      const re = new RegExp(`{{\\s*${key}\\s*}}`, "g");
      html = html.replace(re, value);
    }

    return html;
  }

  async sendCompetitorUpdateEmail({ to, name, code }) {
    // Bounce blacklist (manifest §15) — defensive gate. Most callers go
    // through activeCompetitorContacts which already short-circuits, but
    // any other entry-point (test scripts, future routes) still hits this.
    if (await isBlacklisted(to)) {
      const skipId = newSendId();
      try {
        await logSend({
          send_id: skipId,
          mail_type: "competitorUpdate",
          to,
          user_name: name || null,
          subject: null,
          status: "skipped",
          failure_reason: BLACKLISTED_SKIP_REASON,
          meta: { source: code?.source || "unknown" },
        });
      } catch { /* logSend handles its own errors */ }
      throw new Error(BLACKLISTED_SKIP_REASON);
    }

    const html = this.renderTemplate("competitorUpdate.html", {
      name,
      email: to,
      brands: code?.brands,
      dateLabel: code?.dateLabel,
      competitor_name: code?.competitor_name,
      facebook_platform: code?.data?.facebook_count,
      instagram_platform: code?.data?.instagram_count,
      google_platform: code?.data?.google_count,
    });

    const fromAddr = config.get("SENDGRID_FROM");
    const send_id = newSendId();
    const subject = `Daily Competitor Pulse · ${todayLabel()}`;

    // No CC on any mail (manifest §14 hard rule). The owner mail goes
    // strictly to `to:`. Member visibility is now its own direct send
    // (see sendCompetitorMemberMail), not a ride-along CC. The previous
    // `support@poweradspy.com` CC + `code.ccEmails` union are removed.
    const ccMembers = [];

    const mailOptions = {
      to,
      from: { email: fromAddr, name: "PoweradSpy" },
      subject,
      html,
      // custom_args echo back on SendGrid webhook events → correlate to this log row.
      customArgs: { send_id, mail_type: "competitorUpdate" },
      // Enable click + open tracking PER MESSAGE so SendGrid rewrites the
      // <a href> links into tracking redirects and fires `click` events
      // (otherwise no clicks are ever generated, regardless of the webhook
      // subscription). Independent of the account-level default.
      trackingSettings: {
        clickTracking: { enable: true, enableText: false },
        openTracking: { enable: true },
      },
    };

    // Audit base — full brand/competitor snapshot taken AT SEND TIME, stored in
    // our own collection. competitors_requests.email_status resets after each
    // cycle, so we persist the complete picture here instead of reading it back.
    const brands = Array.isArray(code?.brands) ? code.brands : [];
    const competitorsTotal = brands.reduce(
      (s, b) => s + (Array.isArray(b?.competitors) ? b.competitors.length : 0), 0
    );
    // Which networks each competitor was tracked on (for the admin "which
    // competitor / which network" view). Derived from the per-competitor counts.
    const networksOf = (c) => ["facebook", "instagram", "google"].filter((n) => {
      const v = c?.counts?.[n];
      if (v == null) return false;
      const last = typeof v === "object" ? (Number(v.last24h) || 0) : (Number(v) || 0);
      const total = typeof v === "object" ? (Number(v.total) || 0) : (Number(v) || 0);
      return last > 0 || total > 0;
    });
    const brandsDetail = brands.slice(0, 50).map((b) => ({
      name: b?.brand_name || b?.name || null,
      domain: b?.domain || null,
      // members CC'd FOR THIS brand (admin sees which brand → who was CC'd)
      cc: (code?.ccByBrand && b?.project_id) ? (code.ccByBrand[String(b.project_id)] || []) : [],
      competitors: (Array.isArray(b?.competitors) ? b.competitors : [])
        .slice(0, 50)
        .map((c) => ({ name: c?.name || c?.post_owner_name || null, networks: networksOf(c) }))
        .filter((c) => c.name),
    }));
    const auditBase = {
      send_id,
      mail_type: "competitorUpdate",
      to,
      user_name: name || null,
      amember_id: code?.amember_id ?? null,
      subject,
      meta: {
        brands: brands.length,
        competitors: competitorsTotal,
        dateLabel: code?.dateLabel || null,
        cc: ccMembers,           // member emails CC'd on this mail (admin visibility)
        brandsDetail,
      },
    };

    dlog(`[sendgrid] → sending to=${to}  from=${fromAddr}  cc=(none)  subject="${mailOptions.subject}"  html_bytes=${(html || "").length}`);
    logger.info(`Attempting to send the email to ${to}`);

    try {
      const resp = await sgMail.send(mailOptions);
      // sgMail.send returns [response, body]. The response has the
      // SendGrid message ID in the x-message-id header — capture it so
      // we know what to look for in SendGrid's activity feed.
      const r0 = Array.isArray(resp) ? resp[0] : resp;
      const statusCode = r0?.statusCode || r0?.status || "?";
      const msgId = r0?.headers?.["x-message-id"] || r0?.headers?.["X-Message-Id"] || "(no-msg-id)";
      dlog(`[sendgrid] ✅ accepted to=${to}  status=${statusCode}  msgId=${msgId}`);
      logger.info(`email sent successfully to ${to} (status=${statusCode} msgId=${msgId})`);
      await logSend({ ...auditBase, status: "sent", sendgrid_message_id: msgId === "(no-msg-id)" ? null : msgId, sent_at: new Date() });
    } catch (error) {
      await logSend({ ...auditBase, status: "failed", failure_reason: error?.message || "send error" });
      dlog(`[sendgrid] ❌ FAILED to=${to}  err=${error.message}`);
      logger.error(`failed to send the email to ${to}: ${error.message}`);
      if (error.response?.body) {
        dlog(`[sendgrid] response body: ${JSON.stringify(error.response.body)}`);
        logger.error(`sendGrid response: ${JSON.stringify(error.response.body)}`);
      }
      if (error.response?.headers) {
        dlog(`[sendgrid] response headers: ${JSON.stringify(error.response.headers)}`);
      }
      throw error;
    }
  }

  /**
   * Render `competitorUpdateMember.html` — used by the member-brand direct
   * send (manifest §13). Single-brand digest, with an "Added by …" badge.
   * Reuses the same brand-card builder as the owner template so the body
   * looks identical apart from the hero.
   */
  renderMemberTemplate(variables) {
    const filePath = path.resolve("mail-template", "competitorUpdateMember.html");
    let html = fs.readFileSync(filePath, "utf-8");

    const appUrl = config.get("app_url");
    const brands = Array.isArray(variables.brands) ? variables.brands : [];
    const last24hOf = (v) => (v && typeof v === "object") ? (Number(v.last24h) || 0) : (Number(v) || 0);
    const competitorHasData = (c) => {
      const counts = c.counts || {};
      return ["facebook", "instagram", "google"].some((p) => last24hOf(counts[p]) > 0);
    };
    const competitorScore = (c) => {
      const counts = c.counts || {};
      return last24hOf(counts.facebook) + last24hOf(counts.instagram) + last24hOf(counts.google);
    };

    // Member mail = MULTI-brand (one mail per member, all their assigned
    // data-brands inside). Capped at TOP 3 BRANDS — lower than the owner
    // mail (5) — so the consolidated mail stays under the size threshold
    // that Globussoft / Gmail's inbound filter starts quarantining around.
    // Same top-3 competitors per brand as owner.
    const TOP_BRANDS = 3;
    const TOP_COMPETITORS = 3;
    let visibleBrands = brands
      .map((b) => {
        const comps = (Array.isArray(b.competitors) ? b.competitors : []).filter(competitorHasData);
        comps.sort((a, c) => competitorScore(c) - competitorScore(a));
        const brandScore = comps.reduce((s, c) => s + competitorScore(c), 0);
        return { ...b, competitors: comps.slice(0, TOP_COMPETITORS), _brandScore: brandScore };
      })
      .filter((b) => b.competitors.length > 0);
    visibleBrands.sort((a, b) => b._brandScore - a._brandScore);
    visibleBrands = visibleBrands.slice(0, TOP_BRANDS);

    let totalAds = 0;
    let competitorsCount = 0;
    for (const b of visibleBrands) {
      competitorsCount += b.competitors.length;
      for (const c of b.competitors) {
        totalAds += last24hOf(c.counts?.facebook) + last24hOf(c.counts?.instagram) + last24hOf(c.counts?.google);
      }
    }

    // For the hero "you've been added for these brand(s)" line.
    const brandsLabel = visibleBrands.length === 1
      ? (visibleBrands[0].brand_name || "this brand")
      : `${visibleBrands.length} brands`;
    const brandsHtml = visibleBrands.map((b) => buildBrandCard(b, appUrl)).join("");
    const unsubscribeLink = `${appUrl}facebook/unsubscribe-page?email=${encodeURIComponent(variables.email || "")}&page=competitor`;
    const manageUrl = `${appUrl}`;
    const dateLabel = variables.dateLabel || todayLabel();

    const replacements = {
      name: escapeHtml(variables.name || "there"),
      addedBy: escapeHtml(variables.addedBy || "a PowerAdSpy user"),
      // brandsLabel = "Bewakoof" when only 1 brand, "3 brands" when many.
      // brandsCount = numeric.
      brandName: escapeHtml(brandsLabel),
      brandsLabel: escapeHtml(brandsLabel),
      brandsCount: String(visibleBrands.length),
      dateLabel: escapeHtml(dateLabel),
      competitorsCount: String(competitorsCount),
      totalAds: compactNumber(totalAds),
      brandsHtml,
      logoUrl: BRAND_LOGO_URL,
      manageUrl,
      unsubscribe_link: unsubscribeLink,
    };
    for (const [key, value] of Object.entries(replacements)) {
      const re = new RegExp(`{{\\s*${key}\\s*}}`, "g");
      html = html.replace(re, value);
    }
    return html;
  }

  /**
   * Send the brand-isolated digest to a single member (manifest §13.1).
   * Different from `sendCompetitorUpdateEmail` in three ways:
   *   - No CC (manifest §14 hard rule).
   *   - Different template (`competitorUpdateMember.html` with "Added by" badge).
   *   - email_send_log row is tagged with meta.source = "member_brand" and
   *     meta.added_by_* fields so analytics can split it from cron output.
   *
   * Returns: { ok, status, send_id, sendgrid_message_id, error? }.
   * NEVER throws — caller must not be blocked by a single member send.
   */
  async sendCompetitorMemberMail({ to, name, addedBy, addedByEmail, addedByUserId, brands, brand }) {
    const send_id = newSendId();
    try {
      // Back-compat: callers may still pass a single `brand`; normalize to
      // an array. New callers (one-mail-per-member) pass `brands`.
      const brandsArr = Array.isArray(brands) ? brands : (brand ? [brand] : []);
      if (!to || !brandsArr.length) {
        return { ok: false, send_id, error: "to and brands are required" };
      }
      // Bounce blacklist (manifest §15) — defensive gate; the
      // `_runMemberBrandPass` caller already filters but this is the
      // canonical floor.
      if (await isBlacklisted(to)) {
        try {
          await logSend({
            send_id,
            mail_type: "competitorUpdate",
            to,
            user_name: name || null,
            subject: null,
            status: "skipped",
            failure_reason: BLACKLISTED_SKIP_REASON,
            meta: {
              source: "member_brand",
              added_by: addedByUserId || null,
              added_by_user_name: addedBy || null,
              added_by_email: addedByEmail || null,
              assigned_brand_names: brandsArr.map((b) => b?.brand_name).filter(Boolean),
            },
          });
        } catch { /* logSend handles its own errors */ }
        return { ok: false, send_id, status: "skipped", error: BLACKLISTED_SKIP_REASON };
      }
      const fromAddr = config.get("SENDGRID_FROM");
      const html = this.renderMemberTemplate({
        name,
        email: to,
        addedBy,
        brands: brandsArr,
      });
      // Subject — match the OWNER mail subject byte-for-byte (the corporate
      // Gmail / Globussoft filters silently quarantine subjects containing
      // "shared by", "digest", or names of third parties — classic
      // phishing-pattern triggers). Identification context (who added the
      // member, which brand) lives in the body's "Added by …" ribbon and
      // footer instead.
      const subject = `Daily Competitor Pulse · ${todayLabel()}`;

      const mailOptions = {
        to,
        from: { email: fromAddr, name: "PoweradSpy" },
        subject,
        html,
        customArgs: { send_id, mail_type: "competitorUpdate" },
        // Enable click + open tracking PER MESSAGE so SendGrid rewrites the
        // <a href> links into tracking redirects and fires `click` events
        // (otherwise no clicks are ever generated, regardless of the webhook
        // subscription). Independent of the account-level default.
        trackingSettings: {
          clickTracking: { enable: true, enableText: false },
          openTracking: { enable: true },
        },
      };

      // Audit base — capture WHO added this member and ALL brands they were
      // mailed about so the analytics view can group/filter per owner + brand.
      const competitorsTotal = brandsArr.reduce((s, b) => s + (Array.isArray(b?.competitors) ? b.competitors.length : 0), 0);
      const networksOf = (c) => ["facebook", "instagram", "google"].filter((n) => {
        const v = c?.counts?.[n];
        if (v == null) return false;
        const last = typeof v === "object" ? (Number(v.last24h) || 0) : (Number(v) || 0);
        const total = typeof v === "object" ? (Number(v.total) || 0) : (Number(v) || 0);
        return last > 0 || total > 0;
      });
      const auditBase = {
        send_id,
        mail_type: "competitorUpdate",
        to,
        user_name: name || null,
        subject,
        meta: {
          source: "member_brand",
          added_by: addedByUserId || null,
          added_by_user_name: addedBy || null,
          added_by_email: addedByEmail || null,
          // For back-compat: when only 1 brand was mailed, also stamp the
          // legacy single-brand fields so older analytics queries still work.
          project_id: brandsArr.length === 1 ? (brandsArr[0]?.project_id || null) : null,
          brand_name: brandsArr.length === 1 ? (brandsArr[0]?.brand_name || null) : null,
          brands: brandsArr.length,
          competitors: competitorsTotal,
          brandsDetail: brandsArr.slice(0, 50).map((b) => ({
            name: b?.brand_name || null,
            domain: b?.domain || null,
            project_id: b?.project_id || null,
            cc: [], // hard rule — never any CC on member-brand mails
            competitors: (Array.isArray(b?.competitors) ? b.competitors : [])
              .slice(0, 50)
              .map((c) => ({ name: c?.name || c?.post_owner_name || null, networks: networksOf(c) }))
              .filter((c) => c.name),
          })),
        },
      };

      dlog(`[sendgrid:member] → to=${to}  addedBy="${addedBy}"  brands=${brandsArr.length} (${brandsArr.map((b) => b?.brand_name).join(", ")})  html_bytes=${(html || "").length}`);
      const resp = await sgMail.send(mailOptions);
      const r0 = Array.isArray(resp) ? resp[0] : resp;
      const statusCode = r0?.statusCode || r0?.status || "?";
      const msgId = r0?.headers?.["x-message-id"] || r0?.headers?.["X-Message-Id"] || null;
      dlog(`[sendgrid:member] ✅ accepted to=${to}  status=${statusCode}  msgId=${msgId || "(none)"}`);
      await logSend({ ...auditBase, status: "sent", sendgrid_message_id: msgId, sent_at: new Date() });
      return { ok: true, send_id, status: "sent", sendgrid_message_id: msgId };
    } catch (error) {
      dlog(`[sendgrid:member] ❌ FAILED to=${to}  err=${error.message}`);
      logger.error(`member-brand send failed to ${to}: ${error.message}`);
      try {
        await logSend({
          send_id,
          mail_type: "competitorUpdate",
          to,
          user_name: name || null,
          subject: null,
          status: "failed",
          failure_reason: error?.message || "send error",
          meta: {
            source: "member_brand",
            added_by_user_name: addedBy || null,
            added_by_email: addedByEmail || null,
            assigned_brand_names: (Array.isArray(brands) ? brands : (brand ? [brand] : []))
              .map((b) => b?.brand_name).filter(Boolean),
          },
        });
      } catch { /* never throw out of error path */ }
      return { ok: false, send_id, status: "failed", error: error?.message || "send error" };
    }
  }

  async sendEmail(req, res) {
    try {
      const { to, name, code } = req.body;
      if (!to || !name || !code) {
        return res.status(400).json({ message: "Missing required fields: to , name, code" });
      }
      await this.sendCompetitorUpdateEmail({ to, name, code });
      return res.status(200).json({ message: "Email sent  successfully" });
    } catch (error) {
      return res.status(500).json({ message: "Failed to send email", error: error.message });
    }
  }

  async sendEmailDirect({ to, name, code }) {
    try {
      if (!to || !name || !code) {
        throw new Error("Missing required fields: to name,code");
      }
      await this.sendCompetitorUpdateEmail({ to, name, code });
      return { status: 200, message: "Email sent successfully" };
    } catch (error) {
      return { message: "Failed to send email", error: error.message };
    }
  }
}

export default new emailService();
