import React, { useState, useRef, useCallback } from "react";
import { HiDownload } from "react-icons/hi";
import TopUsers from "./TopUsers";
import AllSearches from "./AllSearches";
import KeywordTrends from "./KeywordTrends";
import Projects from "./Projects";

const TABS = [
  { key: "top-users",      label: "Top users" },
  { key: "all-searches",   label: "All searches" },
  { key: "keyword-trends", label: "Keyword trends" },
  { key: "projects",       label: "Projects" },
];

const TAB_LABELS = {
  "top-users":      "Top users",
  "all-searches":   "All searches (full 90-day log)",
  "keyword-trends": "Keyword trends",
  "projects":       "Projects (full 90-day log)",
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Draw a filled rounded rectangle (jsPDF has no native roundedRect with fill in all versions)
function roundedRect(pdf, x, y, w, h, r, fillHex) {
  const [R, G, B] = hexToRgb(fillHex);
  pdf.setFillColor(R, G, B);
  pdf.roundedRect(x, y, w, h, r, r, "F");
}

// Draw text clipped to a max width using jsPDF text split
function clippedText(pdf, text, x, y, maxW) {
  const str = String(text ?? "");
  const lines = pdf.splitTextToSize(str, maxW);
  pdf.text(lines[0] ?? "", x, y);
}

// Draw a pill / badge — maxW caps the pill width (text is clipped to fit)
function drawPill(pdf, label, x, y, pillH, bgHex, textHex, fontSize, maxW) {
  const pad = 6;
  pdf.setFontSize(fontSize);
  const fullTextW = pdf.getTextWidth(label);
  const fullPillW = fullTextW + pad * 2;
  const pillW = maxW ? Math.min(fullPillW, maxW) : fullPillW;
  const availTextW = pillW - pad * 2;
  // Truncate label to fit if capped
  let displayLabel = label;
  if (maxW && fullPillW > maxW) {
    const lines = pdf.splitTextToSize(label, availTextW);
    displayLabel = lines[0] ?? label;
  }
  roundedRect(pdf, x, y, pillW, pillH, 2, bgHex);
  const [tR, tG, tB] = hexToRgb(textHex);
  pdf.setTextColor(tR, tG, tB);
  pdf.text(displayLabel, x + pad, y + pillH - (pillH - fontSize * 0.75) / 2 - 1);
  return pillW;
}

// Draw avatar circle with initials
function drawAvatar(pdf, initials, cx, cy, r, bgHex) {
  const [R, G, B] = hexToRgb(bgHex);
  pdf.setFillColor(R, G, B);
  pdf.circle(cx, cy, r, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(7);
  pdf.setFont("helvetica", "bold");
  const tw = pdf.getTextWidth(initials);
  pdf.text(initials, cx - tw / 2, cy + 2.5);
}

function getInitials(userId) {
  const id = String(userId ?? "");
  if (!id) return "?";
  const parts = id.split(/[@._\s]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return id.slice(0, 2).toUpperCase();
}

const AVATAR_COLORS = [
  "#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6",
  "#3b82f6", "#ec4899", "#14b8a6", "#f97316", "#06b6d4",
];

function getColor(userId) {
  const id = String(userId ?? "");
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// Replace Unicode characters that helvetica can't render
function pdfSafe(str) {
  return String(str ?? "")
    .replace(/↑/g, "(+)")
    .replace(/↓/g, "(-)")
    .replace(/→/g, " -> ")
    .replace(/←/g, " <- ")
    .replace(/[‐‑‒–—―]/g, "-")   // all Unicode dashes
    .replace(/[^\x00-\x7E]/g, (ch) => {
      // catch-all: replace any remaining non-ASCII with closest ASCII or space
      const map = { '…': '...', '·': '.', 'ℹ': 'i', '–': '-', '—': '-', '→': '->' };
      return map[ch] ?? ' ';
    });
}

// ─── native Top Users PDF ─────────────────────────────────────────────────────

async function exportTopUsersPDF(data) {
  const { jsPDF } = await import("jspdf");

  const { statCards, sortedUsers, filterActive, flaggedOnly, dateRange, appliedFrom, appliedTo } = data;

  // Landscape A4 to fit all 8 columns comfortably
  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const MARGIN = 24;
  const availW = pageW - MARGIN * 2;
  const HEADER_H = 52;
  const FOOTER_H = 24;
  const contentTop = HEADER_H + 10;
  const dateStr = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  // ── header / footer ──
  const drawHeader = (pageNum) => {
    pdf.setFillColor(255, 255, 255);
    pdf.rect(0, 0, pageW, HEADER_H, "F");
    pdf.setDrawColor(229, 231, 235);
    pdf.line(0, HEADER_H, pageW, HEADER_H);
    pdf.setFontSize(15);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(17, 24, 39);
    pdf.text("Search Intelligence", MARGIN, 26);
    pdf.setFontSize(9);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(107, 114, 128);
    pdf.text(pdfSafe(`Top users  .  ${dateStr}${pageNum > 1 ? `  .  Page ${pageNum}` : ""}`), MARGIN, 42);
  };

  const drawFooter = () => {
    pdf.setFontSize(8);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(156, 163, 175);
    pdf.text("PowerAdSpy Admin  ·  Search Intelligence Export", pageW / 2, pageH - 8, { align: "center" });
  };

  let pageNum = 1;
  drawHeader(pageNum);
  drawFooter();
  let curY = contentTop;

  const newPage = () => {
    pdf.addPage();
    pageNum++;
    drawHeader(pageNum);
    drawFooter();
    curY = contentTop;
  };

  const ensureSpace = (needed) => {
    if (curY + needed > pageH - FOOTER_H - 8) newPage();
  };

  // ── stat cards (4 across) ──
  const CARD_COLS = 4;
  const cardGap = 12;
  const cardW = (availW - cardGap * (CARD_COLS - 1)) / CARD_COLS;
  const cardH = 78; // taller to fit value + label + prev + trend

  statCards.forEach((card, i) => {
    const col = i % CARD_COLS;
    const cx = MARGIN + col * (cardW + cardGap);
    const cy = curY;

    roundedRect(pdf, cx, cy, cardW, cardH, 6, "#f3f4f6");

    // Value
    const [vR, vG, vB] = hexToRgb(card.colorHex ?? "#111827");
    pdf.setTextColor(vR, vG, vB);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(22);
    pdf.text(pdfSafe(card.value), cx + 14, cy + 28);

    // Label
    pdf.setTextColor(107, 114, 128);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7.5);
    pdf.text(pdfSafe(card.label), cx + 14, cy + 41);

    // Prev value line
    if (card.prev_value != null) {
      pdf.setTextColor(156, 163, 175);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7.5);
      pdf.text(`prev: ${Number(card.prev_value).toLocaleString()}`, cx + 14, cy + 53);
    } else if (card.sub) {
      pdf.setTextColor(156, 163, 175);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7);
      const subLines = pdf.splitTextToSize(pdfSafe(card.sub), cardW - 28);
      pdf.text(subLines[0] ?? "", cx + 14, cy + 53);
    }

    // Trend text
    if (card.text) {
      const tColor = card.up === true ? "#10b981" : card.up === false ? "#ef4444" : "#9ca3af";
      const [tR, tG, tB] = hexToRgb(tColor);
      pdf.setTextColor(tR, tG, tB);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7.5);
      const trendLines = pdf.splitTextToSize(pdfSafe(card.text), cardW - 28);
      pdf.text(trendLines[0] ?? "", cx + 14, cy + 65);
    }
  });

  curY += cardH + 18;

  // ── filter summary pills ──
  const filterPills = [];
  filterPills.push(dateRange === "Custom" && appliedFrom && appliedTo
    ? `${appliedFrom} → ${appliedTo}`
    : dateRange);
  if (filterActive.keyword)            filterPills.push(`Keyword: ${filterActive.keyword}`);
  if (filterActive.advertiser)         filterPills.push(`Advertiser: ${filterActive.advertiser}`);
  if (filterActive.domain)             filterPills.push(`Domain: ${filterActive.domain}`);
  if (filterActive.platform !== "Any") filterPills.push(`Platform: ${filterActive.platform}`);
  if (flaggedOnly)                      filterPills.push("Flagged only");

  const PILL_H = 15;
  const PILL_GAP = 5;
  let px = MARGIN;
  filterPills.forEach((pill) => {
    pdf.setFontSize(7.5);
    const pw = pdf.getTextWidth(pill) + 14;
    if (px + pw > MARGIN + availW) { px = MARGIN; curY += PILL_H + PILL_GAP; }
    drawPill(pdf, pill, px, curY, PILL_H, "#e0e7ff", "#4338ca", 7.5);
    px += pw + PILL_GAP;
  });
  curY += PILL_H + 14;

  // ── section title ──
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.setTextColor(55, 65, 81);
  pdf.text("TOP USERS BY SEARCH VOLUME", MARGIN, curY);
  curY += 14;

  // ── table columns: # | USER | SEARCHES | TOP KEYWORD | TOP ADVERTISER | TOP DOMAIN | TOP FILTER | PLATFORM ──
  // col indices:        0    1          2            3               4           5           6          7
  const COL_W = [24, 148, 52, 90, 82, 82, 0, 62];
  // col 6 (TOP FILTER) gets the remaining space
  COL_W[6] = availW - COL_W.reduce((s, v) => s + v, 0);
  const COL_X = COL_W.reduce((acc, w, i) => {
    acc.push(i === 0 ? MARGIN : acc[i - 1] + COL_W[i - 1]);
    return acc;
  }, []);
  const HEADERS = ["#", "USER", "SEARCHES", "TOP KEYWORD", "TOP ADVERTISER", "TOP DOMAIN", "TOP FILTER", "PLATFORM"];
  const HEAD_H = 22;
  const MIN_ROW_H = 28;
  const PILL_ROW_H = 16; // height of each filter pill row inside a cell
  const PILL_ROW_GAP = 3;

  // Table header
  ensureSpace(HEAD_H + MIN_ROW_H);
  pdf.setFillColor(249, 250, 251);
  pdf.rect(MARGIN, curY, availW, HEAD_H, "F");
  pdf.setDrawColor(229, 231, 235);
  pdf.rect(MARGIN, curY, availW, HEAD_H);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(7.5);
  pdf.setTextColor(156, 163, 175);
  HEADERS.forEach((h, i) => {
    pdf.text(h, COL_X[i] + 4, curY + HEAD_H / 2 + 3);
  });
  curY += HEAD_H;

  // Table rows
  sortedUsers.forEach((user, idx) => {
    const isAnomaly = user.anomaly_flag;
    const rowBg = isAnomaly ? "#fffbeb" : (idx % 2 === 0 ? "#ffffff" : "#f9fafb");

    const email = user.email || user.user_id || "";
    const emailLines = pdf.splitTextToSize(email, COL_W[1] - 34);

    const topFilters = Array.isArray(user.top_filter)
      ? user.top_filter
      : (user.top_filter ? [user.top_filter] : []);

    // Row height: enough for email lines OR filter pills (whichever is taller), minimum MIN_ROW_H
    const emailH  = Math.max(emailLines.length, 1) * 11 + 8;
    const filterH = topFilters.length > 0
      ? topFilters.length * (PILL_ROW_H + PILL_ROW_GAP) - PILL_ROW_GAP + 8
      : MIN_ROW_H;
    const thisRowH = Math.max(MIN_ROW_H, emailH, filterH);

    ensureSpace(thisRowH);

    // Row bg
    const [rb, gb, bb] = hexToRgb(rowBg);
    pdf.setFillColor(rb, gb, bb);
    pdf.rect(MARGIN, curY, availW, thisRowH, "F");
    pdf.setDrawColor(243, 244, 246);
    pdf.line(MARGIN, curY + thisRowH, MARGIN + availW, curY + thisRowH);

    const midY      = curY + thisRowH / 2;
    const textBaseY = midY + 3.5;
    // Top-aligned start for filter pills (always top-aligned in their cell)
    const filterPillTop = curY + (thisRowH - (topFilters.length * (PILL_ROW_H + PILL_ROW_GAP) - PILL_ROW_GAP)) / 2;

    // # col
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(156, 163, 175);
    pdf.text(String(idx + 1), COL_X[0] + 4, textBaseY);

    // USER col — avatar and email both centered vertically
    const lineH  = 11;
    const totalEmailH = emailLines.length * lineH;
    const emailStartY = midY - totalEmailH / 2 + lineH * 0.75; // baseline of first line
    drawAvatar(pdf, getInitials(email), COL_X[1] + 11, midY, 9, getColor(email));
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8.5);
    pdf.setTextColor(17, 24, 39);
    const emailX = COL_X[1] + 26;
    emailLines.forEach((line, li) => {
      pdf.text(pdfSafe(line), emailX, emailStartY + li * lineH);
    });

    // SEARCHES col
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(17, 24, 39);
    pdf.text(
      Number(user.doc_count ?? user.search_count ?? 0).toLocaleString(),
      COL_X[2] + 4,
      textBaseY
    );

    // TOP KEYWORD pill
    if (user.top_keyword) {
      drawPill(pdf, pdfSafe(user.top_keyword), COL_X[3] + 4, midY - 7, 14, "#e0e7ff", "#4338ca", 7.5, COL_W[3] - 8);
    } else {
      pdf.setFont("helvetica", "normal"); pdf.setFontSize(9); pdf.setTextColor(156, 163, 175);
      pdf.text("-", COL_X[3] + 4, textBaseY);
    }

    // TOP ADVERTISER
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8.5);
    pdf.setTextColor(55, 65, 81);
    clippedText(pdf, pdfSafe(user.top_advertiser ?? "-"), COL_X[4] + 4, textBaseY, COL_W[4] - 8);

    // TOP DOMAIN
    clippedText(pdf, pdfSafe(user.top_domain ?? "-"), COL_X[5] + 4, textBaseY, COL_W[5] - 8);

    // TOP FILTER — stacked pills, one per row
    if (topFilters.length === 0) {
      pdf.setFont("helvetica", "normal"); pdf.setFontSize(9); pdf.setTextColor(156, 163, 175);
      pdf.text("-", COL_X[6] + 4, textBaseY);
    } else {
      const pillBg   = isAnomaly ? "#fef3c7" : "#f3f4f6";
      const pillText = isAnomaly ? "#d97706" : "#374151";
      topFilters.forEach((f, fi) => {
        const fy = filterPillTop + fi * (PILL_ROW_H + PILL_ROW_GAP);
        drawPill(pdf, pdfSafe(f), COL_X[6] + 4, fy, PILL_ROW_H, pillBg, pillText, 7, COL_W[6] - 8);
      });
    }

    // PLATFORM pill
    if (user.top_platform) {
      drawPill(pdf, pdfSafe(user.top_platform), COL_X[7] + 4, midY - 7, 14, "#e0e7ff", "#4338ca", 7.5, COL_W[7] - 8);
    } else {
      pdf.setFont("helvetica", "normal"); pdf.setFontSize(9); pdf.setTextColor(156, 163, 175);
      pdf.text("-", COL_X[7] + 4, textBaseY);
    }

    curY += thisRowH;
  });

  if (sortedUsers.length === 0) {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(156, 163, 175);
    pdf.text("No data found for this period.", MARGIN + availW / 2, curY + 20, { align: "center" });
  }

  pdf.save(`search-intelligence-top-users-${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ─── All Searches PDF ─────────────────────────────────────────────────────────

async function exportAllSearchesPDF(data) {
  console.log("exportAllSearchesPDF", data);
  const { jsPDF } = await import("jspdf");
  const { rows, applied, total, dateLabel } = data;

  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const MARGIN = 24;
  const availW = pageW - MARGIN * 2;
  const HEADER_H = 52;
  const FOOTER_H = 24;
  const dateStr = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  const drawHeader = (pageNum) => {
    pdf.setFillColor(255, 255, 255);
    pdf.rect(0, 0, pageW, HEADER_H, "F");
    pdf.setDrawColor(229, 231, 235);
    pdf.line(0, HEADER_H, pageW, HEADER_H);
    pdf.setFontSize(15); pdf.setFont("helvetica", "bold"); pdf.setTextColor(17, 24, 39);
    pdf.text("Search Intelligence", MARGIN, 26);
    pdf.setFontSize(9); pdf.setFont("helvetica", "normal"); pdf.setTextColor(107, 114, 128);
    pdf.text(pdfSafe(`All searches  ${dateLabel ? ". " + dateLabel + "  " : ""}. ${dateStr}${pageNum > 1 ? `  .  Page ${pageNum}` : ""}`), MARGIN, 42);
  };
  const drawFooter = () => {
    pdf.setFontSize(8); pdf.setFont("helvetica", "normal"); pdf.setTextColor(156, 163, 175);
    pdf.text("PowerAdSpy Admin  ·  Search Intelligence Export", pageW / 2, pageH - 8, { align: "center" });
  };

  let pageNum = 1;
  drawHeader(pageNum); drawFooter();
  let curY = HEADER_H + 10;

  const newPage = () => { pdf.addPage(); pageNum++; drawHeader(pageNum); drawFooter(); curY = HEADER_H + 10; };
  const ensureSpace = (n) => { if (curY + n > pageH - FOOTER_H - 8) newPage(); };

  // Active filter pills
  const filterPills = [applied.dateRange];
  if (applied.platform !== "Any") filterPills.push(`Platform: ${applied.platform}`);
  if (applied.userFilter)         filterPills.push(`User: ${applied.userFilter}`);
  if (applied.keyword)            filterPills.push(`Keyword: ${applied.keyword}`);
  if (applied.advertiser)         filterPills.push(`Advertiser: ${applied.advertiser}`);
  if (applied.domain)             filterPills.push(`Domain: ${applied.domain}`);
  if (applied.country)            filterPills.push(`Country: ${applied.country}`);

  const PILL_H = 15; const PILL_GAP = 5;
  let px = MARGIN;
  filterPills.forEach((pill) => {
    pdf.setFontSize(7.5);
    const pw = pdf.getTextWidth(pill) + 14;
    if (px + pw > MARGIN + availW) { px = MARGIN; curY += PILL_H + PILL_GAP; }
    drawPill(pdf, pill, px, curY, PILL_H, "#e0e7ff", "#4338ca", 7.5);
    px += pw + PILL_GAP;
  });
  curY += PILL_H + 10;

  // Summary
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(8.5); pdf.setTextColor(107, 114, 128);
  pdf.text(pdfSafe(`${total.toLocaleString()} searches matched${dateLabel ? " · " + dateLabel : ""}`), MARGIN, curY);
  curY += 14;

  // Columns: TIMESTAMP | USER | KEYWORD | ADVERTISER | DOMAIN | PLATFORM | AD COUNT | OTHER ACTIVITY | FILTERS APPLIED
  // availW landscape A4 ≈ 793pt; allocate space: TIMESTAMP+USER+KEYWORD+ADVERTISER+DOMAIN+ADS+OTHER = 420, remaining split between PLATFORM(90) and FILTERS(283)
  const COL_W = [60, 110, 60, 60, 55, 90, 30, 95, 0];
  COL_W[8] = availW - COL_W.reduce((s, v) => s + v, 0);
  const COL_X = COL_W.reduce((acc, w, i) => { acc.push(i === 0 ? MARGIN : acc[i-1] + COL_W[i-1]); return acc; }, []);
  const HEADERS = ["TIMESTAMP", "USER", "KEYWORD", "ADVERTISER", "DOMAIN", "PLATFORM", "ADS", "OTHER ACTIVITY", "FILTERS APPLIED"];
  const HEAD_H = 22; const MIN_ROW_H = 26; const PILL_ROW_H = 15; const PILL_ROW_GAP = 3;

  ensureSpace(HEAD_H + MIN_ROW_H);
  pdf.setFillColor(249, 250, 251); pdf.rect(MARGIN, curY, availW, HEAD_H, "F");
  pdf.setDrawColor(229, 231, 235); pdf.rect(MARGIN, curY, availW, HEAD_H);
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(7); pdf.setTextColor(156, 163, 175);
  HEADERS.forEach((h, i) => pdf.text(h, COL_X[i] + 3, curY + HEAD_H / 2 + 3));
  curY += HEAD_H;

  rows.forEach((row, idx) => {
    const filters = row.filters_applied ?? [];
    const platforms = row.platform ? String(row.platform).split(',').map(p => p.trim()).filter(Boolean) : [];
    const email = row.email ?? "-";
    pdf.setFontSize(7.5);
    const emailLines = pdf.splitTextToSize(pdfSafe(email), COL_W[1] - 26);
    const emailH = Math.max(emailLines.length, 1) * 10 + 8;
    const filterH = filters.length > 0 ? filters.length * (PILL_ROW_H + PILL_ROW_GAP) - PILL_ROW_GAP + 6 : 0;
    const platformH = platforms.length > 0 ? platforms.length * (PILL_ROW_H + PILL_ROW_GAP) - PILL_ROW_GAP + 6 : 0;
    const thisRowH = Math.max(MIN_ROW_H, emailH, filterH, platformH);
    ensureSpace(thisRowH);

    const rowBg = idx % 2 === 0 ? "#ffffff" : "#f9fafb";
    const [rb, gb, bb] = hexToRgb(rowBg);
    pdf.setFillColor(rb, gb, bb); pdf.rect(MARGIN, curY, availW, thisRowH, "F");
    pdf.setDrawColor(243, 244, 246); pdf.line(MARGIN, curY + thisRowH, MARGIN + availW, curY + thisRowH);

    const midY = curY + thisRowH / 2;
    const textBaseY = midY + 3.5;

    // TIMESTAMP
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(7.5); pdf.setTextColor(107, 114, 128);
    clippedText(pdf, pdfSafe(row.timestamp ?? "-"), COL_X[0] + 3, textBaseY, COL_W[0] - 6);

    // USER (avatar + email, multi-line)
    const { initials: ini, color: avatarCol } = (() => {
      const e = row.email ?? "";
      const parts = e.split(/[@._]/);
      const ini = ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || (e[0] ?? "?").toUpperCase();
      let hash = 0; for (let c of e) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
      const COLORS2 = ["#6366f1","#f59e0b","#10b981","#ef4444","#8b5cf6","#3b82f6","#ec4899","#14b8a6","#f97316","#06b6d4"];
      return { initials: ini, color: COLORS2[hash % COLORS2.length] };
    })();
    drawAvatar(pdf, ini, COL_X[1] + 9, midY, 8, avatarCol);
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(7.5); pdf.setTextColor(17, 24, 39);
    const lineH = 10;
    const emailStartY = midY - (emailLines.length * lineH) / 2 + lineH * 0.75;
    emailLines.forEach((ln, li) => pdf.text(ln, COL_X[1] + 22, emailStartY + li * lineH));

    // KEYWORD pill
    if (row.keyword) {
      drawPill(pdf, pdfSafe(row.keyword), COL_X[2] + 3, midY - 7, 14, "#e0e7ff", "#4338ca", 7, COL_W[2]-6);
    } else { pdf.setTextColor(156,163,175); pdf.text("-", COL_X[2]+3, textBaseY); }

    // ADVERTISER
    pdf.setFont("helvetica","normal"); pdf.setFontSize(7.5); pdf.setTextColor(55,65,81);
    clippedText(pdf, pdfSafe(row.advertiser ?? "-"), COL_X[3]+3, textBaseY, COL_W[3]-6);

    // DOMAIN
    clippedText(pdf, pdfSafe(row.domain ?? "-"), COL_X[4]+3, textBaseY, COL_W[4]-6);

    // PLATFORM pills (stacked)
    if (platforms.length === 0) {
      pdf.setTextColor(156,163,175); pdf.text("-", COL_X[5]+3, textBaseY);
    } else {
      platforms.forEach((p, pi) => {
        drawPill(pdf, pdfSafe(p), COL_X[5]+3, curY + 4 + pi * 13, 12, "#e0e7ff", "#4338ca", 7);
      });
    }

    // AD COUNT
    pdf.setFont("helvetica","bold"); pdf.setFontSize(8); pdf.setTextColor(17,24,39);
    pdf.text(row.ads_count != null ? String(row.ads_count) : "-", COL_X[6]+3, textBaseY);

    // OTHER ACTIVITY — capped to column width
    if (row.other_activity) {
      drawPill(pdf, pdfSafe(row.other_activity), COL_X[7]+3, midY-6, 13, "#fef3c7", "#d97706", 7, COL_W[7]-6);
    } else { pdf.setFont("helvetica","normal"); pdf.setFontSize(8); pdf.setTextColor(156,163,175); pdf.text("-", COL_X[7]+3, textBaseY); }

    // FILTERS APPLIED — stacked pills, each capped to column width
    const filterPillTop2 = filters.length > 0
      ? curY + (thisRowH - (filters.length * (PILL_ROW_H + PILL_ROW_GAP) - PILL_ROW_GAP)) / 2
      : curY;
    if (filters.length === 0) {
      pdf.setFont("helvetica","normal"); pdf.setFontSize(8); pdf.setTextColor(156,163,175);
      pdf.text("-", COL_X[8]+3, textBaseY);
    } else {
      filters.forEach((f, fi) => {
        const fy = filterPillTop2 + fi * (PILL_ROW_H + PILL_ROW_GAP);
        drawPill(pdf, pdfSafe(f), COL_X[8]+3, fy, PILL_ROW_H, "#f3f4f6", "#374151", 7, COL_W[8]-6);
      });
    }

    curY += thisRowH;
  });

  if (rows.length === 0) {
    pdf.setFont("helvetica","normal"); pdf.setFontSize(9); pdf.setTextColor(156,163,175);
    pdf.text("No search events found.", MARGIN + availW/2, curY+20, { align: "center" });
  }

  pdf.save(`search-intelligence-all-searches-${new Date().toISOString().slice(0,10)}.pdf`);
}

// ─── Projects PDF ──────────────────────────────────────────────────────────────

async function exportProjectsPDF(data) {
  const { jsPDF } = await import("jspdf");
  const { rows, applied, total, dateLabel } = data;

  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const MARGIN = 24;
  const availW = pageW - MARGIN * 2;
  const HEADER_H = 52;
  const FOOTER_H = 24;
  const dateStr = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  const drawHeader = (pageNum) => {
    pdf.setFillColor(255,255,255); pdf.rect(0,0,pageW,HEADER_H,"F");
    pdf.setDrawColor(229,231,235); pdf.line(0,HEADER_H,pageW,HEADER_H);
    pdf.setFontSize(15); pdf.setFont("helvetica","bold"); pdf.setTextColor(17,24,39);
    pdf.text("Search Intelligence", MARGIN, 26);
    pdf.setFontSize(9); pdf.setFont("helvetica","normal"); pdf.setTextColor(107,114,128);
    pdf.text(pdfSafe(`Projects  .  ${dateStr}${pageNum>1 ? `  .  Page ${pageNum}` : ""}`), MARGIN, 42);
  };
  const drawFooter = () => {
    pdf.setFontSize(8); pdf.setFont("helvetica","normal"); pdf.setTextColor(156,163,175);
    pdf.text("PowerAdSpy Admin  ·  Search Intelligence Export", pageW/2, pageH-8, { align: "center" });
  };

  let pageNum = 1;
  drawHeader(pageNum); drawFooter();
  let curY = HEADER_H + 10;
  const newPage = () => { pdf.addPage(); pageNum++; drawHeader(pageNum); drawFooter(); curY = HEADER_H+10; };
  const ensureSpace = (n) => { if (curY + n > pageH - FOOTER_H - 8) newPage(); };

  // Filter pills
  const filterPills = [applied.dateRange];
  if (applied.userFilter) filterPills.push(`User: ${applied.userFilter}`);
  const PILL_H = 15; const PILL_GAP = 5;
  let px = MARGIN;
  filterPills.forEach((pill) => {
    pdf.setFontSize(7.5);
    const pw = pdf.getTextWidth(pill) + 14;
    if (px + pw > MARGIN + availW) { px = MARGIN; curY += PILL_H + PILL_GAP; }
    drawPill(pdf, pill, px, curY, PILL_H, "#e0e7ff", "#4338ca", 7.5);
    px += pw + PILL_GAP;
  });
  curY += PILL_H + 10;

  // Summary
  pdf.setFont("helvetica","normal"); pdf.setFontSize(8.5); pdf.setTextColor(107,114,128);
  pdf.text(pdfSafe(`${total.toLocaleString()} project events${dateLabel ? " · "+dateLabel : ""}`), MARGIN, curY);
  curY += 14;

  const PROJECT_TYPE_LABELS = {
    project_click:         { label: "Project Click",        textCol: "#6366f1", bgCol: "#e0e7ff" },
    competitor_comparison: { label: "Competitor Comparison",textCol: "#d97706", bgCol: "#fef3c7" },
    dashboard:             { label: "Dashboard",            textCol: "#059669", bgCol: "#d1fae5" },
    delete_brand:          { label: "Delete Brand",         textCol: "#dc2626", bgCol: "#fee2e2" },
    monitoring_status:     { label: "Monitoring Status",    textCol: "#7c3aed", bgCol: "#ede9fe" },
    add_member:            { label: "Added Member",         textCol: "#15803d", bgCol: "#dcfce7" },
    delete_member:         { label: "Deleted Member",       textCol: "#b91c1c", bgCol: "#fee2e2" },
    export_competitors:    { label: "Exported Competitors", textCol: "#0c4a6e", bgCol: "#dbeafe" },
    other:                 { label: "Other",                textCol: "#6b7280", bgCol: "#f3f4f6" },
  };

  // Columns: TIMESTAMP | USER | TYPE | BRANDS | COMPETITORS | MEMBER NAME | MEMBER EMAIL | EXPORTED COMPETITORS
  const COL_W = [85, 130, 120, 90, 100, 100, 110, 0];
  COL_W[7] = availW - COL_W.reduce((s, v) => s + v, 0);
  const COL_X = COL_W.reduce((acc, w, i) => { acc.push(i===0 ? MARGIN : acc[i-1]+COL_W[i-1]); return acc; }, []);
  const HEADERS = ["TIMESTAMP", "USER", "TYPE", "BRANDS", "COMPETITORS", "MEMBER NAME", "MEMBER EMAIL", "EXPORTED COMPETITORS"];
  const HEAD_H = 22; const MIN_ROW_H = 28; const TAG_ROW_H = 15; const TAG_GAP = 3;

  ensureSpace(HEAD_H + MIN_ROW_H);
  pdf.setFillColor(249,250,251); pdf.rect(MARGIN,curY,availW,HEAD_H,"F");
  pdf.setDrawColor(229,231,235); pdf.rect(MARGIN,curY,availW,HEAD_H);
  pdf.setFont("helvetica","bold"); pdf.setFontSize(7.5); pdf.setTextColor(156,163,175);
  HEADERS.forEach((h,i) => pdf.text(h, COL_X[i]+4, curY+HEAD_H/2+3));
  curY += HEAD_H;

  rows.forEach((row, idx) => {
    const brands = row.brands ? row.brands.split(', ').filter(Boolean) : [];
    const competitors = row.competitors ? row.competitors.split(', ').filter(Boolean) : [];
    const maxTags = Math.max(brands.length, competitors.length, 1);
    const tagsH = maxTags * (TAG_ROW_H + TAG_GAP) - TAG_GAP + 8;
    const thisRowH = Math.max(MIN_ROW_H, tagsH);
    ensureSpace(thisRowH);

    const rowBg = idx % 2 === 0 ? "#ffffff" : "#f9fafb";
    const [rb,gb,bb] = hexToRgb(rowBg);
    pdf.setFillColor(rb,gb,bb); pdf.rect(MARGIN,curY,availW,thisRowH,"F");
    pdf.setDrawColor(243,244,246); pdf.line(MARGIN,curY+thisRowH,MARGIN+availW,curY+thisRowH);

    const midY = curY + thisRowH / 2;
    const textBaseY = midY + 3.5;

    // TIMESTAMP
    pdf.setFont("helvetica","normal"); pdf.setFontSize(8); pdf.setTextColor(107,114,128);
    clippedText(pdf, pdfSafe(row.timestamp ?? "-"), COL_X[0]+4, textBaseY, COL_W[0]-8);

    // USER
    const { initials: ini2, color: avatarCol2 } = (() => {
      const e = row.email ?? "";
      const parts = e.split(/[@._]/);
      const ini = ((parts[0]?.[0]??"")+(parts[1]?.[0]??"")).toUpperCase()||(e[0]??"?").toUpperCase();
      let hash = 0; for (let c of e) hash=(hash*31+c.charCodeAt(0))>>>0;
      const C=["#6366f1","#f59e0b","#10b981","#ef4444","#8b5cf6","#3b82f6","#ec4899","#14b8a6","#f97316","#06b6d4"];
      return { initials: ini, color: C[hash%C.length] };
    })();
    drawAvatar(pdf, ini2, COL_X[1]+10, midY, 9, avatarCol2);
    pdf.setFont("helvetica","normal"); pdf.setFontSize(8); pdf.setTextColor(17,24,39);
    const emailLines2 = pdf.splitTextToSize(pdfSafe(row.email ?? "-"), COL_W[1]-28);
    const emailStartY2 = midY - (emailLines2.length * 9)/2 + 7;
    emailLines2.forEach((ln, li) => pdf.text(ln, COL_X[1]+24, emailStartY2 + li * 10));

    // TYPE pill
    const typeInfo = PROJECT_TYPE_LABELS[row.project_type] ?? PROJECT_TYPE_LABELS.other;
    const typeLabel = row.project_type === "monitoring_status" && row.monitoring_status != null
      ? `Monitoring: ${String(row.monitoring_status).charAt(0).toUpperCase()+String(row.monitoring_status).slice(1)}`
      : typeInfo.label;
    drawPill(pdf, pdfSafe(typeLabel), COL_X[2]+4, midY-7, 14, typeInfo.bgCol, typeInfo.textCol, 7.5);

    // BRANDS stacked
    const brandsTop = curY + (thisRowH - (brands.length||1) * (TAG_ROW_H+TAG_GAP) + TAG_GAP) / 2;
    if (brands.length === 0) {
      pdf.setFont("helvetica","normal"); pdf.setFontSize(8); pdf.setTextColor(156,163,175);
      pdf.text("-", COL_X[3]+4, textBaseY);
    } else {
      brands.forEach((b, bi) => {
        drawPill(pdf, pdfSafe(b), COL_X[3]+4, brandsTop + bi*(TAG_ROW_H+TAG_GAP), TAG_ROW_H, "#f3f4f6", "#374151", 7, COL_W[3]-8);
      });
    }

    // COMPETITORS stacked
    const compTop = curY + (thisRowH - (competitors.length||1) * (TAG_ROW_H+TAG_GAP) + TAG_GAP) / 2;
    if (competitors.length === 0) {
      pdf.setFont("helvetica","normal"); pdf.setFontSize(8); pdf.setTextColor(156,163,175);
      pdf.text("-", COL_X[4]+4, textBaseY);
    } else {
      competitors.forEach((c, ci) => {
        drawPill(pdf, pdfSafe(c), COL_X[4]+4, compTop + ci*(TAG_ROW_H+TAG_GAP), TAG_ROW_H, "#e0e7ff", "#4338ca", 7, COL_W[4]-8);
      });
    }

    // MEMBER NAME
    let memberName = "-";
    if (row.method === "add_member") {
      memberName = row.member_name ?? "-";
    } else if (row.method === "delete_member") {
      memberName = row.delete_member_name ?? "-";
    }
    pdf.setFont("helvetica","normal"); pdf.setFontSize(8); pdf.setTextColor(17,24,39);
    clippedText(pdf, pdfSafe(memberName), COL_X[5]+4, textBaseY, COL_W[5]-8);

    // MEMBER EMAIL
    let memberEmail = "-";
    if (row.method === "add_member") {
      memberEmail = row.member_email ?? "-";
    } else if (row.method === "delete_member") {
      memberEmail = row.delete_member_email ?? "-";
    }
    pdf.setFont("helvetica","normal"); pdf.setFontSize(8); pdf.setTextColor(17,24,39);
    clippedText(pdf, pdfSafe(memberEmail), COL_X[6]+4, textBaseY, COL_W[6]-8);

    // EXPORTED COMPETITORS
    const exportedComps = (row.method === "export_competitors" && row.exported_Competitors)
      ? (Array.isArray(row.exported_Competitors) ? row.exported_Competitors : row.exported_Competitors.split(', ').filter(Boolean))
      : [];
    const exCompTop = curY + (thisRowH - (exportedComps.length||1) * (TAG_ROW_H+TAG_GAP) + TAG_GAP) / 2;
    if (exportedComps.length === 0) {
      pdf.setFont("helvetica","normal"); pdf.setFontSize(8); pdf.setTextColor(156,163,175);
      pdf.text("-", COL_X[7]+4, textBaseY);
    } else {
      exportedComps.forEach((ec, eci) => {
        drawPill(pdf, pdfSafe(ec), COL_X[7]+4, exCompTop + eci*(TAG_ROW_H+TAG_GAP), TAG_ROW_H, "#dbeafe", "#0c4a6e", 7, COL_W[7]-8);
      });
    }

    curY += thisRowH;
  });

  if (rows.length === 0) {
    pdf.setFont("helvetica","normal"); pdf.setFontSize(9); pdf.setTextColor(156,163,175);
    pdf.text("No project activity found.", MARGIN+availW/2, curY+20, { align: "center" });
  }

  pdf.save(`search-intelligence-projects-${new Date().toISOString().slice(0,10)}.pdf`);
}

// ─── Keyword Trends PDF ────────────────────────────────────────────────────────

async function exportKeywordTrendsPDF(data) {
  const { jsPDF } = await import("jspdf");
  const { tableList, typeTab, sortBy, meta, scrapingStats, adsCount } = data;

  const TYPE_LABELS = { keywords: "Keywords", advertisers: "Advertisers", domains: "Domains" };
  const list = (tableList ?? []).sort((a, b) =>
    sortBy === "growth"
      ? (b.growth_pct ?? -Infinity) - (a.growth_pct ?? -Infinity)
      : b.count - a.count
  );

  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const MARGIN = 24;
  const availW = pageW - MARGIN * 2;
  const HEADER_H = 60;
  const FOOTER_H = 24;
  const dateStr = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  const drawHeader = (pageNum) => {
    pdf.setFillColor(255,255,255); pdf.rect(0,0,pageW,HEADER_H,"F");
    pdf.setDrawColor(229,231,235); pdf.line(0,HEADER_H,pageW,HEADER_H);
    pdf.setFontSize(15); pdf.setFont("helvetica","bold"); pdf.setTextColor(17,24,39);
    pdf.text("Search Intelligence", MARGIN, 24);
    pdf.setFontSize(9); pdf.setFont("helvetica","normal"); pdf.setTextColor(107,114,128);
    pdf.text(pdfSafe(`Keyword trends  .  ${TYPE_LABELS[typeTab]}${pageNum>1?`  .  Page ${pageNum}`:""}`), MARGIN, 40);
  };
  const drawFooter = () => {
    pdf.setFontSize(8); pdf.setFont("helvetica","normal"); pdf.setTextColor(156,163,175);
    pdf.text("PowerAdSpy Admin  ·  Search Intelligence Export", pageW/2, pageH-8, { align: "center" });
  };

  let pageNum = 1;
  drawHeader(pageNum); drawFooter();
  let curY = HEADER_H + 12;
  const newPage = () => { pdf.addPage(); pageNum++; drawHeader(pageNum); drawFooter(); curY = HEADER_H+12; };
  const ensureSpace = (n) => { if (curY+n > pageH-FOOTER_H-8) newPage(); };

  // Summary stats section (all stats from UI)
  if (scrapingStats) {
    const STAT_COLS = 5;
    const statGap = 8;
    const statW = (availW - statGap * (STAT_COLS - 1)) / STAT_COLS;
    const statH = 44;

    const stats = [
      { label: "Total Keywords", value: (scrapingStats.totalItems ?? 0).toLocaleString() },
      { label: "Total Scraped Completed", value: (scrapingStats.completedToday ?? 0).toLocaleString() },
      { label: "Total keywords Not Went for Scraping", value: (scrapingStats.notQueued ?? 0).toLocaleString() },
      { label: "Total under Scraping Keywords", value: (scrapingStats.scrapingQueued ?? 0).toLocaleString() },
      { label: "Total Failed", value: (scrapingStats.totalFailed ?? 0).toLocaleString() },
      { label: "Today Scraped Completed", value: (scrapingStats.todayCompletedItems ?? 0).toLocaleString() },
      { label: "Today Not Went for Scraping", value: (scrapingStats.todayNotQueued ?? 0).toLocaleString() },
      { label: "Today under Scraping Keywords", value: (scrapingStats.todayScrapingQueued ?? 0).toLocaleString() },
      { label: "Today Failed", value: (scrapingStats.todayFailed ?? 0).toLocaleString() }
    ];

    ensureSpace(statH * 2 + statGap + 14);
    stats.forEach((stat, i) => {
      const col = i % STAT_COLS;
      const row = Math.floor(i / STAT_COLS);
      const sx = MARGIN + col * (statW + statGap);
      const sy = curY + row * (statH + statGap);

      roundedRect(pdf, sx, sy, statW, statH, 4, "#f9fafb");
      pdf.setDrawColor(229, 231, 235);
      pdf.rect(sx, sy, statW, statH);

      pdf.setFont("helvetica","normal"); pdf.setFontSize(6); pdf.setTextColor(156,163,175);
      const labelLines = pdf.splitTextToSize(pdfSafe(stat.label), statW - 12);
      labelLines.slice(0, 2).forEach((line, li) => {
        pdf.text(line, sx + 6, sy + 8 + li * 4);
      });

      pdf.setFont("helvetica","bold"); pdf.setFontSize(11); pdf.setTextColor(17,24,39);
      pdf.text(pdfSafe(stat.value), sx + 6, sy + 32);
    });

    curY += statH * 2 + statGap + 18;
  }

  // Ads Count section
  if (adsCount) {
    const adsStatW = availW / 3;
    const adsStatH = 60;

    ensureSpace(adsStatH + 12);
    const adsStats = [
      { label: "Today Ads Count", value: (adsCount.today_ads_count ?? 0).toLocaleString() },
      { label: "Total Ads Count", value: (adsCount.total_ads_count ?? 0).toLocaleString() }
    ];

    adsStats.forEach((stat, i) => {
      const sx = MARGIN + i * (adsStatW + 8);
      const sy = curY;

      roundedRect(pdf, sx, sy, adsStatW, adsStatH, 4, "#f9fafb");
      pdf.setDrawColor(229, 231, 235);
      pdf.rect(sx, sy, adsStatW, adsStatH);

      pdf.setFont("helvetica","normal"); pdf.setFontSize(7); pdf.setTextColor(156,163,175);
      pdf.text(pdfSafe(stat.label), sx + 6, sy + 12);

      pdf.setFont("helvetica","bold"); pdf.setFontSize(12); pdf.setTextColor(17,24,39);
      pdf.text(pdfSafe(stat.value), sx + 6, sy + 40);
    });

    // Platform breakdown
    const platformStatX = MARGIN + adsStatW * 2 + 16;
    roundedRect(pdf, platformStatX, curY, adsStatW - 8, adsStatH, 4, "#f9fafb");
    pdf.setDrawColor(229, 231, 235);
    pdf.rect(platformStatX, curY, adsStatW - 8, adsStatH);

    pdf.setFont("helvetica","normal"); pdf.setFontSize(8); pdf.setTextColor(156,163,175);
    pdf.text("Ads Count by Platform", platformStatX + 6, curY + 12);

    pdf.setFont("helvetica","normal"); pdf.setFontSize(7); pdf.setTextColor(55,65,81);
    let platY = curY + 22;
    Object.entries(adsCount.total_per_platform || {}).slice(0, 4).forEach(([platform, count]) => {
      const platText = pdfSafe(`${platform.charAt(0).toUpperCase() + platform.slice(1)}: ${count}`);
      pdf.text(platText, platformStatX + 6, platY);
      platY += 8.5;
    });

    curY += adsStatH + 16;
  }

  // Section title
  pdf.setFont("helvetica","bold"); pdf.setFontSize(10); pdf.setTextColor(55,65,81);
  pdf.text(pdfSafe(`${TYPE_LABELS[typeTab]} Trends`), MARGIN, curY);
  curY += 14;

  // Table: # | KEYWORDS | SEARCHED DATE | PLATFORMS | STATUS | HISTORY | CRAWLED | FAILED | ADS COUNT
  // Landscape A4 ≈ 1123pt wide, with margins = 1075pt available
  const COL_W = [26, 115, 68, 105, 95, 230, 42, 42, 42];
  const COL_X = COL_W.reduce((acc, w, i) => { acc.push(i===0 ? MARGIN : acc[i-1]+COL_W[i-1]); return acc; }, []);
  const colLabel = TYPE_LABELS[typeTab].toUpperCase();
  const HEADERS = ["#", colLabel, "SEARCHED DATE", "PLATFORMS", "STATUS", "HISTORY", "CRAWLED", "FAILED", "ADS COUNT"];
  const HEAD_H = 20; const MIN_ROW_H = 62;

  ensureSpace(HEAD_H + MIN_ROW_H);
  pdf.setFillColor(249,250,251); pdf.rect(MARGIN,curY,availW,HEAD_H,"F");
  pdf.setDrawColor(229,231,235); pdf.rect(MARGIN,curY,availW,HEAD_H);
  pdf.setFont("helvetica","bold"); pdf.setFontSize(8); pdf.setTextColor(156,163,175);
  HEADERS.forEach((h,i) => pdf.text(h, COL_X[i]+4, curY+HEAD_H/2+2.5));
  curY += HEAD_H;

  list.forEach((row, idx) => {
    const completedCount = row.history?.filter(h => h.status === "completed").length || 0;
    const failedCount = row.history?.filter(h => h.status === "failed").length || 0;
    const totalAds = row.history?.reduce((sum, h) => sum + (h.adsCount || 0), 0) || 0;
    const platformLabels = row.platforms?.map(p => p.charAt(0).toUpperCase() + p.slice(1)) || [];

    // Calculate row height based on platforms and history display
    let thisRowH = MIN_ROW_H;
    const platformH = platformLabels.length > 0 ? platformLabels.length * 7.5 + 10 : 0;
    const gapBetweenHistoryItems = 8;
    const historyH = row.history && row.history.length > 0 ? Math.min(row.history.length, 4) * (45.5 + gapBetweenHistoryItems) + 24 : 0;
    if (platformH > 0 || historyH > 0) {
      thisRowH = Math.max(MIN_ROW_H, platformH, historyH);
    }

    ensureSpace(thisRowH);

    const rowBg = idx % 2 === 0 ? "#ffffff" : "#f9fafb";
    const [rb,gb,bb] = hexToRgb(rowBg);
    pdf.setFillColor(rb,gb,bb); pdf.rect(MARGIN,curY,availW,thisRowH,"F");
    pdf.setDrawColor(243,244,246); pdf.line(MARGIN,curY+thisRowH,MARGIN+availW,curY+thisRowH);
    const textBaseY = curY + 10;

    // #
    pdf.setFont("helvetica","normal"); pdf.setFontSize(8.5); pdf.setTextColor(156,163,175);
    pdf.text(String(idx+1), COL_X[0]+4, textBaseY);

    // TERM
    pdf.setFont("helvetica","bold"); pdf.setFontSize(9); pdf.setTextColor(17,24,39);
    const termLines = pdf.splitTextToSize(pdfSafe(row.term), COL_W[1]-8);
    termLines.slice(0, 2).forEach((line, li) => {
      pdf.text(line, COL_X[1]+4, textBaseY + li*9);
    });

    // SEARCHED DATE
    pdf.setFont("helvetica","normal"); pdf.setFontSize(8); pdf.setTextColor(107,114,128);
    pdf.text(pdfSafe(row.searchedDate ?? "-"), COL_X[2]+4, textBaseY);

    // PLATFORMS (multi-line display)
    if (platformLabels.length === 0) {
      pdf.setFont("helvetica","normal"); pdf.setFontSize(8); pdf.setTextColor(156,163,175);
      pdf.text("-", COL_X[3]+4, textBaseY);
    } else {
      pdf.setFont("helvetica","normal"); pdf.setFontSize(8); pdf.setTextColor(67,56,202);
      platformLabels.forEach((p, pi) => {
        pdf.text(pdfSafe(p), COL_X[3]+4, textBaseY + (pi * 9));
      });
    }

    // STATUS
    let statusLabel = "";
    if (row.history && row.history.length > 0) {
      const parts = [];
      if (completedCount > 0) parts.push(`${completedCount} Crawl${completedCount > 1 ? 's' : ''}`);
      if (failedCount > 0) parts.push(`${failedCount} Failed`);
      statusLabel = parts.length > 0 ? parts.join(", ") : "Completed";
    } else {
      statusLabel = "Not Went";
    }
    pdf.setFont("helvetica","normal"); pdf.setFontSize(8);
    if (failedCount > 0) {
      pdf.setTextColor(153,27,27);
    } else if (row.history?.length > 0) {
      pdf.setTextColor(30,58,138);
    } else {
      pdf.setTextColor(156,163,175);
    }
    const statusLines = pdf.splitTextToSize(pdfSafe(statusLabel), COL_W[4]-8);
    statusLines.slice(0, 2).forEach((line, li) => {
      pdf.text(line, COL_X[4]+4, textBaseY + li*9);
    });

    // HISTORY (full detailed format with maximum spacing and gaps between items)
    if (row.history && row.history.length > 0) {
      let histY = textBaseY - 2;
      const histColW = COL_W[5] - 10;
      const itemSpacing = 45.5;
      const gapBetweenItems = 8; // Extra gap between each history item

      row.history.slice(0, 4).forEach((h, hi) => {
        const network = h.network ? h.network.charAt(0).toUpperCase() + h.network.slice(1) : "Unknown";

        pdf.setFont("helvetica","bold"); pdf.setFontSize(7); pdf.setTextColor(17,24,39);
        clippedText(pdf, pdfSafe(network), COL_X[5]+5, histY, histColW);

        pdf.setFont("helvetica","normal"); pdf.setFontSize(5.5); pdf.setTextColor(107,114,128);
        const date = h.date ? h.date : "-";
        const startTime = h.startTime ? new Date(h.startTime).toLocaleString() : "-";
        const endTime = h.endTime ? new Date(h.endTime).toLocaleString() : "-";
        const ads = h.adsCount ?? 0;

        clippedText(pdf, pdfSafe(`Date: ${date}`), COL_X[5]+5, histY + 12.68, histColW);
        clippedText(pdf, pdfSafe(`Start: ${startTime}`), COL_X[5]+5, histY + 21.58, histColW);
        clippedText(pdf, pdfSafe(`End: ${endTime}`), COL_X[5]+5, histY + 30.42, histColW);
        clippedText(pdf, pdfSafe(`Ads: ${ads}`), COL_X[5]+5, histY + 39.33, histColW);

        histY += itemSpacing + gapBetweenItems;
      });
    } else {
      pdf.setFont("helvetica","normal"); pdf.setFontSize(7); pdf.setTextColor(156,163,175);
      clippedText(pdf, "-", COL_X[5]+5, textBaseY, COL_W[5]-10);
    }

    // CRAWLED
    pdf.setFont("helvetica","bold"); pdf.setFontSize(9); pdf.setTextColor(17,24,39);
    pdf.text(String(completedCount), COL_X[6]+8, textBaseY);

    // FAILED
    pdf.setFont("helvetica","bold"); pdf.setFontSize(9); pdf.setTextColor(239,68,68);
    pdf.text(String(failedCount), COL_X[7]+8, textBaseY);

    // ADS COUNT
    pdf.setFont("helvetica","bold"); pdf.setFontSize(9); pdf.setTextColor(17,24,39);
    pdf.text(String(totalAds), COL_X[8]+8, textBaseY);

    curY += thisRowH;
  });

  if (list.length === 0) {
    ensureSpace(40);
    pdf.setFont("helvetica","normal"); pdf.setFontSize(9); pdf.setTextColor(156,163,175);
    pdf.text("No data found for this category.", MARGIN+availW/2, curY+20, { align: "center" });
  }

  pdf.save(`search-intelligence-keyword-trends-${new Date().toISOString().slice(0,10)}.pdf`);
}

// ─── component ────────────────────────────────────────────────────────────────

const SearchIntelligence = () => {
  const [activeTab, setActiveTab] = useState("top-users");
  const [exporting, setExporting] = useState(false);
  const contentRef = useRef(null);

  // Getters supplied by child tabs — always hold the latest live data
  const topUsersGetterRef    = useRef(null);
  const allSearchesGetterRef = useRef(null);
  const projectsGetterRef    = useRef(null);
  const keywordTrendsGetterRef = useRef(null);

  const handleTopUsersDataReady    = useCallback((g) => { topUsersGetterRef.current    = g; }, []);
  const handleAllSearchesDataReady = useCallback((g) => { allSearchesGetterRef.current = g; }, []);
  const handleProjectsDataReady    = useCallback((g) => { projectsGetterRef.current    = g; }, []);
  const handleKeywordTrendsDataReady = useCallback((g) => { keywordTrendsGetterRef.current = g; }, []);

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      if (activeTab === "top-users") {
        const d = topUsersGetterRef.current?.();
        if (!d) throw new Error("Top Users data not ready");
        await exportTopUsersPDF(d);
      } else if (activeTab === "all-searches") {
        const d = allSearchesGetterRef.current?.();
        if (!d) throw new Error("All Searches data not ready");
        await exportAllSearchesPDF(d);
      } else if (activeTab === "projects") {
        const d = projectsGetterRef.current?.();
        if (!d) throw new Error("Projects data not ready");
        await exportProjectsPDF(d);
      } else if (activeTab === "keyword-trends") {
        const d = keywordTrendsGetterRef.current?.();
        if (!d) throw new Error("Keyword Trends data not ready");
        await exportKeywordTrendsPDF(d);
      }
    } catch (err) {
      console.error("[Export] failed:", err);
      alert(`Export failed: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col min-h-full bg-[#f9fafb]">

      {/* Header */}
      <div className="bg-white border-b border-[#e5e7eb]">
        <div className="px-8 pt-6 pb-1">
          <p className="text-[12px] text-[#9ca3af]">
            Search activity › {TAB_LABELS[activeTab]}
          </p>
        </div>

        <div className="px-8 pt-1 pb-4 flex items-center justify-between">
          <h1 className="text-[22px] font-[700] text-[#111827]">Search intelligence</h1>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-2 border border-[#d1d5db] bg-white text-[#374151] text-[12px] font-[500] px-4 py-2 rounded-[6px] hover:bg-gray-50 transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <HiDownload className="text-[14px]" />
            {exporting ? "Exporting…" : "Export"}
          </button>
        </div>

        {/* Tab bar */}
        <div className="px-8 flex items-end gap-2">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{ outline: "none", boxShadow: "none", border: "none", background: "none" }}
              className={`relative px-5 py-3 text-[14px] font-[500] whitespace-nowrap transition-colors ${
                activeTab === tab.key
                  ? "text-[#6366f1]"
                  : "text-[#6b7280] hover:text-[#374151]"
              }`}
            >
              {tab.label}
              {activeTab === tab.key && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#6366f1] rounded-t-sm" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div ref={contentRef} className="px-8 py-6">
        {activeTab === "top-users"      && <TopUsers      onDataReady={handleTopUsersDataReady} />}
        {activeTab === "all-searches"   && <AllSearches   onDataReady={handleAllSearchesDataReady} />}
        {activeTab === "keyword-trends" && <KeywordTrends onDataReady={handleKeywordTrendsDataReady} />}
        {activeTab === "projects"       && <Projects      onDataReady={handleProjectsDataReady} />}
      </div>
    </div>
  );
};

export default SearchIntelligence;
