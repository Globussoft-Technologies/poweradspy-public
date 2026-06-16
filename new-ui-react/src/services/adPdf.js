import { jsPDF } from "jspdf";
import he from "he";
import { fetchImageAsDataUrl } from "./api";

// ─── Stat trio (mirrors the per-platform trio shown on the card) ───────────
const STAT_TRIOS = {
  tiktok: ["impressions", "likes", "ctr"],
  facebook: ["likes", "comments", "shares"],
  instagram: ["likes", "comments", "shares"],
  youtube: ["views", "likes", "comments"],
  linkedin: ["likes", "comments", "shares"],
  reddit: ["views", "likes", "comments"],
  pinterest: ["views", "likes", "shares"],
  quora: ["views", "likes", "shares"],
  google: ["impressions", "likes", "ctr"],
  native: ["views", "likes", "shares"],
  gdn: ["impressions", "likes", "ctr"],
};
const DEFAULT_TRIO = ["views", "likes", "shares"];
const STAT_LABELS = {
  impressions: "Impressions",
  ctr: "CTR",
  views: "Views",
  likes: "Likes",
  comments: "Comments",
  shares: "Shares",
};
const resolveStatValue = (key, ad) => {
  switch (key) {
    case "impressions": return ad.impressions;
    case "ctr":         return ad.ctr != null ? `${ad.ctr}%` : null;
    case "views":       return ad.views;
    case "likes":       return ad.likes;
    case "comments":    return ad.comments;
    case "shares":      return ad.shares;
    /* v8 ignore next -- every key in STAT_TRIOS/DEFAULT_TRIO is handled above; default is defensive */
    default: return null;
  }
};

