// System Info tab — revamped to the new Grafana-style crawler dashboard.
// The full UI lives in ./CrawlerDashboard (KPI tiles, per-network cards, live
// auto-refresh, status/last-active, date + crawler-type filters, drill-down).
// The previous table-based implementation is preserved in git history.
import CrawlerDashboard from "./CrawlerDashboard";

const SystemInfo = () => <CrawlerDashboard />;

export default SystemInfo;
