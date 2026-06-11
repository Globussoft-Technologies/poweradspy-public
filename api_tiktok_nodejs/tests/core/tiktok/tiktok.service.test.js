import { describe, it, expect, vi, beforeEach } from "vitest";

// NOTE: This file targets the pure helpers and simpler I/O methods.
// The giant create/update/updateESInsertSQL/updateSQLInsertES methods
// (lines 43-820+) involve 15+ collaborator mocks (ES, axios, sharp,
// fs streams, languageTranslation, sequelize transactions, etc.) and
// have their own commit ticks planned. Coverage achievable here is
// the easy ~40% via pure functions + simple service methods.

const {
  // db models
  TT_findOne, TT_destroy, TT_findAll, TT_create, TT_update,
  PO_findOrCreate, PO_increment,
  COUNTRY_AGES_bulk, COUNTRY_GENDERS_bulk,
  META_findAll, META_update, META_create,
  VARIANTS_create, ANALYTICS_create, AD_LOC_create, LANDER_create,
  TIKTOK_USER_findOrCreate,
  // sequelize
  transactionSpy, commitSpy, rollbackSpy,
  // es
  createIndexSpy, indexExistsSpy, updateDocSpy, searchDocSpy, searchDocsSpy,
  deleteDocSpy, insertDataSpy, getAdsESSpy, getAllESAdIdSpy,
  // misc collaborators
  loggerErrorSpy, loggerInfoSpy, configGetSpy, validateSpy,
  axiosSpy, uploadFileSpy, convertTSSpy, daysRunningSpy, langSpy,
  fetchSpy, existsSyncSpy, mkdirSyncSpy, readdirSpy, unlinkSyncSpy,
  createWriteStreamSpy,
} = vi.hoisted(() => ({
  TT_findOne: vi.fn(),
  TT_destroy: vi.fn(),
  TT_findAll: vi.fn(),
  TT_create: vi.fn(),
  TT_update: vi.fn(),
  PO_findOrCreate: vi.fn(),
  PO_increment: vi.fn(),
  COUNTRY_AGES_bulk: vi.fn(),
  COUNTRY_GENDERS_bulk: vi.fn(),
  META_findAll: vi.fn(),
  META_update: vi.fn(),
  META_create: vi.fn(),
  VARIANTS_create: vi.fn(),
  ANALYTICS_create: vi.fn(),
  AD_LOC_create: vi.fn(),
  LANDER_create: vi.fn(),
  TIKTOK_USER_findOrCreate: vi.fn(),
  transactionSpy: vi.fn(),
  commitSpy: vi.fn(),
  rollbackSpy: vi.fn(),
  createIndexSpy: vi.fn(),
  indexExistsSpy: vi.fn(),
  updateDocSpy: vi.fn(),
  searchDocSpy: vi.fn(),
  searchDocsSpy: vi.fn(),
  deleteDocSpy: vi.fn(),
  insertDataSpy: vi.fn(),
  getAdsESSpy: vi.fn(),
  getAllESAdIdSpy: vi.fn(),
  loggerErrorSpy: vi.fn(),
  loggerInfoSpy: vi.fn(),
  configGetSpy: vi.fn(),
  validateSpy: vi.fn(),
  axiosSpy: vi.fn(),
  uploadFileSpy: vi.fn(),
  convertTSSpy: vi.fn(),
  daysRunningSpy: vi.fn(),
  langSpy: vi.fn(),
  fetchSpy: vi.fn(),
  existsSyncSpy: vi.fn(),
  mkdirSyncSpy: vi.fn(),
  readdirSpy: vi.fn(),
  unlinkSyncSpy: vi.fn(),
  createWriteStreamSpy: vi.fn(),
}));

vi.mock("../../../Sequelize_cli/models/index.js", () => ({
  default: {
    tiktok_ads: { findOne: TT_findOne, destroy: TT_destroy, findAll: TT_findAll, create: TT_create, update: TT_update },
    tiktok_ad_post_owners: { findOrCreate: PO_findOrCreate, increment: PO_increment },
    tiktok_ad_country_ages: { bulkCreate: COUNTRY_AGES_bulk, update: vi.fn().mockResolvedValue([1]), create: vi.fn().mockResolvedValue({}) },
    tiktok_ad_country_gender: { bulkCreate: COUNTRY_GENDERS_bulk, update: vi.fn().mockResolvedValue([1]), create: vi.fn().mockResolvedValue({}) },
    tiktok_ad_meta_data: { findAll: META_findAll, findOne: vi.fn().mockResolvedValue({ video_cover: "vc" }), update: META_update, create: META_create },
    tiktok_ad_variants: { create: VARIANTS_create, update: vi.fn().mockResolvedValue([1]) },
    tiktok_ad_analytics: { create: ANALYTICS_create },
    tiktok_ad_location: { create: AD_LOC_create, update: vi.fn().mockResolvedValue([1]) },
    tiktok_ad_html_lander: { create: LANDER_create },
    tiktok_users: { findOrCreate: TIKTOK_USER_findOrCreate },
    sequelize: { transaction: transactionSpy },
  },
}));

vi.mock("../../../utils/elasticSearch.js", () => ({
  createIndex: createIndexSpy,
  indexExists: indexExistsSpy,
  updateDocument: updateDocSpy,
  searchDoc: searchDocSpy,
  searchDocs: searchDocsSpy,
  deleteDoc: deleteDocSpy,
  insertData: insertDataSpy,
  getAdsES: getAdsESSpy,
  getAllESAdId: getAllESAdIdSpy,
}));

vi.mock("../../../resources/logs/logger.log.js", () => ({
  default: { info: loggerInfoSpy, error: loggerErrorSpy, warn: vi.fn() },
}));

vi.mock("config", () => ({ default: { get: configGetSpy } }));

vi.mock("../../../core/tiktok/tiktok.validate.js", () => ({
  default: { createDetails: validateSpy, updateDetails: validateSpy },
}));

vi.mock("../../../utils/fileUploading.js", () => ({
  uploadFile: uploadFileSpy,
}));

vi.mock("../../../utils/epochConverter.js", () => ({
  default: convertTSSpy,
  daysRunning: daysRunningSpy,
}));

vi.mock("../../../utils/languageAPI.js", () => ({
  default: langSpy,
}));

vi.mock("axios", () => ({
  default: axiosSpy,
}));

vi.mock("fs", async () => {
  const actual = await vi.importActual("fs");
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: existsSyncSpy,
      mkdirSync: mkdirSyncSpy,
      readdir: readdirSpy,
      unlinkSync: unlinkSyncSpy,
      createWriteStream: createWriteStreamSpy,
    },
    existsSync: existsSyncSpy,
    mkdirSync: mkdirSyncSpy,
    readdir: readdirSpy,
    unlinkSync: unlinkSyncSpy,
    createWriteStream: createWriteStreamSpy,
  };
});

let svc;
beforeEach(async () => {
  vi.resetModules();
  for (const s of [
    TT_findOne, TT_destroy, TT_findAll, TT_create, TT_update,
    PO_findOrCreate, PO_increment,
    COUNTRY_AGES_bulk, COUNTRY_GENDERS_bulk,
    META_findAll, META_update, META_create,
    VARIANTS_create, ANALYTICS_create, AD_LOC_create, LANDER_create,
    TIKTOK_USER_findOrCreate,
    transactionSpy, commitSpy, rollbackSpy,
    createIndexSpy, indexExistsSpy, updateDocSpy, searchDocSpy, searchDocsSpy,
    deleteDocSpy, insertDataSpy, getAdsESSpy, getAllESAdIdSpy,
    loggerErrorSpy, loggerInfoSpy, configGetSpy, validateSpy,
    axiosSpy, uploadFileSpy, convertTSSpy, daysRunningSpy, langSpy,
    fetchSpy, existsSyncSpy, mkdirSyncSpy, readdirSpy, unlinkSyncSpy,
    createWriteStreamSpy,
  ]) s.mockReset();
  const tx = { commit: commitSpy, rollback: rollbackSpy, finished: undefined };
  transactionSpy.mockResolvedValue(tx);
  commitSpy.mockImplementation(async () => { tx.finished = "commit"; });
  rollbackSpy.mockImplementation(async () => { tx.finished = "rollback"; });
  configGetSpy.mockImplementation((k) => k === "skip" ? 0 : k === "limit" ? 10 : `cfg:${k}`);
  global.fetch = fetchSpy;
  ({ default: svc } = await import("../../../core/tiktok/tiktok.service.js"));
});

function mockRes() {
  const res = {};
  res.send = vi.fn(() => res);
  res.status = vi.fn(() => res);
  return res;
}

describe("tiktok.service > popularityImpression", () => {
  it("calculates popularity and impression from clicks/ctr/engagements", () => {
    const [pop, imp] = svc.popularityImpression(
      [{ value: 1 }, { value: 0.5 }],
      0.1,
      10, 5, 3
    );
    // totalClicks = round(round(100) + round(50)) = 150; impression = 1500
    // totalEngagements = 150 + 10 + 5 + 3 = 168
    // popularity = round(168 / (168 + 1500) * 100) ≈ 10
    expect(imp).toBe(1500);
    expect(pop).toBeGreaterThanOrEqual(9);
    expect(pop).toBeLessThanOrEqual(11);
  });

  it("handles empty clicksArr by treating reduce result as undefined → NaN → 0 via Math.round", () => {
    // reduce on [] without initial value throws; with initial 0 it's 0
    const [pop, imp] = svc.popularityImpression([], 1, 0, 0, 0);
    // empty reduce with initial 0 -> 0; impression = 0/1 = 0
    expect(imp).toBe(0);
    expect(Number.isNaN(pop)).toBe(true); // 0/0 = NaN
  });
});

describe("tiktok.service > esData", () => {
  it("picks exactly the supported keys from a wider payload", () => {
    const out = svc.esData({
      ad_id: "a", type: 1, first_seen: 100, last_seen: 200, days_running: 5,
      post_owner: "po", countries: ["IN"], gender: { male: 1 }, age: { "18-24": 1 },
      ad_title: "t", platform: 2, destination_url: "u",
      likes: 1, comments: 2, shares: 3, source: "s",
      ctr: 0.1, interest: "i",
      min_target_users: 1, max_target_users: 10,
      target_keywords: ["k"], popularity: 50, impression: 1000,
      sql_id: 7, post_owner_id: 9,
      landerStatus: 0, landerData: {}, language: "en",
      video_url: "v", video_cover: "c",
      ctr_graph: [], cvr_graph: [], clicks_graph: [], conversion_graph: [], remain_graph: [],
      library_url: "l", budget: "b", industry: "ind",
      _extra: "should be dropped",
    });
    expect(out._extra).toBeUndefined();
    expect(out.ad_id).toBe("a");
    expect(out.sql_id).toBe(7);
  });
});

