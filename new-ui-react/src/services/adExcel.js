import { fetchImageBlob } from "./api";

// Excel only renders PNG/JPEG/GIF, and full-size creatives would bloat the
// file, so every creative is downscaled and re-encoded as JPEG first.
const THUMB_MAX_PX = 240;
const IMAGE_BOX_PX = 110;
const IMAGE_CONCURRENCY = 6;
// Excel refuses hyperlinks longer than ~2079 chars (opens a repair prompt).
const MAX_HYPERLINK_LENGTH = 2000;

const HEADERS = [
  { header: "Sr. No", width: 7 },
  { header: "Ad id", width: 12 },
  { header: "Creative", width: 18 },
  { header: "Advertiser", width: 24 },
  { header: "Keyword", width: 16 },
  { header: "Target Keyword", width: 16 },
  { header: "Ad Type", width: 10 },
  { header: "Ad Position", width: 12 },
  { header: "Platform", width: 12 },
  { header: "Post Date", width: 14 },
  { header: "Countries", width: 14 },
  { header: "Initial URL", width: 40 },
  { header: "Redirect URL", width: 40 },
  { header: "Ad URL", width: 40 },
];
const CREATIVE_COL = 2; // zero-based index of "Creative"
const URL_COLS = [11, 12, 13];

const asUrl = (value) => {
  const parts = Array.isArray(value) ? value : [value];
  return parts
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter((part) => part && part !== "null" && part !== "undefined")
    .join("||");
};
const firstUrl = (...values) => values.map(asUrl).find(Boolean) || "";
const asUrlList = (value) => {
  if (Array.isArray(value)) return value.map(asUrl).filter(Boolean);
  return typeof value === "string"
    ? value.split("||").map((url) => url.trim()).filter(Boolean)
    : [];
};

// Mirrors the column logic of exportAdsToCSV in AdGrid so both exports agree.
const buildRowValues = (ad, index, targetKeyword, countries) => {
  const keyword = Array.isArray(ad.keywords)
    ? ad.keywords.join(", ")
    : ad.keywords || "";
  const network = String(ad.network || "").toLowerCase();
  const marketUrls = ad.marketPlatformUrls || {};
  const redirectChain = asUrlList(
    marketUrls.redirect_urls ?? ad.redirect_urls,
  );
  const commonInitialUrl = firstUrl(
    ad.destinationUrl,
    marketUrls.url_destination,
    marketUrls.source_url,
  );
  // GDN uses ad_url as its initial click and destination_url as its Ad URL.
  const initialUrl = network === "gdn"
    ? firstUrl(ad.adUrl, commonInitialUrl)
    : network === "youtube"
      ? firstUrl(redirectChain[0], commonInitialUrl)
      : commonInitialUrl;
  const redirectUrl = network === "youtube"
    ? (redirectChain.length > 1 ? redirectChain.join("||") : "")
    : firstUrl(
        ad.url,
        ad.redirectUrl,
        marketUrls.redirect_url,
        marketUrls.final_url,
      );
  const adUrl = network === "gdn"
    ? commonInitialUrl
    : firstUrl(ad.tiktokLibraryUrl, ad.adUrl);
  return [
    index + 1,
    // Kept as text so Excel doesn't show long ids as 1.2815E+11.
    String(ad.adId || ad.id || ""),
    "",
    ad.advertiser || "",
    keyword,
    targetKeyword,
    (ad.adType || "").toUpperCase(),
    (ad.adPosition || "").toUpperCase(),
    (ad.network || "").toUpperCase(),
    ad.date || ad.firstSeen || "",
    countries,
    initialUrl,
    redirectUrl,
    adUrl,
  ];
};

const creativeSource = (ad) =>
  ad.thumbnail ||
  (Array.isArray(ad.carouselMedia) && ad.carouselMedia[0]) ||
  "";