const formatStat = (val) => {
  if (val == null || val === "" || val === "N/A") return null;
  if (typeof val === "string" && /[a-zA-Z%]/.test(val)) return val;
  const num = Number(val);
  if (isNaN(num)) return String(val);
  if (num >= 1_000_000)
    return (num / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(num);
};

// ─── Text rendering helpers ────────────────────────────────────────────────
// jsPDF's built-in Helvetica only encodes Latin-1, so emoji / CJK / many
// scripts come out as gibberish. Rasterize those strings via the browser's
// font stack (which falls back to Segoe UI Emoji / Apple Color Emoji / Noto
// Color Emoji) and embed the result as a PNG in the PDF.
const PDF_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", Arial, sans-serif';
const PT_TO_PX = 96 / 72;
/* v8 ignore next -- hasUnicode is only ever called with a string body; the `s || ""` guard is defensive */
const hasUnicode = (s) => /[^\x00-\xff]/.test(String(s || ""));

const renderTextAsImage = (text, opts) => {
  const {
    fontSize = 10,
    fontWeight = "normal",
    color = "#181c28",
    maxWidth,
    lineHeight = 1.35,
    fontFamily = PDF_FONT_STACK,
  } = opts;
  const widthPx = maxWidth * PT_TO_PX;
  const fontPx = fontSize * PT_TO_PX;
  const dpr = 2;

  const measure = document.createElement("canvas").getContext("2d");
  measure.font = `${fontWeight} ${fontPx}px ${fontFamily}`;

  const tokens = String(text).split(/(\s+)/);
  const lines = [];
  let cur = "";
  const pushCur = () => {
    if (cur) {
      lines.push(cur.replace(/\s+$/, ""));
      cur = "";
    }
  };
  for (const tok of tokens) {
    if (measure.measureText(tok).width > widthPx) {
      pushCur();
      let chunk = "";
      for (const ch of tok) {
        const test = chunk + ch;
        if (measure.measureText(test).width > widthPx && chunk) {
          lines.push(chunk);
          chunk = ch;
        } else {
          chunk = test;
        }
      }
      cur = chunk;
      continue;
    }
    const next = cur + tok;
    if (measure.measureText(next).width > widthPx && cur.trim()) {
      lines.push(cur.replace(/\s+$/, ""));
      cur = tok.replace(/^\s+/, "");
    } else {
      cur = next;
    }
  }
  /* v8 ignore next -- real body text always leaves a non-empty trailing `cur`; the empty-cur skip is defensive */
  if (cur) lines.push(cur);

  const lineHpx = fontPx * lineHeight;
  const totalHpx = Math.max(lineHpx, lines.length * lineHpx);

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(widthPx * dpr);
  canvas.height = Math.ceil(totalHpx * dpr);
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.font = `${fontWeight} ${fontPx}px ${fontFamily}`;
  ctx.fillStyle = color;
  ctx.textBaseline = "top";
  lines.forEach((ln, i) => ctx.fillText(ln, 0, i * lineHpx));

  return {
    dataUrl: canvas.toDataURL("image/png"),
    widthPt: maxWidth,
    heightPt: totalHpx / PT_TO_PX,
  };
};

/**
 * Build the styled ad-intelligence PDF (creative + advertiser + timeline +
 * engagement + budget + tech stack + links) and trigger a browser download.
 * Used by the Download button on both MasonryCard and AdDetailModal so the
 * two surfaces produce identical reports.
 */
export const downloadAdAsPdf = async (ad) => {
  if (!ad) return;

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 36;
  const contentW = pageW - margin * 2;

  // Brand palette
  const BRAND = [51, 82, 150]; // #335296
  const ACCENT = [107, 153, 255]; // #6b99ff
  const INK = [24, 28, 40];
  const MUTED = [110, 116, 132];
  const RULE = [225, 228, 235];
  const BG_SOFT = [245, 247, 251];

  // Branded header band
  doc.setFillColor(...BRAND);
  doc.rect(0, 0, pageW, 70, "F");
  doc.setFillColor(...ACCENT);
  doc.rect(0, 70, pageW, 3, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("Ad Report", margin, 38);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(
    `${(ad.network || "-").toString().toUpperCase()}  ·  ${ad.adType || "-"}  ·  Generated ${new Date().toLocaleDateString()}`,
    margin,
    56,
  );

  let y = 96;

  const ensureSpace = (needed) => {
    if (y + needed > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  };

  const sectionHeader = (label) => {
    ensureSpace(28);
    doc.setFillColor(...BG_SOFT);
    doc.rect(margin, y, contentW, 20, "F");
    doc.setFillColor(...ACCENT);
    doc.rect(margin, y, 3, 20, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...BRAND);
    doc.text(label.toUpperCase(), margin + 10, y + 13);
    y += 26;
  };

  const labelColW = 110;
  const valueColW = contentW - labelColW - 6;
  const drawRows = (rows) => {
    doc.setFontSize(10);
    rows.forEach(([label, value]) => {
      if (value == null || value === "" || value === "—") return;
      const text = String(value);
      if (hasUnicode(text)) {
        const img = renderTextAsImage(text, {
          fontSize: 10,
          color: "#181c28",
          maxWidth: valueColW,
        });
        const rowH = Math.max(14, img.heightPt + 2);
        ensureSpace(rowH);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...MUTED);
        doc.text(label, margin, y + 10);
        doc.addImage(
          img.dataUrl,
          "PNG",
          margin + labelColW,
          y,
          img.widthPt,
          img.heightPt,
        );
        y += rowH;
      } else {
        const lines = doc.splitTextToSize(text, valueColW);
        const rowH = Math.max(14, lines.length * 12 + 2);
        ensureSpace(rowH);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...MUTED);
        doc.text(label, margin, y + 9);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...INK);
        doc.text(lines, margin + labelColW, y + 9);
        y += rowH;
      }
      doc.setDrawColor(...RULE);
      doc.line(margin, y, margin + contentW, y);
      y += 4;
    });
  };

  // ─── Thumbnail ────────────────────────────────────────────────
  const imgSrc =
    ad.thumbnail ||
    (Array.isArray(ad.carouselMedia) && ad.carouselMedia[0]) ||
    "";
  if (imgSrc) {
    try {
      const dataUrl = await fetchImageAsDataUrl(imgSrc);
      const probe = new window.Image();
      probe.src = dataUrl;
      await new Promise((resolve, reject) => {
        probe.onload = resolve;
        probe.onerror = reject;
      });
      const maxH = 260;
      const ratio = Math.min(
        contentW / probe.naturalWidth,
        maxH / probe.naturalHeight,
      );
      const drawW = probe.naturalWidth * ratio;
      const drawH = probe.naturalHeight * ratio;
      ensureSpace(drawH + 14);
      const x = margin + (contentW - drawW) / 2;
      doc.setFillColor(...BG_SOFT);
      doc.roundedRect(x - 4, y - 4, drawW + 8, drawH + 8, 4, 4, "F");
      const fmt = dataUrl.startsWith("data:image/png")
        ? "PNG"
        : dataUrl.startsWith("data:image/webp")
          ? "WEBP"
          : "JPEG";
      doc.addImage(dataUrl, fmt, x, y, drawW, drawH);
      y += drawH + 14;
    } catch {
      ensureSpace(40);
      doc.setFillColor(...BG_SOFT);
      doc.roundedRect(margin, y, contentW, 36, 4, 4, "F");
      doc.setFont("helvetica", "italic");
      doc.setFontSize(10);
      doc.setTextColor(...MUTED);
      doc.text("Preview unavailable", margin + contentW / 2, y + 22, {
        align: "center",
      });
      y += 44;
    }
  }

  // ─── Title ────────────────────────────────────────────────────
  const titleText = he.decode(ad.title || "") || "(untitled ad)";
  {
    const img = renderTextAsImage(titleText, {
      fontSize: 15,
      fontWeight: "bold",
      color: "#181c28",
      maxWidth: contentW,
    });
    ensureSpace(img.heightPt + 8);
    doc.addImage(img.dataUrl, "PNG", margin, y, img.widthPt, img.heightPt);
    y += img.heightPt + 8;
  }

  if (ad.subtitle || ad.adText) {
    /* v8 ignore next -- guarded by `if (ad.subtitle || ad.adText)` above, so the final `|| ""` is unreachable */
    const body = he.decode(ad.subtitle || ad.adText || "");
    const img = renderTextAsImage(body, {
      fontSize: 10.5,
      color: "#6e7484",
      maxWidth: contentW,
    });
    ensureSpace(img.heightPt + 8);
    doc.addImage(img.dataUrl, "PNG", margin, y, img.widthPt, img.heightPt);
    y += img.heightPt + 10;
  }

  // ─── Identity ─────────────────────────────────────────────────
  sectionHeader("Advertiser & Source");
  drawRows([
    ["Advertiser", ad.advertiser],
    ["Verified", ad.verified ? "Yes" : null],
    ["Network", ad.network],
    ["Ad Type", ad.adType],
    ["Status", ad.status],
    ["Industry", ad.industry],
    ["Language", ad.adLanguage || ad.language],
    ["Aspect Ratio", ad.aspectRatio],
  ]);

  // ─── Timeline ─────────────────────────────────────────────────
  sectionHeader("Timeline");
  drawRows([
    ["Posted", ad.date],
    ["First Seen", ad.firstSeen],
    ["Last Seen", ad.lastSeen],
    [
      "Running Days",
      ad.runningDays != null ? `${ad.runningDays} days` : null,
    ],
  ]);

  // ─── Engagement ───────────────────────────────────────────────
  sectionHeader("Engagement");
  const platform = String(ad.network || "").toLowerCase();
  const trioKeys = STAT_TRIOS[platform] || DEFAULT_TRIO;
  const trio = trioKeys.map((key) => ({
    key,
    /* v8 ignore next -- every trio key has a STAT_LABELS entry; the `|| key` fallback is defensive */
    label: STAT_LABELS[key] || key,
    value: resolveStatValue(key, ad),
  }));
  const tileW = (contentW - 12) / 3;
  ensureSpace(60);
  trio.slice(0, 3).forEach((s, i) => {
    const tx = margin + i * (tileW + 6);
    doc.setFillColor(...BG_SOFT);
    doc.roundedRect(tx, y, tileW, 52, 4, 4, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(...INK);
    doc.text(formatStat(s.value) || "N/A", tx + 10, y + 26);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    /* v8 ignore next -- s.label is always set from STAT_LABELS; the `|| ""` is defensive */
    doc.text((s.label || "").toUpperCase(), tx + 10, y + 42);
  });
  y += 60;
  drawRows([
    ["Impressions", formatStat(ad.impressions)],
    ["Views", formatStat(ad.views)],
    ["Likes", formatStat(ad.likes)],
    ["Comments", formatStat(ad.comments)],
    ["Shares", formatStat(ad.shares)],
    ["CTR", ad.ctr != null ? `${ad.ctr}%` : null],
    ["Engagement Rate", ad.engRate],
    ["Engagement / Day", ad.engPerDay],
    ["Popularity", ad.popularity != null ? String(ad.popularity) : null],
  ]);

  // ─── Budget ───────────────────────────────────────────────────
  const hasBudget =
    ad.budget || ad.adBudget || ad.lowerBudget || ad.upperBudget;
  if (hasBudget) {
    sectionHeader("Budget");
    drawRows([
      ["Budget", ad.budget || ad.adBudget],
      ["Lower Bound", ad.lowerBudget != null ? `$${ad.lowerBudget}` : null],
      ["Upper Bound", ad.upperBudget != null ? `$${ad.upperBudget}` : null],
    ]);
  }

  // ─── Tech stack ───────────────────────────────────────────────
  const stack = [
    [
      "E-commerce",
      Array.isArray(ad.builtWith) ? ad.builtWith.join(", ") : ad.builtWith,
    ],
    [
      "Funnels / Analytics",
      Array.isArray(ad.builtWithFunnel)
        ? ad.builtWithFunnel.join(", ")
        : ad.builtWithFunnel,
    ],
    ["Call to Action", ad.cta],
    [
      "Keywords",
      Array.isArray(ad.keywords) ? ad.keywords.join(", ") : ad.keywords,
    ],
  ].filter(([, v]) => v);
  if (stack.length) {
    sectionHeader("Tech Stack & Targeting");
    drawRows(stack);
  }

  // ─── URLs ─────────────────────────────────────────────────────
  const urls = [
    ["Destination URL", ad.destinationUrl],
    ["Ad URL", ad.adUrl],
    ["Meta Ad URL", ad.metaAdUrl],
  ].filter(([, v]) => v);
  if (urls.length) {
    sectionHeader("Links");
    doc.setFontSize(10);
    urls.forEach(([label, url]) => {
      const lines = doc.splitTextToSize(url, valueColW);
      const rowH = Math.max(14, lines.length * 12 + 2);
      ensureSpace(rowH);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...MUTED);
      doc.text(label, margin, y + 9);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...ACCENT);
      doc.text(lines, margin + labelColW, y + 9);
      lines.forEach((ln, i) => {
        const w = doc.getTextWidth(ln);
        doc.link(margin + labelColW, y + 1 + i * 12, w, 12, { url });
      });
      y += rowH;
      doc.setDrawColor(...RULE);
      doc.line(margin, y, margin + contentW, y);
      y += 4;
    });
  }

  // Per-page footer
  const totalPages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text("PowerAdspy — Ad Intelligence Report", margin, pageH - 18);
    doc.text(`Page ${p} of ${totalPages}`, pageW - margin, pageH - 18, {
      align: "right",
    });
  }

  const safeName = (ad.title || ad.advertiser || "ad")
    .replace(/[^a-zA-Z0-9]/g, "_")
    .slice(0, 60);
  doc.save(`${safeName}.pdf`);
};