describe("tiktok.service > formatAgeDetails / formatGenderDetails", () => {
  it("formatAgeDetails maps 6 values into the fixed age buckets", () => {
    const out = svc.formatAgeDetails([1, 2, 3, 4, 5, 6]);
    expect(out).toEqual({
      "13-17": 1, "18-24": 2, "25-34": 3, "35-44": 4, "45-54": 5, "55+": 6,
    });
  });

  it("formatGenderDetails maps 3 values into male/female/unknown", () => {
    expect(svc.formatGenderDetails([10, 20, 30])).toEqual({
      male: 10, female: 20, unknown: 30,
    });
  });

  it("formatGenderDetails1 returns the same shape but wrapped in an array", () => {
    expect(svc.formatGenderDetails1([1, 2, 3])).toEqual([
      { male: 1, female: 2, unknown: 3 },
    ]);
  });
});

describe("tiktok.service > getAnalytics", () => {
  it("returns 'Missing id field' when id missing", async () => {
    const res = mockRes();
    await svc.getAnalytics({ params: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Missing id field");
  });

  it("returns 'No data found' when searchDoc returns falsy", async () => {
    searchDocSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.getAnalytics({ params: { id: "1" } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("No data found with that id");
  });

  it("returns success when row exists", async () => {
    searchDocSpy.mockResolvedValueOnce({ id: 1 });
    const res = mockRes();
    await svc.getAnalytics({ params: { id: "1" } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Found analytics data");
  });

  it("catches and returns 'Error fetching data'", async () => {
    searchDocSpy.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await svc.getAnalytics({ params: { id: "1" } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Error fetching data");
  });
});

describe("tiktok.service > getAdvertiserAds", () => {
  it("returns 'Missing owner field' when missing", async () => {
    const res = mockRes();
    await svc.getAdvertiserAds({ params: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Missing owner field");
  });

  it("returns 'No ads found' when searchDocs empty", async () => {
    searchDocsSpy.mockResolvedValueOnce([]);
    const res = mockRes();
    await svc.getAdvertiserAds({ params: { postOwner: "Acme" } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("No ads found with that owner");
  });

  it("returns 'Found ads data' when ads present", async () => {
    searchDocsSpy.mockResolvedValueOnce([{ id: 1 }]);
    const res = mockRes();
    await svc.getAdvertiserAds({ params: { postOwner: "Acme" } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Found ads data");
  });

  it("catches and returns 'Error fetching advertiser ads'", async () => {
    searchDocsSpy.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await svc.getAdvertiserAds({ params: { postOwner: "Acme" } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Error fetching advertiser ads"
    );
  });
});

describe("tiktok.service > deleteAd", () => {
  it("returns 'Missing id' when id missing", async () => {
    const res = mockRes();
    await svc.deleteAd({ params: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Missing id");
  });

  it("deletes from both SQL and ES on success", async () => {
    TT_destroy.mockResolvedValueOnce(1);
    deleteDocSpy.mockResolvedValueOnce({});
    const res = mockRes();
    await svc.deleteAd({ params: { id: "5" } }, res);
    expect(TT_destroy).toHaveBeenCalledWith({ where: { id: "5" } });
    expect(deleteDocSpy).toHaveBeenCalledWith("sql_id", "5");
    expect(res.send.mock.calls[0][0].body.message).toBe("Ad deleted successfully");
  });

  it("catches and returns 'Failed to delete ad'", async () => {
    TT_destroy.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await svc.deleteAd({ params: { id: "5" } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Failed to delete ad");
  });
});

describe("tiktok.service > deleteSQLAd", () => {
  it("happy path: deletes SQL rows missing from ES + ES rows missing from SQL", async () => {
    TT_findAll.mockResolvedValueOnce([
      { dataValues: { id: 1, ad_id: "x1" } },
      { dataValues: { id: 2, ad_id: "x2" } },
    ]);
    searchDocSpy
      .mockResolvedValueOnce(null)         // x1 not in ES → delete
      .mockResolvedValueOnce({ id: 1 });   // x2 in ES → keep
    TT_destroy.mockResolvedValueOnce(1);
    getAllESAdIdSpy.mockResolvedValueOnce(["y1", "y2"]);
    TT_findOne
      .mockResolvedValueOnce(null)         // y1 not in SQL → delete
      .mockResolvedValueOnce({ id: 1 });   // y2 in SQL → keep
    deleteDocSpy.mockResolvedValue({});
    const res = mockRes();
    await svc.deleteSQLAd({ query: {} }, res);
    expect(TT_destroy).toHaveBeenCalledWith({ where: { id: [1] } });
    expect(deleteDocSpy).toHaveBeenCalledWith("ad_id", "y1");
    expect(res.send.mock.calls[0][0].body.message).toBe("Ad deleted successfully");
  });

  it("logs 'No ads found in MySQL' when findAll empty", async () => {
    TT_findAll.mockResolvedValueOnce([]);
    getAllESAdIdSpy.mockResolvedValueOnce([]);
    const res = mockRes();
    await svc.deleteSQLAd({ query: {} }, res);
    expect(loggerInfoSpy).toHaveBeenCalledWith("No ads found in MySQL.");
    expect(loggerInfoSpy).toHaveBeenCalledWith("No ads found in Elasticsearch.");
  });

  it("catches and returns 'Failed to delete ad'", async () => {
    TT_findAll.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await svc.deleteSQLAd({ query: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Failed to delete ad");
  });
});

describe("tiktok.service > getAds", () => {
  it("returns 'No ads found' when getAdsES empty", async () => {
    getAdsESSpy.mockResolvedValueOnce([]);
    const res = mockRes();
    await svc.getAds({ query: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("No ads found");
  });

  it("uses parsed skip/limit from query", async () => {
    getAdsESSpy.mockResolvedValueOnce([{ id: 1 }]);
    const res = mockRes();
    await svc.getAds({ query: { skip: "20", limit: "5" } }, res);
    expect(getAdsESSpy).toHaveBeenCalledWith(20, 5);
    expect(res.send.mock.calls[0][0].body.message).toBe("Fetched ads successfully");
  });

  it("falls back to config when skip/limit invalid", async () => {
    getAdsESSpy.mockResolvedValueOnce([{ id: 1 }]);
    const res = mockRes();
    await svc.getAds({ query: {} }, res);
    expect(getAdsESSpy).toHaveBeenCalledWith(0, 10);
  });

  it("catches and returns 'Error fetching ads'", async () => {
    getAdsESSpy.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await svc.getAds({ query: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Error fetching ads");
  });
});

describe("tiktok.service > getAdURL", () => {
  it("returns 'No ads found' when META_findAll empty", async () => {
    META_findAll.mockResolvedValueOnce([]);
    const res = mockRes();
    await svc.getAdURL({ query: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("No ads found");
  });

  it("iterates library_urls + updates thumb_nail_status to 2 for each ad", async () => {
    META_findAll.mockResolvedValueOnce([
      { ad_id: "x1", library_url: "lib1", video_url: "v1" },
    ]);
    META_update.mockResolvedValue([1]);
    fetchSpy.mockResolvedValue({
      ok: true,
      text: async () => "no-videoUrl-here",
    });
    const res = mockRes();
    await svc.getAdURL({ query: {} }, res);
    expect(META_update).toHaveBeenCalledWith(
      { thumb_nail_status: 2 },
      { where: { ad_id: "x1" } }
    );
  });

  it("catches and returns 'Error fetching ads'", async () => {
    META_findAll.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await svc.getAdURL({ query: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Error fetching ads");
  });
});

describe("tiktok.service > getVideoURL1", () => {
  it("returns undefined when ad_url is falsy", async () => {
    const out = await svc.getVideoURL1("");
    expect(out).toBeUndefined();
  });

  it("logs error when response.ok is false", async () => {
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 500 });
    await svc.getVideoURL1("https://x");
    expect(loggerErrorSpy).toHaveBeenCalled();
  });

  it("returns videoUrl 720P when text contains the parseable JSON marker", async () => {
    const payload = {
      props: { pageProps: { data: { baseDetail: { videoInfo: { videoUrl: { "720P": "https://720p" } } } } } },
    };
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        `<script type="application/json">${JSON.stringify(payload)}</script>`,
    });
    const out = await svc.getVideoURL1("https://x");
    expect(out).toBe("https://720p");
  });

  it("returns undefined when text has 'videoUrl' but no parseable JSON marker", async () => {
    fetchSpy.mockResolvedValueOnce({ ok: true, text: async () => "videoUrl present but no script" });
    const out = await svc.getVideoURL1("https://x");
    expect(out).toBeUndefined();
  });

  it("returns undefined when text does not include 'videoUrl' (line 1056 false branch)", async () => {
    fetchSpy.mockResolvedValueOnce({ ok: true, text: async () => "no-marker-here" });
    const out = await svc.getVideoURL1("https://x");
    expect(out).toBeUndefined();
  });
});

describe("tiktok.service > getVideoURL", () => {
  it("returns 'Request Body can'not be empty' when body missing", async () => {
    const res = mockRes();
    await svc.getVideoURL({}, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Request Body can'not be empty"
    );
  });

  it("throws inside try when response.ok is false → caught + returns 'Error fetching video url'", async () => {
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 500 });
    const res = mockRes();
    await svc.getVideoURL({ body: { ad_url: "https://x" } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Error fetching video url"
    );
  });

  it("returns 201 with video_url on parseable response", async () => {
    const payload = {
      props: { pageProps: { data: { baseDetail: { videoInfo: { videoUrl: { "720P": "https://720p" } } } } } },
    };
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        `<script type="application/json">${JSON.stringify(payload)}</script>`,
    });
    const res = mockRes();
    await svc.getVideoURL({ body: { ad_url: "https://x" } }, res);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("getBetween catch path: text has 'videoUrl' but no parseable script tag → getBetween returns '' (line 1126)", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      text: async () => "videoUrl present but no script marker here",
    });
    const res = mockRes();
    await svc.getVideoURL({ body: { ad_url: "https://x" } }, res);
    // getBetween returns "" → getVideoUrl is falsy → no inner branch → falls
    // through to the outer flow without sending a 201 response.
    expect(res.status).not.toHaveBeenCalledWith(201);
  });

  it("does not call status(201) when text does not include 'videoUrl' (line 1099 false branch)", async () => {
    fetchSpy.mockResolvedValueOnce({ ok: true, text: async () => "no-marker-here" });
    const res = mockRes();
    await svc.getVideoURL({ body: { ad_url: "https://x" } }, res);
    expect(res.status).not.toHaveBeenCalledWith(201);
  });
});

describe("tiktok.service > updateThumbNail", () => {
  it("returns 'Missing request data' when body undefined", async () => {
    const res = mockRes();
    await svc.updateThumbNail({}, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Missing request data");
  });

  it("returns 'Ad not found' when searchDoc falsy", async () => {
    searchDocSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.updateThumbNail({ body: { ad_id: 1 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Ad not found - failed to update the data"
    );
  });

  it("updates and commits on happy path", async () => {
    searchDocSpy.mockResolvedValueOnce({ sql_id: 1 });
    updateDocSpy.mockResolvedValueOnce({ updated: 1 });
    META_update.mockResolvedValueOnce([1]);
    const res = mockRes();
    await svc.updateThumbNail(
      { body: { ad_id: 1, video_cover: "vc" } }, res
    );
    expect(commitSpy).toHaveBeenCalled();
    expect(res.send.mock.calls.at(-1)[0].body.message).toBe(
      "Ad updated successfully"
    );
  });

  it("inner catch returns 'Error inserting thumbnail url' when updateDocument throws", async () => {
    searchDocSpy.mockResolvedValueOnce({ sql_id: 1 });
    updateDocSpy.mockRejectedValueOnce(new Error("es-down"));
    const res = mockRes();
    await svc.updateThumbNail({ body: { ad_id: 1 } }, res);
    expect(res.send.mock.calls.at(-1)[0].body.message).toBe(
      "Error inserting thumbnail url"
    );
  });

  it("outer catch: searchDoc throws → 'Error fetching video url' (lines 1187-1191)", async () => {
    searchDocSpy.mockRejectedValueOnce(new Error("es-search-down"));
    const res = mockRes();
    await svc.updateThumbNail({ body: { ad_id: 1 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Error fetching video url");
  });

  it("finally: forced-rollback throws → logs 'Error releasing transaction connection' (line 1200)", async () => {
    const tx = {
      commit: vi.fn(async () => {}),
      rollback: vi.fn(async () => { throw new Error("rb-fail"); }),
      finished: undefined,
    };
    transactionSpy.mockResolvedValueOnce(tx);
    searchDocSpy.mockResolvedValueOnce({ sql_id: 1 });
    updateDocSpy.mockResolvedValueOnce({ updated: 1 });
    META_update.mockResolvedValueOnce([1]);
    const res = mockRes();
    await svc.updateThumbNail({ body: { ad_id: 1, video_cover: "vc" } }, res);
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      "Error releasing transaction connection",
      expect.any(Error)
    );
  });

  it("transaction undefined: finally `if (transaction)` falsy branch fires (line 1194 false side)", async () => {
    transactionSpy.mockResolvedValueOnce(undefined);
    searchDocSpy.mockResolvedValueOnce({ sql_id: 1 });
    updateDocSpy.mockResolvedValueOnce({ updated: 1 });
    META_update.mockResolvedValueOnce([1]);
    const res = mockRes();
    await expect(
      svc.updateThumbNail({ body: { ad_id: 1, video_cover: "vc" } }, res)
    ).rejects.toThrow();
  });

  it("does not commit when updated.updated is 0 (line 1174 false branch)", async () => {
    searchDocSpy.mockResolvedValueOnce({ sql_id: 1 });
    updateDocSpy.mockResolvedValueOnce({ updated: 0 });
    META_update.mockResolvedValueOnce([1]);
    const res = mockRes();
    await svc.updateThumbNail({ body: { ad_id: 1, video_cover: "vc" } }, res);
    expect(commitSpy).not.toHaveBeenCalled();
  });
});

describe("tiktok.service > updateOrCreateEntries", () => {
  it("updates when update affects rows; creates when update returns 0", async () => {
    const Model = {
      update: vi.fn()
        .mockResolvedValueOnce([1]) // first row → updated
        .mockResolvedValueOnce([0]), // second row → not updated, create
      create: vi.fn().mockResolvedValueOnce({}),
    };
    await svc.updateOrCreateEntries(
      Model,
      [
        { ad_id: 1, country_name: "IN", x: 1 },
        { ad_id: 2, country_name: "US", x: 2 },
      ],
      "tx"
    );
    expect(Model.update).toHaveBeenCalledTimes(2);
    expect(Model.create).toHaveBeenCalledTimes(1);
  });
});

describe("tiktok.service > getS3Url + downloadFile + deleteAllFilesInFolder", () => {
  // Auto-firing writer: the moment .on('finish'|'error', cb) is registered,
  // queue the callback to fire on the next microtask so the SUT's
  // returned promise resolves/rejects without manual orchestration.
  function makeAutoWriter({ fail } = {}) {
    return {
      on(event, cb) {
        if (!fail && event === "finish") setImmediate(cb);
        if (fail && event === "error") setImmediate(() => cb(fail));
      },
    };
  }

  it("downloadFile resolves with destPath when writer finishes", async () => {
    const writer = makeAutoWriter();
    createWriteStreamSpy.mockReturnValueOnce(writer);
    const streamData = { pipe: vi.fn() };
    axiosSpy.mockResolvedValueOnce({ data: streamData });
    const out = await svc.downloadFile("https://x.mp4", "./temp", ".mp4", "ad1");
    expect(out).toBe("./temp/ad1.mp4");
    expect(streamData.pipe).toHaveBeenCalledWith(writer);
  });

  it("downloadFile rejects when writer errors", async () => {
    const writer = makeAutoWriter({ fail: new Error("write-fail") });
    createWriteStreamSpy.mockReturnValueOnce(writer);
    axiosSpy.mockResolvedValueOnce({ data: { pipe: vi.fn() } });
    await expect(
      svc.downloadFile("https://x", "./temp", ".mp4", "ad1")
    ).rejects.toThrow("write-fail");
  });

  it("getS3Url creates temp dir when missing, downloads + uploads + cleans", async () => {
    existsSyncSpy.mockReturnValueOnce(false);
    mkdirSyncSpy.mockReturnValueOnce(undefined);
    createWriteStreamSpy.mockReturnValueOnce(makeAutoWriter());
    axiosSpy.mockResolvedValueOnce({ data: { pipe: vi.fn() } });
    uploadFileSpy.mockResolvedValueOnce("https://s3/uploaded.webp");
    readdirSpy.mockImplementationOnce((_p, cb) => cb(null, []));
    const out = await svc.getS3Url("https://x.webp", ".webp", "ad1");
    expect(mkdirSyncSpy).toHaveBeenCalledWith("./temp");
    expect(uploadFileSpy).toHaveBeenCalled();
    expect(out).toBe("https://s3/uploaded.webp");
  });

  it("getS3Url skips mkdir when temp dir already exists", async () => {
    existsSyncSpy.mockReturnValueOnce(true);
    createWriteStreamSpy.mockReturnValueOnce(makeAutoWriter());
    axiosSpy.mockResolvedValueOnce({ data: { pipe: vi.fn() } });
    uploadFileSpy.mockResolvedValueOnce("https://s3/x");
    readdirSpy.mockImplementationOnce((_p, cb) => cb(null, []));
    await svc.getS3Url("https://x.webp", ".webp", "ad1");
    expect(mkdirSyncSpy).not.toHaveBeenCalled();
  });

  it("deleteAllFilesInFolder unlinks each file via fs.readdir callback", async () => {
    readdirSpy.mockImplementationOnce((_p, cb) => cb(null, ["a.png", "b.mp4"]));
    await svc.deleteAllFilesInFolder("./temp");
    expect(unlinkSyncSpy).toHaveBeenCalledWith("./temp/a.png");
    expect(unlinkSyncSpy).toHaveBeenCalledWith("./temp/b.mp4");
    expect(loggerInfoSpy).toHaveBeenCalledWith("FileDeleted");
  });

  it("deleteAllFilesInFolder logs error when readdir fails (source bug — references undefined err in outer catch)", async () => {
    readdirSpy.mockImplementationOnce((_p, cb) => cb(new Error("readdir-fail")));
    await svc.deleteAllFilesInFolder("./temp");
    expect(loggerErrorSpy).toHaveBeenCalled();
  });

  it("deleteAllFilesInFolder outer catch fires when readdir throws synchronously (line 1302 — source bug: `err` is undefined in catch)", async () => {
    readdirSpy.mockImplementationOnce(() => { throw new Error("sync-readdir-fail"); });
    // The catch handler at line 1302 references `err` (undefined identifier
    // in catch scope) instead of `error`, so template-literal evaluation
    // throws ReferenceError before logger.error is invoked. Even so, the
    // statement IS entered for coverage purposes.
    await expect(svc.deleteAllFilesInFolder("./temp")).rejects.toThrow(ReferenceError);
  });
});

// =====================================================================
// update() — the 213-line orchestrator that updates SQL + ES for an
// existing ad. Exercises all sequential collaborator failure paths +
// the happy path.
// =====================================================================
describe("tiktok.service > update", () => {
  function basePayload(over = {}) {
    return {
      ad_id: "a1", post_owner: "po", tiktok_account_id: "ttid",
      tiktok_account_name: "ttname", system_id: "sys",
      clicks_graph: [], ctr: 0.1,
      likes: 1, comments: 2, shares: 3,
      last_seen: 1000,
      ...over,
    };
  }

  it("'Missing request data' when body undefined", async () => {
    const res = mockRes();
    await svc.update({}, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Missing request data");
    expect(rollbackSpy).toHaveBeenCalled();
  });

  it("'Ad not found' when searchDoc returns falsy", async () => {
    searchDocSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.update({ body: basePayload() }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Ad not found - failed to update the data"
    );
  });

  it("VALIDATION_FAIL when validator returns error", async () => {
    searchDocSpy.mockResolvedValueOnce({ first_seen: 0, sql_id: 9 });
    validateSpy.mockReturnValueOnce({ value: {}, error: { details: "bad" } });
    const res = mockRes();
    await svc.update({ body: basePayload() }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("VALIDATION_FAIL");
  });

  it("'Error in findOrCreate POST_OWNER' when POST_OWNER throws", async () => {
    searchDocSpy.mockResolvedValueOnce({ first_seen: 0, sql_id: 9 });
    validateSpy.mockReturnValueOnce({
      value: basePayload(), error: undefined,
    });
    convertTSSpy.mockReturnValueOnce(1000);
    daysRunningSpy.mockReturnValueOnce(1);
    PO_findOrCreate.mockRejectedValueOnce(new Error("po-down"));
    const res = mockRes();
    await svc.update({ body: basePayload() }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Error in findOrCreate POST_OWNER"
    );
  });

  it("'Error in TIKTOK_USER upsert' when TIKTOK_USER throws", async () => {
    searchDocSpy.mockResolvedValueOnce({ first_seen: 0, sql_id: 9 });
    validateSpy.mockReturnValueOnce({ value: basePayload(), error: undefined });
    convertTSSpy.mockReturnValueOnce(1000);
    daysRunningSpy.mockReturnValueOnce(1);
    PO_findOrCreate.mockResolvedValueOnce([{ id: 7 }, false]);
    TIKTOK_USER_findOrCreate.mockRejectedValueOnce(new Error("tu-down"));
    const res = mockRes();
    await svc.update({ body: basePayload() }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Error in TIKTOK_USER upsert"
    );
  });

  it("'Error in TIK_TOK update' when TIK_TOK update throws", async () => {
    searchDocSpy.mockResolvedValueOnce({ first_seen: 0, sql_id: 9 });
    validateSpy.mockReturnValueOnce({ value: basePayload(), error: undefined });
    convertTSSpy.mockReturnValueOnce(1000);
    daysRunningSpy.mockReturnValueOnce(1);
    PO_findOrCreate.mockResolvedValueOnce([{ id: 7 }, false]);
    TIKTOK_USER_findOrCreate.mockResolvedValueOnce([
      { update: vi.fn().mockResolvedValue(undefined) }, false,
    ]);
    TT_update.mockRejectedValueOnce(new Error("tt-down"));
    const res = mockRes();
    await svc.update({ body: basePayload() }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Error in TIK_TOK update");
  });

  it("'Error in ad update operations' when Promise.all in adUpdateOperations rejects", async () => {
    searchDocSpy.mockResolvedValueOnce({
      first_seen: 0, sql_id: 9, likes: 0, comments: 0, shares: 0,
    });
    validateSpy.mockReturnValueOnce({ value: basePayload(), error: undefined });
    convertTSSpy.mockReturnValueOnce(1000);
    daysRunningSpy.mockReturnValueOnce(1);
    PO_findOrCreate.mockResolvedValueOnce([{ id: 7 }, true]); // createdUser=true skips update
    TIKTOK_USER_findOrCreate.mockResolvedValueOnce([{}, true]);
    TT_update.mockResolvedValueOnce([1]);
    TT_findOne.mockResolvedValueOnce({ id: 99 });
    AD_LOC_create.mockResolvedValue([1]); // not the one that rejects
    // Force one of the AD updates to reject — AD_LOCATION.update is in
    // adUpdateOperations[0]; but we mock AD_LOCATION as { create } only
    // (no update spy). Force it via overriding the db model mock would
    // require resetModules. Simpler: make META_DATA update reject.
    META_update.mockRejectedValueOnce(new Error("meta-down"));
    const res = mockRes();
    await svc.update({ body: basePayload() }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Error in ad update operations"
    );
  });

  it("'Error in updating Elasticsearch document' when updateDocument throws", async () => {
    searchDocSpy.mockResolvedValueOnce({
      first_seen: 0, sql_id: 9, likes: 0, comments: 0, shares: 0,
    });
    validateSpy.mockReturnValueOnce({ value: basePayload(), error: undefined });
    convertTSSpy.mockReturnValueOnce(1000);
    daysRunningSpy.mockReturnValueOnce(1);
    PO_findOrCreate.mockResolvedValueOnce([{ id: 7 }, true]);
    TIKTOK_USER_findOrCreate.mockResolvedValueOnce([{}, true]);
    TT_update.mockResolvedValueOnce([1]);
    TT_findOne.mockResolvedValueOnce({ id: 99 });
    META_update.mockResolvedValueOnce([1]);
    updateDocSpy.mockRejectedValueOnce(new Error("es-down"));
    const res = mockRes();
    await svc.update({ body: basePayload() }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Error in updating Elasticsearch document"
    );
  });

  it("happy path: updates SQL + ES, commits, returns 'Ad updated successfully'", async () => {
    searchDocSpy.mockResolvedValueOnce({
      first_seen: 0, sql_id: 9,
      likes: 99, comments: 99, shares: 99, // differ from payload → ANALYTICS.create fires
      landerStatus: 1, landerData: { x: 1 }, language: "en", video_cover: "vc",
    });
    validateSpy.mockReturnValueOnce({
      value: basePayload({
        age: { IN: [1, 2, 3, 4, 5, 6] },
        gender: { IN: [10, 20, 30] },
      }),
      error: undefined,
    });
    convertTSSpy.mockReturnValueOnce(1000);
    daysRunningSpy.mockReturnValueOnce(1);
    PO_findOrCreate.mockResolvedValueOnce([{ id: 7 }, true]); // createdUser=true skips update branch
    TIKTOK_USER_findOrCreate.mockResolvedValueOnce([
      { update: vi.fn() }, true, // createdUser=true (skip update)
    ]);
    TT_update.mockResolvedValueOnce([1]);
    TT_findOne.mockResolvedValueOnce({ id: 99 });
    META_update.mockResolvedValue([1]);
    ANALYTICS_create.mockResolvedValueOnce({});
    updateDocSpy.mockResolvedValueOnce({ updated: 1 });
    const res = mockRes();
    await svc.update({ body: basePayload() }, res);
    expect(commitSpy).toHaveBeenCalled();
    expect(res.send.mock.calls[0][0].body.message).toBe("Ad updated successfully");
  });

  it("TIKTOK_USER createdUser=false branch: calls tiktokUser.update", async () => {
    searchDocSpy.mockResolvedValueOnce({
      first_seen: 0, sql_id: 9,
      likes: 1, comments: 2, shares: 3, // match payload → ANALYTICS.create NOT pushed
    });
    validateSpy.mockReturnValueOnce({ value: basePayload(), error: undefined });
    convertTSSpy.mockReturnValueOnce(1000);
    daysRunningSpy.mockReturnValueOnce(1);
    PO_findOrCreate.mockResolvedValueOnce([{ id: 7 }, true]);
    const ttUserUpdate = vi.fn().mockResolvedValue(undefined);
    TIKTOK_USER_findOrCreate.mockResolvedValueOnce([
      { update: ttUserUpdate }, false, // createdUser=false → update branch
    ]);
    TT_update.mockResolvedValueOnce([1]);
    TT_findOne.mockResolvedValueOnce({ id: 99 });
    META_update.mockResolvedValue([1]);
    updateDocSpy.mockResolvedValueOnce({});
    const res = mockRes();
    await svc.update({ body: basePayload() }, res);
    expect(ttUserUpdate).toHaveBeenCalledWith(
      { system_id: "sys" },
      { transaction: expect.anything() }
    );
  });

  it("outer catch: 'Error in data updation' when an unexpected throw escapes inner handlers", async () => {
    // searchDoc throws on the OUTER try (before the inner try wraps anything)
    searchDocSpy.mockRejectedValueOnce(new Error("unexpected"));
    // Note: searchDoc is inside the outer try at line 287, so this falls
    // through to the outer catch at line 468.
    const res = mockRes();
    await svc.update({ body: basePayload() }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Error in data updation");
  });

  it("update finally: forced-rollback throws → 'Error releasing transaction connection' logged (lines 478-481)", async () => {
    // Use a custom tx whose rollback throws and whose finished stays undefined,
    // so the finally block tries to roll back and catches the throw.
    const tx = {
      commit: vi.fn(async () => {}),
      rollback: vi.fn(async () => { throw new Error("rb-fail"); }),
      finished: undefined,
    };
    transactionSpy.mockResolvedValueOnce(tx);
    searchDocSpy.mockResolvedValueOnce({
      first_seen: 0, sql_id: 9,
      likes: 1, comments: 2, shares: 3,
    });
    validateSpy.mockReturnValueOnce({ value: basePayload(), error: undefined });
    convertTSSpy.mockReturnValueOnce(1000);
    daysRunningSpy.mockReturnValueOnce(1);
    PO_findOrCreate.mockResolvedValueOnce([{ id: 7 }, true]);
    TIKTOK_USER_findOrCreate.mockResolvedValueOnce([{ update: vi.fn() }, true]);
    TT_update.mockResolvedValueOnce([1]);
    TT_findOne.mockResolvedValueOnce({ id: 99 });
    META_update.mockResolvedValue([1]);
    updateDocSpy.mockResolvedValueOnce({});
    const res = mockRes();
    await svc.update({ body: basePayload() }, res);
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      "Error releasing transaction connection",
      expect.any(Error)
    );
  });

  it("update transaction undefined: finally `if (transaction)` falsy branch (line 475 false side)", async () => {
    transactionSpy.mockResolvedValueOnce(undefined);
    searchDocSpy.mockResolvedValueOnce({
      first_seen: 0, sql_id: 9,
      likes: 1, comments: 2, shares: 3,
    });
    validateSpy.mockReturnValueOnce({ value: basePayload(), error: undefined });
    convertTSSpy.mockReturnValueOnce(1000);
    daysRunningSpy.mockReturnValueOnce(1);
    PO_findOrCreate.mockResolvedValueOnce([{ id: 7 }, true]);
    TIKTOK_USER_findOrCreate.mockResolvedValueOnce([{ update: vi.fn() }, true]);
    TT_update.mockResolvedValueOnce([1]);
    TT_findOne.mockResolvedValueOnce({ id: 99 });
    META_update.mockResolvedValue([1]);
    updateDocSpy.mockResolvedValueOnce({});
    const res = mockRes();
    await expect(svc.update({ body: basePayload() }, res)).rejects.toThrow();
  });
});

// =====================================================================
// create() — the 228-line orchestrator that inserts a new ad across
// SQL + ES + S3 thumbnail upload + language translation.
// =====================================================================
describe("tiktok.service > create", () => {
  function createPayload(over = {}) {
    return {
      ad_id: "a1", post_owner: "po", tiktok_account_id: "ttid",
      tiktok_account_name: "ttname", system_id: "sys",
      clicks_graph: [], ctr: 0.1,
      likes: 1, comments: 2, shares: 3,
      first_seen: 100, last_seen: 200,
      ad_title: "title",
      ...over,
    };
  }

  it("'Missing request data' when body undefined", async () => {
    const res = mockRes();
    await svc.create({}, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Missing request data");
    expect(rollbackSpy).toHaveBeenCalled();
  });

  it("delegates to updateESInsertSQL when adExist=true but adExistSQL=false", async () => {
    indexExistsSpy.mockResolvedValueOnce(true);
    searchDocSpy.mockResolvedValueOnce({ sql_id: 1 }); // adExist truthy
    TT_findOne.mockResolvedValueOnce(null);             // adExistSQL falsy
    // updateESInsertSQL itself will run partially; we just need to confirm
    // we don't fall through to the create body. Set validation to fail
    // so it short-circuits inside updateESInsertSQL.
    validateSpy.mockReturnValueOnce({ value: {}, error: { details: "bad" } });
    const res = mockRes();
    await svc.create({ body: createPayload() }, res);
    // Branch was taken — no error path through TIK_TOK.create
    expect(TT_create).not.toHaveBeenCalled();
  });

  it("delegates to updateSQLInsertES when adExist=false but adExistSQL=true", async () => {
    indexExistsSpy.mockResolvedValueOnce(true);
    searchDocSpy.mockResolvedValueOnce(null);
    TT_findOne.mockResolvedValueOnce({ id: 1 });
    validateSpy.mockReturnValueOnce({ value: {}, error: { details: "bad" } });
    const res = mockRes();
    await svc.create({ body: createPayload() }, res);
    expect(TT_create).not.toHaveBeenCalled();
  });

  it("delegates to update when both adExist and adExistSQL are truthy", async () => {
    indexExistsSpy.mockResolvedValueOnce(true);
    searchDocSpy.mockResolvedValueOnce({ sql_id: 1 });
    TT_findOne.mockResolvedValueOnce({ id: 1 });
    // The update path also calls searchDoc again at line 287, then validation.
    searchDocSpy.mockResolvedValueOnce({ first_seen: 0, sql_id: 1 });
    validateSpy.mockReturnValueOnce({ value: {}, error: { details: "bad" } });
    const res = mockRes();
    await svc.create({ body: createPayload() }, res);
    // Update was taken; create body skipped
    expect(TT_create).not.toHaveBeenCalled();
  });

  it("calls createIndex when indexExists returns false (first-time creation)", async () => {
    indexExistsSpy.mockResolvedValueOnce(false);
    createIndexSpy.mockResolvedValueOnce({});
    searchDocSpy.mockResolvedValueOnce(null);
    TT_findOne.mockResolvedValueOnce(null);
    // Fail validation so we short-circuit
    validateSpy.mockReturnValueOnce({ value: {}, error: { details: "bad" } });
    const res = mockRes();
    await svc.create({ body: createPayload() }, res);
    expect(createIndexSpy).toHaveBeenCalled();
  });

  it("VALIDATION_FAIL when validator returns error in the create body", async () => {
    indexExistsSpy.mockResolvedValueOnce(true);
    searchDocSpy.mockResolvedValueOnce(null);
    TT_findOne.mockResolvedValueOnce(null);
    validateSpy.mockReturnValueOnce({ value: {}, error: { details: "bad" } });
    const res = mockRes();
    await svc.create({ body: createPayload() }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("VALIDATION_FAIL");
  });

  it("'Language translation error' when languageTranslation returns code 500", async () => {
    indexExistsSpy.mockResolvedValueOnce(true);
    searchDocSpy.mockResolvedValueOnce(null);
    TT_findOne.mockResolvedValueOnce(null);
    validateSpy.mockReturnValueOnce({
      value: createPayload({ thumbnailVaild: "INVALID" }), error: undefined,
    });
    convertTSSpy.mockReturnValue(1000);
    daysRunningSpy.mockReturnValue(1);
    langSpy.mockResolvedValueOnce({ code: 500, msg: "lang-fail" });
    const res = mockRes();
    await svc.create({ body: createPayload() }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Language translation error");
  });

  it("'Language translation error' when languageTranslation throws (langError catch)", async () => {
    indexExistsSpy.mockResolvedValueOnce(true);
    searchDocSpy.mockResolvedValueOnce(null);
    TT_findOne.mockResolvedValueOnce(null);
    validateSpy.mockReturnValueOnce({
      value: createPayload({ thumbnailVaild: "INVALID" }), error: undefined,
    });
    convertTSSpy.mockReturnValue(1000);
    daysRunningSpy.mockReturnValue(1);
    langSpy.mockRejectedValueOnce(new Error("lang-down"));
    const res = mockRes();
    await svc.create({ body: createPayload() }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Language translation error");
  });

  it("'Unable to upload expired thumbnail-image' when getS3Url throws (thumbnailVaild=VALID branch)", async () => {
    indexExistsSpy.mockResolvedValueOnce(true);
    searchDocSpy.mockResolvedValueOnce(null);
    TT_findOne.mockResolvedValueOnce(null);
    validateSpy.mockReturnValueOnce({
      value: createPayload({ thumbnailVaild: "VALID", video_cover: "vc" }), error: undefined,
    });
    convertTSSpy.mockReturnValue(1000);
    daysRunningSpy.mockReturnValue(1);
    langSpy.mockResolvedValueOnce("en");
    // getS3Url throws via axios reject (S3 upload helper chain)
    existsSyncSpy.mockReturnValueOnce(true);
    axiosSpy.mockRejectedValueOnce(new Error("s3-down"));
    const res = mockRes();
    await svc.create({ body: createPayload() }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Unable to upload expired thumbnail-image into NAS"
    );
  });

  it("'Error in findOrCreate' when POST_OWNER findOrCreate throws", async () => {
    indexExistsSpy.mockResolvedValueOnce(true);
    searchDocSpy.mockResolvedValueOnce(null);
    TT_findOne.mockResolvedValueOnce(null);
    validateSpy.mockReturnValueOnce({
      value: createPayload({ thumbnailVaild: "INVALID" }), error: undefined,
    });
    convertTSSpy.mockReturnValue(1000);
    daysRunningSpy.mockReturnValue(1);
    langSpy.mockResolvedValueOnce("en");
    PO_findOrCreate.mockRejectedValueOnce(new Error("po-down"));
    const res = mockRes();
    await svc.create({ body: createPayload() }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Error in findOrCreate");
  });

  it("POST_OWNER created=false branch: calls POST_OWNER.increment", async () => {
    indexExistsSpy.mockResolvedValueOnce(true);
    searchDocSpy.mockResolvedValueOnce(null);
    TT_findOne.mockResolvedValueOnce(null);
    validateSpy.mockReturnValueOnce({
      value: createPayload({ thumbnailVaild: "INVALID" }), error: undefined,
    });
    convertTSSpy.mockReturnValue(1000);
    daysRunningSpy.mockReturnValue(1);
    langSpy.mockResolvedValueOnce("en");
    PO_findOrCreate.mockResolvedValueOnce([{ id: 7 }, false]); // created=false → increment
    PO_increment.mockResolvedValueOnce(undefined);
    TIKTOK_USER_findOrCreate.mockResolvedValueOnce([{ update: vi.fn() }, true]);
    TT_create.mockResolvedValueOnce({ id: 99 });
    AD_LOC_create.mockResolvedValueOnce({});
    META_create.mockResolvedValueOnce({});
    VARIANTS_create.mockResolvedValueOnce({});
    ANALYTICS_create.mockResolvedValueOnce({});
    LANDER_create.mockResolvedValueOnce({});
    insertDataSpy.mockResolvedValueOnce({ result: "created" });
    const res = mockRes();
    await svc.create({ body: createPayload() }, res);
    expect(PO_increment).toHaveBeenCalledWith(
      { ads_count: 1 },
      expect.objectContaining({ where: { id: 7 } })
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.send.mock.calls[0][0].body.message).toBe("Ad created successfully");
  });

  it("'Error in POST_OWNER increment' when increment throws", async () => {
    indexExistsSpy.mockResolvedValueOnce(true);
    searchDocSpy.mockResolvedValueOnce(null);
    TT_findOne.mockResolvedValueOnce(null);
    validateSpy.mockReturnValueOnce({
      value: createPayload({ thumbnailVaild: "INVALID" }), error: undefined,
    });
    convertTSSpy.mockReturnValue(1000);
    daysRunningSpy.mockReturnValue(1);
    langSpy.mockResolvedValueOnce("en");
    PO_findOrCreate.mockResolvedValueOnce([{ id: 7 }, false]);
    PO_increment.mockRejectedValueOnce(new Error("inc-down"));
    const res = mockRes();
    await svc.create({ body: createPayload() }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Error in POST_OWNER increment");
  });

  it("happy path: POST_OWNER created=true, age + gender provided → all collaborators succeed", async () => {
    indexExistsSpy.mockResolvedValueOnce(true);
    searchDocSpy.mockResolvedValueOnce(null);
    TT_findOne.mockResolvedValueOnce(null);
    validateSpy.mockReturnValueOnce({
      value: createPayload({
        thumbnailVaild: "INVALID",
        age: { IN: [1, 2, 3, 4, 5, 6] },
        gender: { IN: [10, 20, 30] },
      }),
      error: undefined,
    });
    convertTSSpy.mockReturnValue(1000);
    daysRunningSpy.mockReturnValue(1);
    langSpy.mockResolvedValueOnce("en");
    PO_findOrCreate.mockResolvedValueOnce([{ id: 7 }, true]);
    TIKTOK_USER_findOrCreate.mockResolvedValueOnce([{ update: vi.fn() }, true]);
    TT_create.mockResolvedValueOnce({ id: 99 });
    AD_LOC_create.mockResolvedValueOnce({});
    META_create.mockResolvedValueOnce({});
    VARIANTS_create.mockResolvedValueOnce({});
    ANALYTICS_create.mockResolvedValueOnce({});
    LANDER_create.mockResolvedValueOnce({});
    COUNTRY_AGES_bulk.mockResolvedValueOnce([]);
    COUNTRY_GENDERS_bulk.mockResolvedValueOnce([]);
    insertDataSpy.mockResolvedValueOnce({ result: "created" });
    const res = mockRes();
    await svc.create({ body: createPayload() }, res);
    expect(commitSpy).toHaveBeenCalled();
    expect(COUNTRY_AGES_bulk).toHaveBeenCalled();
    expect(COUNTRY_GENDERS_bulk).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("does not commit when insertData returns non-created result (line 241 false branch)", async () => {
    indexExistsSpy.mockResolvedValueOnce(true);
    searchDocSpy.mockResolvedValueOnce(null);
    TT_findOne.mockResolvedValueOnce(null);
    validateSpy.mockReturnValueOnce({
      value: createPayload({ thumbnailVaild: "INVALID" }), error: undefined,
    });
    convertTSSpy.mockReturnValue(1000);
    daysRunningSpy.mockReturnValue(1);
    langSpy.mockResolvedValueOnce("en");
    PO_findOrCreate.mockResolvedValueOnce([{ id: 7 }, true]);
    TIKTOK_USER_findOrCreate.mockResolvedValueOnce([{ update: vi.fn() }, true]);
    TT_create.mockResolvedValueOnce({ id: 99 });
    AD_LOC_create.mockResolvedValue({});
    META_create.mockResolvedValue({});
    VARIANTS_create.mockResolvedValue({});
    ANALYTICS_create.mockResolvedValue({});
    LANDER_create.mockResolvedValue({});
    insertDataSpy.mockResolvedValueOnce({ result: "notcreated" });
    const res = mockRes();
    await svc.create({ body: createPayload() }, res);
    expect(commitSpy).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(201);
  });

  it("'Error in TIKTOK_USER upsert' when TIKTOK_USER findOrCreate throws", async () => {
    indexExistsSpy.mockResolvedValueOnce(true);
    searchDocSpy.mockResolvedValueOnce(null);
    TT_findOne.mockResolvedValueOnce(null);
    validateSpy.mockReturnValueOnce({
      value: createPayload({ thumbnailVaild: "INVALID" }), error: undefined,
    });
    convertTSSpy.mockReturnValue(1000);
    daysRunningSpy.mockReturnValue(1);
    langSpy.mockResolvedValueOnce("en");
    PO_findOrCreate.mockResolvedValueOnce([{ id: 7 }, true]);
    TIKTOK_USER_findOrCreate.mockRejectedValueOnce(new Error("tt-user-down"));
    const res = mockRes();
    await svc.create({ body: createPayload() }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Error in TIKTOK_USER upsert");
  });

  it("thumbnailVaild='VALID' happy path: getS3Url succeeds → value.video_cover replaced (line 115)", async () => {
    indexExistsSpy.mockResolvedValueOnce(true);
    searchDocSpy.mockResolvedValueOnce(null);
    TT_findOne.mockResolvedValueOnce(null);
    validateSpy.mockReturnValueOnce({
      value: createPayload({ thumbnailVaild: "VALID", video_cover: "vc-orig" }),
      error: undefined,
    });
    convertTSSpy.mockReturnValue(1000);
    daysRunningSpy.mockReturnValue(1);
    langSpy.mockResolvedValueOnce("en");
    existsSyncSpy.mockReturnValueOnce(true);
    const writer = {
      on(event, cb) { if (event === "finish") setImmediate(cb); },
    };
    createWriteStreamSpy.mockReturnValueOnce(writer);
    axiosSpy.mockResolvedValueOnce({ data: { pipe: vi.fn() } });
    uploadFileSpy.mockResolvedValueOnce("https://s3/uploaded.webp");
    readdirSpy.mockImplementationOnce((_p, cb) => cb(null, []));
    PO_findOrCreate.mockResolvedValueOnce([{ id: 7 }, true]);
    TIKTOK_USER_findOrCreate.mockResolvedValueOnce([{ update: vi.fn() }, true]);
    TT_create.mockResolvedValueOnce({ id: 99 });
    AD_LOC_create.mockResolvedValueOnce({});
    META_create.mockResolvedValueOnce({});
    VARIANTS_create.mockResolvedValueOnce({});
    ANALYTICS_create.mockResolvedValueOnce({});
    LANDER_create.mockResolvedValueOnce({});
    insertDataSpy.mockResolvedValueOnce({ result: "created" });
    const res = mockRes();
    await svc.create({ body: createPayload() }, res);
    expect(uploadFileSpy).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("TIKTOK_USER createdUser=false → calls tiktokUser.update with new system_id", async () => {
    indexExistsSpy.mockResolvedValueOnce(true);
    searchDocSpy.mockResolvedValueOnce(null);
    TT_findOne.mockResolvedValueOnce(null);
    validateSpy.mockReturnValueOnce({
      value: createPayload({ thumbnailVaild: "INVALID" }), error: undefined,
    });
    convertTSSpy.mockReturnValue(1000);
    daysRunningSpy.mockReturnValue(1);
    langSpy.mockResolvedValueOnce("en");
    PO_findOrCreate.mockResolvedValueOnce([{ id: 7 }, true]);
    const ttUserUpdate = vi.fn().mockResolvedValue(undefined);
    TIKTOK_USER_findOrCreate.mockResolvedValueOnce([
      { update: ttUserUpdate }, false,
    ]);
    TT_create.mockResolvedValueOnce({ id: 99 });
    AD_LOC_create.mockResolvedValueOnce({});
    META_create.mockResolvedValueOnce({});
    VARIANTS_create.mockResolvedValueOnce({});
    ANALYTICS_create.mockResolvedValueOnce({});
    LANDER_create.mockResolvedValueOnce({});
    insertDataSpy.mockResolvedValueOnce({ result: "created" });
    const res = mockRes();
    await svc.create({ body: createPayload() }, res);
    expect(ttUserUpdate).toHaveBeenCalledWith(
      { system_id: "sys" },
      expect.objectContaining({ transaction: expect.anything() })
    );
  });

  it("'Error in TIK_TOK create' when TIK_TOK.create throws", async () => {
    indexExistsSpy.mockResolvedValueOnce(true);
    searchDocSpy.mockResolvedValueOnce(null);
    TT_findOne.mockResolvedValueOnce(null);
    validateSpy.mockReturnValueOnce({
      value: createPayload({ thumbnailVaild: "INVALID" }), error: undefined,
    });
    convertTSSpy.mockReturnValue(1000);
    daysRunningSpy.mockReturnValue(1);
    langSpy.mockResolvedValueOnce("en");
    PO_findOrCreate.mockResolvedValueOnce([{ id: 7 }, true]);
    TIKTOK_USER_findOrCreate.mockResolvedValueOnce([{ update: vi.fn() }, true]);
    TT_create.mockRejectedValueOnce(new Error("create-down"));
    const res = mockRes();
    await svc.create({ body: createPayload() }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Error in TIK_TOK create");
  });

  it("'Error in adInsertOperations' when Promise.all on inserts rejects", async () => {
    indexExistsSpy.mockResolvedValueOnce(true);
    searchDocSpy.mockResolvedValueOnce(null);
    TT_findOne.mockResolvedValueOnce(null);
    validateSpy.mockReturnValueOnce({
      value: createPayload({ thumbnailVaild: "INVALID" }), error: undefined,
    });
    convertTSSpy.mockReturnValue(1000);
    daysRunningSpy.mockReturnValue(1);
    langSpy.mockResolvedValueOnce("en");
    PO_findOrCreate.mockResolvedValueOnce([{ id: 7 }, true]);
    TIKTOK_USER_findOrCreate.mockResolvedValueOnce([{ update: vi.fn() }, true]);
    TT_create.mockResolvedValueOnce({ id: 99 });
    AD_LOC_create.mockRejectedValueOnce(new Error("ad-loc-down"));
    META_create.mockResolvedValue({});
    VARIANTS_create.mockResolvedValue({});
    ANALYTICS_create.mockResolvedValue({});
    LANDER_create.mockResolvedValue({});
    const res = mockRes();
    await svc.create({ body: createPayload() }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Error in adInsertOperations");
  });

  it("outer catch: 'Error in inserting ad' when indexExists throws", async () => {
    indexExistsSpy.mockRejectedValueOnce(new Error("es-down"));
    const res = mockRes();
    await svc.create({ body: createPayload() }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Error in inserting ad");
  });

  it("create finally: forced-rollback throws → logs 'Error releasing transaction connection' (line 267)", async () => {
    const tx = {
      commit: vi.fn(async () => {}),
      rollback: vi.fn(async () => { throw new Error("rb-fail"); }),
      finished: undefined,
    };
    transactionSpy.mockResolvedValueOnce(tx);
    indexExistsSpy.mockResolvedValueOnce(true);
    searchDocSpy.mockResolvedValueOnce(null);
    TT_findOne.mockResolvedValueOnce(null);
    validateSpy.mockReturnValueOnce({
      value: createPayload({ thumbnailVaild: "INVALID" }), error: undefined,
    });
    convertTSSpy.mockReturnValue(1000);
    daysRunningSpy.mockReturnValue(1);
    langSpy.mockResolvedValueOnce("en");
    PO_findOrCreate.mockResolvedValueOnce([{ id: 7 }, true]);
    TIKTOK_USER_findOrCreate.mockResolvedValueOnce([{ update: vi.fn() }, true]);
    TT_create.mockResolvedValueOnce({ id: 99 });
    AD_LOC_create.mockResolvedValue({});
    META_create.mockResolvedValue({});
    VARIANTS_create.mockResolvedValue({});
    ANALYTICS_create.mockResolvedValue({});
    LANDER_create.mockResolvedValue({});
    insertDataSpy.mockResolvedValueOnce({ result: "created" });
    const res = mockRes();
    await svc.create({ body: createPayload() }, res);
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      "Error releasing transaction connection",
      expect.any(Error)
    );
  });

  it("create transaction undefined: finally `if (transaction)` falsy branch (line 261 false side)", async () => {
    transactionSpy.mockResolvedValueOnce(undefined);
    indexExistsSpy.mockResolvedValueOnce(true);
    searchDocSpy.mockResolvedValueOnce(null);
    TT_findOne.mockResolvedValueOnce(null);
    validateSpy.mockReturnValueOnce({
      value: createPayload({ thumbnailVaild: "INVALID" }), error: undefined,
    });
    convertTSSpy.mockReturnValue(1000);
    daysRunningSpy.mockReturnValue(1);
    langSpy.mockResolvedValueOnce("en");
    PO_findOrCreate.mockResolvedValueOnce([{ id: 7 }, true]);
    TIKTOK_USER_findOrCreate.mockResolvedValueOnce([{ update: vi.fn() }, true]);
    TT_create.mockResolvedValueOnce({ id: 99 });
    AD_LOC_create.mockResolvedValue({});
    META_create.mockResolvedValue({});
    VARIANTS_create.mockResolvedValue({});
    ANALYTICS_create.mockResolvedValue({});
    LANDER_create.mockResolvedValue({});
    insertDataSpy.mockResolvedValueOnce({ result: "created" });
    const res = mockRes();
    // commit() on undefined throws → outer catch's rollback throws TypeError
    await expect(svc.create({ body: createPayload() }, res)).rejects.toThrow();
  });
});

// =====================================================================
// updateESInsertSQL() — invoked when ES has the ad but SQL doesn't.
// Structurally near-identical to create() but uses updateDocument
// instead of insertData and reports "Ad Updated successfully".
// =====================================================================
describe("tiktok.service > updateESInsertSQL", () => {
  function payload(over = {}) {
    return {
      ad_id: "a1", post_owner: "po", tiktok_account_id: "ttid",
      tiktok_account_name: "ttname", system_id: "sys",
      clicks_graph: [], ctr: 0.1, likes: 1, comments: 2, shares: 3,
      first_seen: 100, last_seen: 200, ad_title: "title",
      thumbnailVaild: "INVALID",
      ...over,
    };
  }

  it("happy path: updates ES + inserts SQL, commits, returns 201 'Ad Updated successfully'", async () => {
    validateSpy.mockReturnValueOnce({ value: payload(), error: undefined });
    convertTSSpy.mockReturnValue(1000);
    daysRunningSpy.mockReturnValue(1);
    langSpy.mockResolvedValueOnce("en");
    PO_findOrCreate.mockResolvedValueOnce([{ id: 7 }, true]);
    TIKTOK_USER_findOrCreate.mockResolvedValueOnce([{ update: vi.fn() }, true]);
    TT_create.mockResolvedValueOnce({ id: 99 });
    AD_LOC_create.mockResolvedValue({});
    META_create.mockResolvedValue({});
    VARIANTS_create.mockResolvedValue({});
    ANALYTICS_create.mockResolvedValue({});
    LANDER_create.mockResolvedValue({});
    updateDocSpy.mockResolvedValueOnce({ updated: 1 });
    const res = mockRes();
    await svc.updateESInsertSQL({ body: payload() }, res);
    expect(commitSpy).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("does not commit when updateDocument returns updated=0 (line 630 false branch)", async () => {
    validateSpy.mockReturnValueOnce({ value: payload(), error: undefined });
    convertTSSpy.mockReturnValue(1000);
    daysRunningSpy.mockReturnValue(1);
    langSpy.mockResolvedValueOnce("en");
    PO_findOrCreate.mockResolvedValueOnce([{ id: 7 }, true]);
    TIKTOK_USER_findOrCreate.mockResolvedValueOnce([{ update: vi.fn() }, true]);
    TT_create.mockResolvedValueOnce({ id: 99 });
    AD_LOC_create.mockResolvedValue({});
    META_create.mockResolvedValue({});
    VARIANTS_create.mockResolvedValue({});
    ANALYTICS_create.mockResolvedValue({});
    LANDER_create.mockResolvedValue({});
    updateDocSpy.mockResolvedValueOnce({ updated: 0 });
    const res = mockRes();
    await svc.updateESInsertSQL({ body: payload() }, res);
    expect(commitSpy).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(201);
  });

  it("VALIDATION_FAIL when validator returns error", async () => {
    validateSpy.mockReturnValueOnce({ value: {}, error: { details: "bad" } });
    const res = mockRes();
    await svc.updateESInsertSQL({ body: payload() }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("VALIDATION_FAIL");
  });

  it("'Language translation error' on languageTranslation code=500", async () => {
    validateSpy.mockReturnValueOnce({ value: payload(), error: undefined });
    convertTSSpy.mockReturnValue(1000);
    daysRunningSpy.mockReturnValue(1);
    langSpy.mockResolvedValueOnce({ code: 500, msg: "fail" });
    const res = mockRes();
    await svc.updateESInsertSQL({ body: payload() }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Language translation error");
  });

  it("'Language translation error' on langError throw", async () => {
    validateSpy.mockReturnValueOnce({ value: payload(), error: undefined });
    convertTSSpy.mockReturnValue(1000);
    daysRunningSpy.mockReturnValue(1);
    langSpy.mockRejectedValueOnce(new Error("lang-down"));
    const res = mockRes();
    await svc.updateESInsertSQL({ body: payload() }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Language translation error");
  });

  it("'Unable to upload expired thumbnail-image' when getS3Url throws (VALID branch)", async () => {
    validateSpy.mockReturnValueOnce({
      value: payload({ thumbnailVaild: "VALID", video_cover: "vc" }), error: undefined,
    });
    convertTSSpy.mockReturnValue(1000);
    daysRunningSpy.mockReturnValue(1);
    langSpy.mockResolvedValueOnce("en");
    existsSyncSpy.mockReturnValueOnce(true);
    axiosSpy.mockRejectedValueOnce(new Error("s3-down"));
    const res = mockRes();
    await svc.updateESInsertSQL({ body: payload() }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Unable to upload expired thumbnail-image into NAS"
    );
  });

  it("thumbnailVaild='VALID' happy path: getS3Url succeeds → value.video_cover replaced (line 541)", async () => {
    validateSpy.mockReturnValueOnce({
      value: payload({ thumbnailVaild: "VALID", video_cover: "vc-orig" }),
      error: undefined,
    });
    convertTSSpy.mockReturnValue(1000);
    daysRunningSpy.mockReturnValue(1);
    langSpy.mockResolvedValueOnce("en");
    existsSyncSpy.mockReturnValueOnce(true);
    const writer = {
      on(event, cb) { if (event === "finish") setImmediate(cb); },
    };
    createWriteStreamSpy.mockReturnValueOnce(writer);
    axiosSpy.mockResolvedValueOnce({ data: { pipe: vi.fn() } });
    uploadFileSpy.mockResolvedValueOnce("https://s3/uploaded.webp");
    readdirSpy.mockImplementationOnce((_p, cb) => cb(null, []));
    PO_findOrCreate.mockResolvedValueOnce([{ id: 7 }, true]);
    TIKTOK_USER_findOrCreate.mockResolvedValueOnce([{ update: vi.fn() }, true]);
    TT_create.mockResolvedValueOnce({ id: 99 });
    AD_LOC_create.mockResolvedValueOnce({});
    META_create.mockResolvedValueOnce({});
    VARIANTS_create.mockResolvedValueOnce({});
    ANALYTICS_create.mockResolvedValueOnce({});
    LANDER_create.mockResolvedValueOnce({});
    updateDocSpy.mockResolvedValueOnce({ updated: 1 });
    const res = mockRes();
    await svc.updateESInsertSQL({ body: payload() }, res);
    expect(uploadFileSpy).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("'Error in findOrCreate' when POST_OWNER throws", async () => {
    validateSpy.mockReturnValueOnce({ value: payload(), error: undefined });
    convertTSSpy.mockReturnValue(1000);
    daysRunningSpy.mockReturnValue(1);
    langSpy.mockResolvedValueOnce("en");
    PO_findOrCreate.mockRejectedValueOnce(new Error("po-down"));
    const res = mockRes();
    await svc.updateESInsertSQL({ body: payload() }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Error in findOrCreate");
  });

  it("POST_OWNER created=false branch → 'Error in POST_OWNER increment' when increment throws", async () => {
    validateSpy.mockReturnValueOnce({ value: payload(), error: undefined });
    convertTSSpy.mockReturnValue(1000);
    daysRunningSpy.mockReturnValue(1);
    langSpy.mockResolvedValueOnce("en");
    PO_findOrCreate.mockResolvedValueOnce([{ id: 7 }, false]);
    PO_increment.mockRejectedValueOnce(new Error("inc-down"));
    const res = mockRes();
    await svc.updateESInsertSQL({ body: payload() }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Error in POST_OWNER increment");
  });

  it("'Error in TIKTOK_USER upsert' when TIKTOK_USER throws", async () => {
    validateSpy.mockReturnValueOnce({ value: payload(), error: undefined });
    convertTSSpy.mockReturnValue(1000);
    daysRunningSpy.mockReturnValue(1);
    langSpy.mockResolvedValueOnce("en");
    PO_findOrCreate.mockResolvedValueOnce([{ id: 7 }, true]);
    TIKTOK_USER_findOrCreate.mockRejectedValueOnce(new Error("tu-down"));
    const res = mockRes();
    await svc.updateESInsertSQL({ body: payload() }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Error in TIKTOK_USER upsert");
  });

  it("TIKTOK_USER createdUser=false branch: calls tiktokUser.update", async () => {
    validateSpy.mockReturnValueOnce({ value: payload(), error: undefined });
    convertTSSpy.mockReturnValue(1000);
    daysRunningSpy.mockReturnValue(1);
    langSpy.mockResolvedValueOnce("en");
    PO_findOrCreate.mockResolvedValueOnce([{ id: 7 }, true]);
    const ttUserUpdate = vi.fn().mockResolvedValue(undefined);
    TIKTOK_USER_findOrCreate.mockResolvedValueOnce([{ update: ttUserUpdate }, false]);
    TT_create.mockResolvedValueOnce({ id: 99 });
    AD_LOC_create.mockResolvedValue({});
    META_create.mockResolvedValue({});
    VARIANTS_create.mockResolvedValue({});
    ANALYTICS_create.mockResolvedValue({});
    LANDER_create.mockResolvedValue({});
    updateDocSpy.mockResolvedValueOnce({ updated: 1 });
    const res = mockRes();
    await svc.updateESInsertSQL({ body: payload() }, res);
    expect(ttUserUpdate).toHaveBeenCalled();
  });

  it("'Error in TIK_TOK create' when TIK_TOK.create throws", async () => {
    validateSpy.mockReturnValueOnce({ value: payload(), error: undefined });
    convertTSSpy.mockReturnValue(1000);
    daysRunningSpy.mockReturnValue(1);
    langSpy.mockResolvedValueOnce("en");
    PO_findOrCreate.mockResolvedValueOnce([{ id: 7 }, true]);
    TIKTOK_USER_findOrCreate.mockResolvedValueOnce([{ update: vi.fn() }, true]);
    TT_create.mockRejectedValueOnce(new Error("create-down"));
    const res = mockRes();
    await svc.updateESInsertSQL({ body: payload() }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Error in TIK_TOK create");
  });

  it("'Error in adInsertOperations' when Promise.all rejects", async () => {
    validateSpy.mockReturnValueOnce({ value: payload(), error: undefined });
    convertTSSpy.mockReturnValue(1000);
    daysRunningSpy.mockReturnValue(1);
    langSpy.mockResolvedValueOnce("en");
    PO_findOrCreate.mockResolvedValueOnce([{ id: 7 }, true]);
    TIKTOK_USER_findOrCreate.mockResolvedValueOnce([{ update: vi.fn() }, true]);
    TT_create.mockResolvedValueOnce({ id: 99 });
    AD_LOC_create.mockRejectedValueOnce(new Error("ad-loc-down"));
    META_create.mockResolvedValue({});
    VARIANTS_create.mockResolvedValue({});
    ANALYTICS_create.mockResolvedValue({});
    LANDER_create.mockResolvedValue({});
    const res = mockRes();
    await svc.updateESInsertSQL({ body: payload() }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Error in adInsertOperations");
  });

  it("outer catch: 'Error in data updation' when validator throws", async () => {
    validateSpy.mockImplementationOnce(() => { throw new Error("unexpected"); });
    const res = mockRes();
    await svc.updateESInsertSQL({ body: payload() }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Error in data updation");
  });

  it("updateESInsertSQL finally: forced-rollback throws → logs 'Error releasing transaction connection' (line 656)", async () => {
    const tx = {
      commit: vi.fn(async () => {}),
      rollback: vi.fn(async () => { throw new Error("rb-fail"); }),
      finished: undefined,
    };
    transactionSpy.mockResolvedValueOnce(tx);
    validateSpy.mockReturnValueOnce({ value: payload(), error: undefined });
    convertTSSpy.mockReturnValue(1000);
    daysRunningSpy.mockReturnValue(1);
    langSpy.mockResolvedValueOnce("en");
    PO_findOrCreate.mockResolvedValueOnce([{ id: 7 }, true]);
    TIKTOK_USER_findOrCreate.mockResolvedValueOnce([{ update: vi.fn() }, true]);
    TT_create.mockResolvedValueOnce({ id: 99 });
    AD_LOC_create.mockResolvedValue({});
    META_create.mockResolvedValue({});
    VARIANTS_create.mockResolvedValue({});
    ANALYTICS_create.mockResolvedValue({});
    LANDER_create.mockResolvedValue({});
    updateDocSpy.mockResolvedValueOnce({ updated: 1 });
    const res = mockRes();
    await svc.updateESInsertSQL({ body: payload() }, res);
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      "Error releasing transaction connection",
      expect.any(Error)
    );
  });

  it("updateESInsertSQL transaction undefined: finally `if (transaction)` falsy branch (line 650 false side)", async () => {
    transactionSpy.mockResolvedValueOnce(undefined);
    validateSpy.mockReturnValueOnce({ value: payload(), error: undefined });
    convertTSSpy.mockReturnValue(1000);
    daysRunningSpy.mockReturnValue(1);
    langSpy.mockResolvedValueOnce("en");
    PO_findOrCreate.mockResolvedValueOnce([{ id: 7 }, true]);
    TIKTOK_USER_findOrCreate.mockResolvedValueOnce([{ update: vi.fn() }, true]);
    TT_create.mockResolvedValueOnce({ id: 99 });
    AD_LOC_create.mockResolvedValue({});
    META_create.mockResolvedValue({});
    VARIANTS_create.mockResolvedValue({});
    ANALYTICS_create.mockResolvedValue({});
    LANDER_create.mockResolvedValue({});
    updateDocSpy.mockResolvedValueOnce({ updated: 1 });
    const res = mockRes();
    await expect(svc.updateESInsertSQL({ body: payload() }, res)).rejects.toThrow();
  });
});

// =====================================================================
// updateSQLInsertES() — invoked when SQL has the ad but ES doesn't.
// Updates SQL + inserts into ES via insertData (not updateDocument).
// =====================================================================
describe("tiktok.service > updateSQLInsertES", () => {
  function payload(over = {}) {
    return {
      ad_id: "a1", post_owner: "po", tiktok_account_id: "ttid",
      tiktok_account_name: "ttname", system_id: "sys",
      clicks_graph: [], ctr: 0.1, likes: 1, comments: 2, shares: 3,
      last_seen: 200, ad_title: "title",
      ...over,
    };
  }

  it("'Missing request data' when body undefined", async () => {
    const res = mockRes();
    await svc.updateSQLInsertES({}, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Missing request data");
  });

  it("VALIDATION_FAIL when validator errors", async () => {
    TT_findOne.mockResolvedValueOnce({ id: 1, first_seen: 0, language: "en", likes: 0, comments: 0, shares: 0 });
    META_findAll.mockResolvedValueOnce({ video_cover: "vc" });
    validateSpy.mockReturnValueOnce({ value: {}, error: { details: "bad" } });
    const res = mockRes();
    await svc.updateSQLInsertES({ body: payload() }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("VALIDATION_FAIL");
  });

  it("'Error in findOrCreate POST_OWNER' when POST_OWNER throws", async () => {
    TT_findOne.mockResolvedValueOnce({ id: 1, first_seen: 0, language: "en", likes: 0, comments: 0, shares: 0 });
    META_findAll.mockResolvedValueOnce({ video_cover: "vc" });
    validateSpy.mockReturnValueOnce({ value: payload(), error: undefined });
    convertTSSpy.mockReturnValue(1000);
    daysRunningSpy.mockReturnValue(1);
    PO_findOrCreate.mockRejectedValueOnce(new Error("po-down"));
    const res = mockRes();
    await svc.updateSQLInsertES({ body: payload() }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Error in findOrCreate POST_OWNER");
  });

  it("'Error in TIKTOK_USER upsert' when TIKTOK_USER throws", async () => {
    TT_findOne.mockResolvedValueOnce({ id: 1, first_seen: 0, language: "en", likes: 0, comments: 0, shares: 0 });
    META_findAll.mockResolvedValueOnce({ video_cover: "vc" });
    validateSpy.mockReturnValueOnce({ value: payload(), error: undefined });
    convertTSSpy.mockReturnValue(1000);
    daysRunningSpy.mockReturnValue(1);
    PO_findOrCreate.mockResolvedValueOnce([{ id: 7 }, true]);
    TIKTOK_USER_findOrCreate.mockRejectedValueOnce(new Error("tu-down"));
    const res = mockRes();
    await svc.updateSQLInsertES({ body: payload() }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Error in TIKTOK_USER upsert");
  });

  it("TIKTOK_USER createdUser=false branch + happy path", async () => {
    TT_findOne.mockResolvedValueOnce({ id: 1, first_seen: 0, language: "en", likes: 99, comments: 99, shares: 99 });
    META_findAll.mockResolvedValueOnce({ video_cover: "vc" });
    validateSpy.mockReturnValueOnce({ value: payload(), error: undefined });
    convertTSSpy.mockReturnValue(1000);
    daysRunningSpy.mockReturnValue(1);
    PO_findOrCreate.mockResolvedValueOnce([{ id: 7 }, true]);
    const ttUserUpdate = vi.fn().mockResolvedValue(undefined);
    TIKTOK_USER_findOrCreate.mockResolvedValueOnce([{ update: ttUserUpdate }, false]);
    TT_update.mockResolvedValueOnce([1]);
    TT_findOne.mockResolvedValueOnce({ id: 99 });
    META_update.mockResolvedValue([1]);
    ANALYTICS_create.mockResolvedValueOnce({}); // likes diff → ANALYTICS.create fires
    insertDataSpy.mockResolvedValueOnce({ result: "created" });
    const res = mockRes();
    await svc.updateSQLInsertES({ body: payload() }, res);
    expect(ttUserUpdate).toHaveBeenCalled();
    expect(commitSpy).toHaveBeenCalled();
    expect(res.send.mock.calls.at(-1)[0].body.message).toBe("Ad updated successfully");
  });

  it("does not commit when insertData returns non-created result (line 790 false branch)", async () => {
    TT_findOne.mockResolvedValueOnce({ id: 1, first_seen: 0, language: "en", likes: 1, comments: 2, shares: 3 });
    META_findAll.mockResolvedValueOnce({ video_cover: "vc" });
    validateSpy.mockReturnValueOnce({ value: payload(), error: undefined });
    convertTSSpy.mockReturnValue(1000);
    daysRunningSpy.mockReturnValue(1);
    PO_findOrCreate.mockResolvedValueOnce([{ id: 7 }, true]);
    TIKTOK_USER_findOrCreate.mockResolvedValueOnce([{ update: vi.fn() }, true]);
    TT_update.mockResolvedValueOnce([1]);
    TT_findOne.mockResolvedValueOnce({ id: 99 });
    META_update.mockResolvedValue([1]);
    insertDataSpy.mockResolvedValueOnce({ result: "notcreated" });
    const res = mockRes();
    await svc.updateSQLInsertES({ body: payload() }, res);
    expect(commitSpy).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(201);
  });

  it("'Error in TIK_TOK update' when TIK_TOK.update throws", async () => {
    TT_findOne.mockResolvedValueOnce({ id: 1, first_seen: 0, language: "en", likes: 0, comments: 0, shares: 0 });
    META_findAll.mockResolvedValueOnce({ video_cover: "vc" });
    validateSpy.mockReturnValueOnce({ value: payload(), error: undefined });
    convertTSSpy.mockReturnValue(1000);
    daysRunningSpy.mockReturnValue(1);
    PO_findOrCreate.mockResolvedValueOnce([{ id: 7 }, true]);
    TIKTOK_USER_findOrCreate.mockResolvedValueOnce([{ update: vi.fn() }, true]);
    TT_update.mockRejectedValueOnce(new Error("tt-down"));
    const res = mockRes();
    await svc.updateSQLInsertES({ body: payload() }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Error in TIK_TOK update");
  });

  it("'Error in ad update operations' when Promise.all rejects", async () => {
    TT_findOne.mockResolvedValueOnce({ id: 1, first_seen: 0, language: "en", likes: 1, comments: 2, shares: 3 });
    META_findAll.mockResolvedValueOnce({ video_cover: "vc" });
    validateSpy.mockReturnValueOnce({ value: payload(), error: undefined });
    convertTSSpy.mockReturnValue(1000);
    daysRunningSpy.mockReturnValue(1);
    PO_findOrCreate.mockResolvedValueOnce([{ id: 7 }, true]);
    TIKTOK_USER_findOrCreate.mockResolvedValueOnce([{ update: vi.fn() }, true]);
    TT_update.mockResolvedValueOnce([1]);
    TT_findOne.mockResolvedValueOnce({ id: 99 });
    META_update.mockRejectedValueOnce(new Error("meta-down"));
    const res = mockRes();
    await svc.updateSQLInsertES({ body: payload() }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Error in ad update operations");
  });

  it("outer catch: 'Error in data updation' when TT_findOne throws", async () => {
    TT_findOne.mockRejectedValueOnce(new Error("unexpected"));
    const res = mockRes();
    await svc.updateSQLInsertES({ body: payload() }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Error in data updation");
  });

  it("updateSQLInsertES finally: forced-rollback throws → logs 'Error releasing transaction connection' (lines 813-816)", async () => {
    const tx = {
      commit: vi.fn(async () => {}),
      rollback: vi.fn(async () => { throw new Error("rb-fail"); }),
      finished: undefined,
    };
    transactionSpy.mockResolvedValueOnce(tx);
    TT_findOne.mockResolvedValueOnce({ id: 1, first_seen: 0, language: "en", likes: 1, comments: 2, shares: 3 });
    validateSpy.mockReturnValueOnce({ value: payload(), error: undefined });
    convertTSSpy.mockReturnValue(1000);
    daysRunningSpy.mockReturnValue(1);
    PO_findOrCreate.mockResolvedValueOnce([{ id: 7 }, true]);
    TIKTOK_USER_findOrCreate.mockResolvedValueOnce([{ update: vi.fn() }, true]);
    TT_update.mockResolvedValueOnce([1]);
    TT_findOne.mockResolvedValueOnce({ id: 99 });
    META_update.mockResolvedValue([1]);
    insertDataSpy.mockResolvedValueOnce({ result: "created" });
    const res = mockRes();
    await svc.updateSQLInsertES({ body: payload() }, res);
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      "Error releasing transaction connection",
      expect.any(Error)
    );
  });

  it("updateSQLInsertES transaction undefined: finally `if (transaction)` falsy branch (line 810 false side)", async () => {
    transactionSpy.mockResolvedValueOnce(undefined);
    TT_findOne.mockResolvedValueOnce({ id: 1, first_seen: 0, language: "en", likes: 1, comments: 2, shares: 3 });
    validateSpy.mockReturnValueOnce({ value: payload(), error: undefined });
    convertTSSpy.mockReturnValue(1000);
    daysRunningSpy.mockReturnValue(1);
    PO_findOrCreate.mockResolvedValueOnce([{ id: 7 }, true]);
    TIKTOK_USER_findOrCreate.mockResolvedValueOnce([{ update: vi.fn() }, true]);
    TT_update.mockResolvedValueOnce([1]);
    TT_findOne.mockResolvedValueOnce({ id: 99 });
    META_update.mockResolvedValue([1]);
    insertDataSpy.mockResolvedValueOnce({ result: "created" });
    const res = mockRes();
    await expect(svc.updateSQLInsertES({ body: payload() }, res)).rejects.toThrow();
  });
});
