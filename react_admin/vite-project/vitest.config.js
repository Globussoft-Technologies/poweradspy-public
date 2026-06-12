import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    include: ["tests/**/*.test.{js,jsx}"],
    setupFiles: ["tests/setup.js"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: [
        "src/store/**/*.js",
        "src/utils/**/*.js",
        "src/Context/**/*.{js,jsx}",
        "src/pages/authentication/AuthCheck.jsx",
        "src/pages/authentication/LogOut.jsx",
        "src/pages/user/RangeDatePicker.jsx",
        "src/pages/user/DomainProcessTable.jsx",
        "src/pages/user/FbAccountDetails.jsx",
        "src/pages/authentication/Login.jsx",
        "src/pages/user/RemoteControlStyles.js",
        "src/components/Pas/CrawlerInsight/Facebook.jsx",
        "src/components/Pas/CrawlerInsight/GDN.jsx",
        "src/components/Pas/CrawlerInsight/Google.jsx",
        "src/components/Pas/CrawlerInsight/Insta.jsx",
        "src/components/Pas/CrawlerInsight/Linkedin.jsx",
        "src/components/Pas/CrawlerInsight/Native.jsx",
        "src/components/Pas/CrawlerInsight/Pinterest.jsx",
        "src/components/Pas/CrawlerInsight/Quora.jsx",
        "src/components/Pas/CrawlerInsight/Reddit.jsx",
        "src/components/Pas/CrawlerInsight/Tiktok.jsx",
        "src/components/Pas/CrawlerInsight/Youtube.jsx",
        "src/components/Pas/Loader.jsx",
        "src/App.jsx",
        "src/main.jsx",
        "src/components/CountLoder/CountLoder.jsx",
        "src/components/Pas/CrawlerInsight/Title.jsx",
        "src/components/Pas/CrawlerInsight/TabSliderShimmer.jsx",
        "src/components/Pas/CrawlerInsight/SystemDetailsShimmer.jsx",
        "src/components/Pagination/PaginationCompetitor.jsx",
        "src/components/Pagination/Pagination.jsx",
        "src/components/Pagination/PaginationOtherSearches.jsx",
        "src/components/Pas/Chart/SparklineChart.jsx",
        "src/components/Pas/Chart/CpuLineChart.jsx",
        "src/components/Daterangepicker.jsx",
        "src/components/Pas/ApiResponse.jsx",
        "src/components/UserAdCopyData.jsx",
        "src/components/UserAdCreativeDataCard.jsx",
        "src/components/UserCopyDataCard.jsx",
        "src/components/SimpleDatepicker.jsx",
        "src/components/Pas/Chart/ProcessedChart.jsx",
        "src/routes/index.jsx",
        "src/components/Pas/Chart/CountryCrawlerChartMap.jsx",
        "src/components/Pas/Chart/GraphCrawlerChart.jsx",
        "src/components/Pas/Chart/AdsFunnelDistributedColumnChart.jsx",
        "src/components/Pas/CrawlerInsight/Scroller.jsx",
        "src/components/AdCopySlide.jsx",
        "src/components/CreativeSlide.jsx",
        // "src/components/Pas/Chart/AffiliateNetworksStackedChart.jsx" not enrolled:
        // dead getRandomColor() at line 15 blocks 100% — see #251.
        "src/components/CompetitiveDetailsDatePicker.jsx",
        // "src/components/Pas/Chart/AdTypeCrawlerChart.jsx" not enrolled:
        // unreachable dispose guard at line 37 blocks 100% — see #252.
        "src/components/Pas/AccountWiseAdsTable.jsx",
        "src/components/Pas/Chart/GaugeChart.jsx",
        "src/Layout/Layout.jsx",
        // "src/components/Calculator.jsx" not enrolled: unreachable defensive
        // guards (lines 31, 37) block 100% — see #253.
        "src/components/UserScrollDataCard.jsx",
        // "src/components/Pas/Chart/AdPositionCrawlerChart.jsx" not enrolled:
        // unreachable ref-null guard at line 39 blocks 100% — see #254.
        "src/components/Pas/FbAccountFilter.jsx",
        "src/components/UsageBarGraph.jsx",
        // "src/components/Pas/Dashboard.jsx" not enrolled: dead handleUserDetails
        // (lines 120-123) blocks 100% — see #256.
        "src/components/UserChatSessionCard.jsx",
        // "src/components/Pas/OtherSearches.jsx" not enrolled: dead
        // handleUserDetails (lines 39-42) blocks 100% — see #256.
        // "src/components/Pas/DomainSearches.jsx" not enrolled: defensive
        // ref-null guard + dead header-as-function branch — see #258.
        // "src/components/Pas/AdvertiserSearches.jsx" not enrolled: same — see #258.
        // "src/components/Pas/KeywordSearches.jsx" not enrolled: same — see #258.
        // "src/components/Dashboard.jsx" not enrolled: dead toggleDropdown +
        // handleMenuClick (commented-out toggle button) — see #256.
        // "src/components/GeneratedMedia.jsx" not enrolled: IO defensive guards +
        // dead header-as-function branch block 100%.
        // "src/components/Pas/UserDetailsPas.jsx" not enrolled: count-endpoint
        // result.code branch (unreachable — code accessed on un-unpacked .data).
        // "src/components/CreditDeductionModal.jsx" not enrolled: charts tab
        // button is commented out so renderCharts() is dead code (~30 lines).
        // "src/components/Pas/CompetitorDetails.jsx" not enrolled: same defensive
        // header-as-function branch pattern as DomainSearches — see #258.
        // "src/components/Pas/DailyKeywordDetails.jsx" not enrolled: same — see #258.
        "src/components/AdImageGenerationReview .jsx",
        // "src/pages/user/ModalAccountStatusInfo.jsx" not enrolled: two dead
        // helpers (calculateDaysInclusive, formatSystemDate) per #215, plus
        // two legend-click state-dependent branches that require re-run
        // useEffect to hit.
        // "src/pages/user/ModalSystemInfo.jsx" not enrolled: source bug at
        // lines 43+46 (ReferenceError to undefined `DefaultIcon`) per #214,
        // plus 1 unreachable defensive `return false` at line 152.
        // "src/pages/user/CrawlerInsight.jsx" not in gate yet: scrollLeft +
        // scrollRight helpers are dead — both callers are commented out
        // in source. Tracked in #213.
      ],
      exclude: ["tests/**", "**/node_modules/**"],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