// Fetch through the image proxy (avoids CORS), downscale, and return JPEG
// base64 plus the display size that fits inside IMAGE_BOX_PX.
const loadThumbnail = async (src) => {
  const blob = await fetchImageBlob(src);
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = new window.Image();
    img.src = objectUrl;
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });
    const scale = Math.min(
      1,
      THUMB_MAX_PX / img.naturalWidth,
      THUMB_MAX_PX / img.naturalHeight,
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    // JPEG has no alpha; paint white so transparent PNGs don't turn black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const base64 = canvas.toDataURL("image/jpeg", 0.8);
    const fit = Math.min(
      IMAGE_BOX_PX / canvas.width,
      IMAGE_BOX_PX / canvas.height,
    );
    return {
      base64,
      width: Math.round(canvas.width * fit),
      height: Math.round(canvas.height * fit),
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const loadAllThumbnails = async (ads, onProgress) => {
  const results = new Array(ads.length).fill(null);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < ads.length) {
      const i = next++;
      const src = creativeSource(ads[i]);
      if (src) {
        try {
          results[i] = await loadThumbnail(src);
        } catch {
          results[i] = null;
        }
      }
      done += 1;
      onProgress?.(done, ads.length);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(IMAGE_CONCURRENCY, ads.length) }, worker),
  );
  return results;
};

/**
 * Build an .xlsx of the given ads with each ad's creative (image, or the
 * thumbnail for videos) embedded in a "Creative" column, and download it.
 */
export const exportAdsToExcel = async (
  ads,
  { targetKeyword = "", countries = "", platform = "ads", onProgress } = {},
) => {
  if (!ads || ads.length === 0) return;

  const [{ default: ExcelJS }, thumbnails] = await Promise.all([
    import("exceljs"),
    loadAllThumbnails(ads, onProgress),
  ]);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "PowerAdSpy";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Ads", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  // Text-only exports (e.g. Google text ads) have no creative at all — drop
  // the Creative column instead of filling it with "Image unavailable".
  const includeCreative = thumbnails.some(Boolean);
  const keepCol = (_, i) => includeCreative || i !== CREATIVE_COL;
  // Sheet column (1-based) for a buildRowValues index, after any removal.
  const sheetCol = (i) =>
    (includeCreative || i < CREATIVE_COL ? i : i - 1) + 1;
  sheet.columns = HEADERS.filter(keepCol).map(({ header, width }) => ({ header, width }));

  const headerRow = sheet.getRow(1);
  headerRow.height = 22;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF335296" },
    };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });

  ads.forEach((ad, index) => {
    const values = buildRowValues(ad, index, targetKeyword, countries);
    const row = sheet.addRow(values.filter(keepCol));
    // points (~120px) — fits the IMAGE_BOX_PX thumbnail; text-only rows stay compact
    row.height = includeCreative ? 90 : 45;
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.alignment = { vertical: "middle", wrapText: true };
    });

    URL_COLS.forEach((col) => {
      const url = values[col];
      if (
        url &&
        !url.includes("||") &&
        url.length <= MAX_HYPERLINK_LENGTH &&
        /^https?:\/\//i.test(url)
      ) {
        const cell = row.getCell(sheetCol(col));
        cell.value = { text: url, hyperlink: url };
        cell.font = { color: { argb: "FF0563C1" }, underline: true };
      }
    });

    if (!includeCreative) return;
    const thumb = thumbnails[index];
    const creativeCell = row.getCell(CREATIVE_COL + 1);
    if (thumb) {
      const imageId = workbook.addImage({
        base64: thumb.base64,
        extension: "jpeg",
      });
      sheet.addImage(imageId, {
        // Zero-based col/row; the small offsets pad the image inside the cell.
        tl: { col: CREATIVE_COL + 0.05, row: index + 1 + 0.05 },
        ext: { width: thumb.width, height: thumb.height },
        editAs: "oneCell",
      });
    } else if (!["text", "organic_search"].includes(String(ad.adType || "").toLowerCase())) {
      // Text ads never had a creative, so their cell is left blank.
      creativeCell.value = "Image unavailable";
      creativeCell.font = { italic: true, color: { argb: "FF6E7484" } };
      creativeCell.alignment = { vertical: "middle", horizontal: "center" };
    }
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `ads_export_${platform}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
