import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import { CiFilter, CiSearch } from "react-icons/ci";
import { FiRefreshCw } from "react-icons/fi";
import { Tooltip } from "react-tooltip";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, Cell, PieChart, Pie, Legend,
} from "recharts";
import SimpleDateRangePicker from "../../components/SimpleDatepicker";
import {
  fetchDashboardOverview,
  fetchDashboardSystem,
  fetchDashboardAccounts,
  fetchDashboardAccountTimeline,
  fetchDashboardPlatforms,
  fetchSystemDebug,
  fetchGdnBenchmark,
  fetchYoutubeBenchmark,
  fetchStatusSystemInfo,
  fetchExporterHealth,
} from "../../store/actions/powerAdsPyActionsApi";
import TimeChart from "./ModalSystemStatusInfo";
import ModalAccountStatusInfo from "./ModalAccountStatusInfo";
import Facebook from "../../assets/Social/fb.png";
import Google from "../../assets/Social/Google.png";
import Instagram from "../../assets/Social/Instagram.png";
import Native from "../../assets/Social/Native.png";
import Gdn from "../../assets/Social/Google-ads.png";
import Youtube from "../../assets/Social/Youtube.png";
import Linkedin from "../../assets/Social/Linkedin.png";
import Quora from "../../assets/Social/Quora.png";
import Reddit from "../../assets/Social/Reddit.png";

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const NETWORK_ICONS = {
  facebook: Facebook,
  instagram: Instagram,
  gtext: Google,
  youtube: Youtube,
  native: Native,
  gdn: Gdn,
  linkedin: Linkedin,
  reddit: Reddit,
  quora: Quora,
};
const NETWORK_LABEL = {
  facebook: "Facebook",
  instagram: "Instagram",
  gtext: "Google",
  youtube: "YouTube",
  native: "Native",
  gdn: "GDN",
  linkedin: "LinkedIn",
  reddit: "Reddit",
  quora: "Quora",
};

const NETWORK_COLORS = {
  facebook: "#1877f2",
  instagram: "#e1306c",
  gtext: "#ea4335",
  youtube: "#ff0000",
  native: "#0ea5e9",
  gdn: "#34a853",
  linkedin: "#0a66c2",
  reddit: "#ff4500",
  quora: "#b92b27",
};
const CHART_PALETTE = ["#1f296a", "#264688", "#7c3aed", "#16a34a", "#0ea5e9", "#e1306c", "#ff7f0e", "#b92b27", "#0a66c2", "#34a853"];

const PLATFORM_OPTIONS = [
  { value: "10", label: "Scroll Plugin" },
  { value: "12", label: "Python Crawler" },
];

const REFRESH_OPTIONS = [
  { value: 0, label: "Off" },
  { value: 10000, label: "10s" },
  { value: 30000, label: "30s" },
  { value: 60000, label: "1m" },
];

const loadSelectedDates = () => {
  try {
    const saved = sessionStorage.getItem("dateRange");
    if (saved) {
      const p = JSON.parse(saved);
      return { startDate: new Date(p.startDate), endDate: new Date(p.endDate) };
    }
  } catch {
    /* ignore bad sessionStorage */
  }
  return { startDate: new Date(), endDate: new Date() };
};

const fmtDate = (d) => {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(
    dt.getDate()
  ).padStart(2, "0")}`;
};

const daysInclusive = (from, to) => {
  const a = new Date(from);
  const b = new Date(to);
  a.setHours(0, 0, 0, 0);
  b.setHours(0, 0, 0, 0);
  return Math.abs(b - a) / 86400000 + 1;
};

// "5m ago", "2h ago", "3d ago", "—"
const agoText = (sec) => {
  if (sec == null) return "—";
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
};

const nfmt = (n) =>
  n == null ? "—" : Number(n).toLocaleString("en-US");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "2026-06-18" -> "18 Jun 2026"
const niceDate = (s) => {
  if (!s) return "";
  const [y, m, d] = String(s).slice(0, 10).split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1] || m} ${y}`;
};
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
// Human window label: "Today (18 Jun 2026)" | "18 Jun 2026" | "16 Jun → 18 Jun 2026"
const windowLabel = (win) => {
  if (!win?.from) return "";
  if (win.from === win.to) {
    return win.from === todayStr() ? `Today (${niceDate(win.from)})` : niceDate(win.from);
  }
  return `${niceDate(win.from)} → ${niceDate(win.to)}`;
};

/* ------------------------------------------------------------------ */
/* data-source legend + "where does this come from?" info             */
/* ------------------------------------------------------------------ */

// Every field is tagged: db (MySQL activities/users), prom (Prometheus live
// telemetry), or both (bridged / combined).
const SOURCE = {
  db:   { letter: "D", label: "Database (MySQL)", color: "#2563eb", bg: "#eff4ff" },
  prom: { letter: "P", label: "Prometheus (live)", color: "#7c3aed", bg: "#f5f0ff" },
  both: { letter: "B", label: "DB + Prometheus", color: "#16a34a", bg: "#ecfdf3" },
};

const SourceDot = ({ s, withLabel }) => {
  const m = SOURCE[s];
  if (!m) return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-1.5 text-[10px] font-bold leading-[16px]"
      style={{ color: m.color, background: m.bg }}
      data-tooltip-id="dash-tip"
      data-tooltip-content={`Source: ${m.label}`}
    >
      {m.letter}
      {withLabel ? <span className="font-medium">{m.label}</span> : null}
    </span>
  );
};

// The single source of truth for "kaunsa data kaha se" — searchable in the Info
// modal. Keywords help search (e.g. "youtube", "total systems", "gdn", "match").
const FIELD_SOURCES = [
  { f: "Total Systems", s: "both", k: "fleet count 111 crawler insight match",
    how: "The FULL account-machine fleet = every system with monitored accounts (Prometheus scroll_plugin_counter_total, bridged to system_id) PLUS systems that scraped this window (DB). Matches Crawler Insight 'System Analytics' total. Idle machines show as Idle." },
  { f: "Active Now / Inactive", s: "both", k: "active idle status",
    how: "Active = a heartbeat is beating, OR it is scraping right now, OR it had DB activity in the last 10 min. Everything else is Idle." },
  { f: "Accounts (total)", s: "both", k: "accounts 802 monitored",
    how: "Distinct monitored accounts across the fleet (Prometheus accounts ∪ window activity accounts)." },
  { f: "System name (PAS####/GLB###)", s: "db", k: "system id name",
    how: "<net>_accounts_activities.system_id (fb/insta/etc), gdn_crawl_quality.host (gdn/native proxmox), youtube_ad.system_id (youtube)." },
  { f: "Machine hostname (GBSBHL####-PC)", s: "prom", k: "host server name",
    how: "scroll_plugin_counter_total.server_name — bridged to the system via shared account_id." },
  { f: "Country / Account name / Account ID", s: "db", k: "country name id user",
    how: "<net>_users (name/country) keyed by account_id; account_id from the activities table." },
  { f: "Total Ads (header + network card)", s: "db", k: "total ads count match crawler insight get-count",
    how: "COUNT(id) FROM <net>_ad WHERE last_seen in window — the SAME query as Crawler Insight /get-count (metric=range). This is the number that matches Crawler Insight." },
  { f: "Unique Ads (header + network card)", s: "db", k: "unique new ads first seen",
    how: "COUNT(id) FROM <net>_ad WHERE first_seen in window (youtube: created_date). New ads. With a platform filter: count on the platform table by created date + platform IN(...)." },
  { f: "Per-system Ads — facebook / instagram / gtext", s: "db", k: "per system ads activity events why not match",
    how: "COUNT in <net>_accounts_activities for that system in the window (activity events). This is per-system ACTIVITY, NOT the dedup'd ad table — so per-system will NOT add up to the network's Total Ads." },
  { f: "Per-system Ads — YouTube", s: "db", k: "youtube per system last seen created date match",
    how: "COUNT youtube_ad by system_id: ads = last_seen in window (= network total method), unique = created_date in window. So youtube per-system DOES sum to the card (minus ads whose system_id is blank)." },
  { f: "GDN / Native proxmox machine — URLs / Ads (crawl)", s: "db", k: "gdn native crawl quality host proxmox decodo isp why not match millions urls",
    how: "Systems = proxmox machines (gdn_crawl_quality.host). URLs = COUNT of URLs that machine crawled in the window. Ads (crawl) = SUM(last_gdn_ads/last_native_ads) — ads found on the last crawl (with duplicates across URLs). The gdn/native ad tables DO have a system_id, but it is the PROXY (decodo-isp), NOT the machine — so the dedup'd network total cannot be split per machine, and Unique is N/A per machine. The network card total (decodo-isp's deduped count) is correct. (Earlier per-machine summed total_*_ads = a lifetime counter → 500k+ nonsense — fixed.)" },
  { f: "Why per-system ≠ network card total", s: "both", k: "mismatch reconcile add up difference",
    how: "Network card = the dedup'd ad table (Crawler Insight /get-count). Per-system = activity/crawl per machine. They measure different things; only youtube can be attributed per machine. So sums differ by design — except youtube." },
  { f: "Last active / “X ago”", s: "db", k: "last active time",
    how: "MAX(created_at) in the activities table (gdn/native/youtube: MAX(last_crawled)/MAX(last_seen))." },
  { f: "Live now (heartbeat)", s: "prom", k: "live heartbeat",
    how: "increase(account_active_hb_total[120s]) > 0" },
  { f: "Scraping now (▶ /min)", s: "prom", k: "scraping rate now",
    how: "rate(scroll_plugin_counter_total[2m]) × 60 (per host / per account)" },
  { f: "CPU % / RAM %", s: "prom", k: "cpu ram", how: "cpu_utilization / ram_utilization (per host)" },
  { f: "GDN/Native/YouTube live feed (URLs/ads now)", s: "db", k: "live feed url processing benchmark",
    how: "gdn/native: gdn_crawl_quality recent rows (host-filtered). youtube: the crawler's /api/youtube-live feed + youtube_ad recent rows per system." },
  { f: "Status timeline (system/account)", s: "prom", k: "timeline history",
    how: "account_active_hb_total / system heartbeat over the window." },
];

/* ------------------------------------------------------------------ */
/* Q&A knowledge base — ask in plain English, get a deterministic       */
/* explanation (NO AI). Matched by keyword scoring against q + tags + a.*/
/* ------------------------------------------------------------------ */
const HELP_QA = [
  {
    q: "Why don't the per-system ads add up to the network card total?",
    tags: "match reconcile add up sum mismatch wrong different total per system card not equal difference",
    a: "The network card 'Total Ads' is the DEDUPED ad table (the exact same COUNT Crawler Insight's /get-count uses). The number on each system card is per-machine ACTIVITY/CRAWL — a different thing. Only YouTube can be attributed per machine (its ad rows carry a real system_id), so only YouTube per-system sums to the card. For Facebook/Instagram the per-system number is activity events; for GDN/Native it's crawl-found ads. By design they will not add up — except YouTube.",
  },
  {
    q: "Why is Unique '—' (blank) on GDN and Native system cards?",
    tags: "unique blank empty dash zero missing native gdn proxmox why not shown per system",
    a: "GDN/Native ads in the ad table are tagged with the PROXY (system_id = 'decodo-isp'), not the physical proxmox machine. So a deduped 'unique/new' count cannot be split per machine — it only exists at the network level. That network-level unique IS shown correctly on the network card; per-machine it is genuinely not computable, so we show '—' instead of a fake 0.",
  },
  {
    q: "What is decodo-isp? Why is it not shown as a system?",
    tags: "decodo isp decodo-isp proxy provider what is system gdn native localproxies",
    a: "decodo-isp (and localproxies) is a PROXY / ISP — the network route the crawler uses, not a machine. The GDN/Native ad rows are all tagged with it, but the real crawling machines are the proxmox boxes (proxmox03, proxmox12, …). We show the proxmox machines as the systems; the ISP-level deduped totals appear on the network card and inside the 📊 benchmark.",
  },
  {
    q: "What does 'Ads (crawl)' mean on a GDN/Native machine?",
    tags: "ads crawl found gdn native proxmox last what meaning duplicates",
    a: "It is the number of ads that machine found across its crawls in the window (SUM of last_gdn_ads / last_native_ads from gdn_crawl_quality). It counts the same ad once per URL it appears on, so it has duplicates — it is throughput, NOT the deduped network total. Use it to compare machine activity, not to match the card.",
  },
  {
    q: "What does 'URLs' mean on a GDN/Native machine card?",
    tags: "urls gdn native proxmox count what crawl quality",
    a: "URLs = how many target URLs that proxmox machine crawled in the window (COUNT of rows in gdn_crawl_quality for that host). It is a clean, verifiable per-machine metric — the most reliable number for comparing GDN/Native machines.",
  },
  {
    q: "Why is Total Systems different from the old Crawler Insight number?",
    tags: "total systems 111 89 17 count match crawler insight fleet different why",
    a: "Total Systems now equals the FULL fleet — every machine with monitored accounts (from Prometheus) PLUS every machine that scraped in the window (from the DB). This is the same set Crawler Insight's 'System Analytics' total counts, so the two now agree. Earlier it only counted machines active today, which was much lower.",
  },
  {
    q: "Why are there idle systems with 0 ads and 0 accounts shown?",
    tags: "idle 0 zero ads accounts empty system why shown inactive fleet",
    a: "Those are fleet machines that have monitored accounts but produced no ads in the selected window — they are real machines, just idle today. (A machine with NO real account at all is filtered out as a phantom and not shown.) Switch the date range to a day they were active to see their numbers.",
  },
  {
    q: "Why does Reddit / LinkedIn show '0 sys · N ads', and why is the grid empty when I click it?",
    tags: "reddit linkedin quora 0 sys ads no system but has ads zero why click shows nothing empty grid blank nothing happens",
    a: "Those N ads are REAL — they are in the network's ad table (deduped, last_seen today) and counted in the header total. But no machine reported activity/heartbeat for that network today, so there are 0 ACTIVE systems. Clicking the card filters the systems grid to that network — and since there are 0 systems, the grid shows 'No systems for the selected window'. The ads exist; there is just no active machine to attribute them to right now. Widen the date range to a day a machine was active to see it.",
  },
  {
    q: "I clicked a network / card and the grid is empty — nothing shows. Why?",
    tags: "click clicked nothing empty blank no systems grid shows nothing happens reddit network card filter zero result",
    a: "Clicking a network card filters the systems grid to that network. If that network has 0 active systems in the current window (common for Reddit/LinkedIn/Quora — they had ads but no machine reported activity today), the grid is empty and shows 'No systems for the selected window'. The ads still count in the header. Fix: clear the network filter (click 'All networks'), or widen the date range to a day a machine was active.",
  },
  {
    q: "What is the difference between Total Ads and Unique Ads?",
    tags: "total unique ads difference last seen first seen new what meaning",
    a: "Total Ads = ads whose last_seen falls in the window (everything observed, including re-seen ads). Unique Ads = ads whose first_seen falls in the window (brand-new ads only). Same definition as Crawler Insight /get-count.",
  },
  {
    q: "How is the 'Active / Idle' badge decided?",
    tags: "active idle status badge how decided green grey last active",
    a: "A system is Active if ANY of these is true: a heartbeat is currently beating, it is scraping right now (live rate > 0), or it had DB activity within the last 10 minutes. Otherwise it is Idle. So a system can read 'Active' even if 'Last active' shows a while ago — because a live heartbeat or current scraping also counts.",
  },
  {
    q: "How is 'Scraping Now' calculated?",
    tags: "scraping now rate per min live how calculated speed",
    a: "rate(scroll_plugin_counter_total[2m]) × 60 — the live events-per-minute from Prometheus over the last 2 minutes, summed per host (and fleet-wide for the headline tile).",
  },
  {
    q: "How do I know the numbers match Crawler Insight?",
    tags: "match crawler insight verify trust accurate same get-count proof",
    a: "The network-card Total/Unique Ads run the EXACT same query as Crawler Insight's /network-name/get-count (Total = last_seen in window, Unique = first_seen in window, per <net>_ad table). The Total Systems count uses the same fleet definition as Crawler Insight's System Analytics. Open any system's 'debug' to trace each value, or run diagnostics/system-info-report.js for a side-by-side dump.",
  },
  {
    q: "What is system_id vs hostname?",
    tags: "system id hostname server name pas glb difference machine bridge",
    a: "system_id is the logical name the crawler stores in the DB (e.g. PAS1012, or a proxmox host for GDN/Native). hostname is the machine name Prometheus reports (e.g. GBSBHL1012-PC). They are joined through the shared account_id so CPU/RAM/heartbeat land on the right system.",
  },
  {
    q: "Why is CPU / RAM blank for some systems?",
    tags: "cpu ram blank empty missing not shown system",
    a: "CPU/RAM come from Prometheus, keyed by hostname. If a system has no Prometheus hostname bridge (e.g. a proxmox crawl machine, or an account whose id never appeared in the live counter), there is no host to read CPU/RAM from — so it stays blank. The DB numbers still show.",
  },
  {
    q: "What does the 📊 benchmark button show?",
    tags: "benchmark button chart 📊 gdn native youtube what shows",
    a: "GDN/Native 📊 = the full ISP/proxy crawl benchmark (all machines, providers, countries, sites, proxy quality) read directly from the DB. YouTube 📊 = the live monitoring benchmark from ElasticSearch + the crawler's own live feed (status, 1h/3h/24h, recent ads being processed).",
  },
  {
    q: "Why do YouTube systems show now (proxmox25, Proxmox-17)?",
    tags: "youtube systems proxmox25 proxmox-17 where come from system_id last seen",
    a: "YouTube systems come from youtube_ad.system_id (the proxmox machines). Per-system ads use last_seen (matches the card total method) and unique uses created_date — so YouTube per-system DOES add up to the card (minus a few ads whose system_id is blank).",
  },
  {
    q: "What is the date window / why is today empty sometimes?",
    tags: "date window today empty timezone utc range no data",
    a: "Everything is counted for the selected date range (default = today). Data is timestamped in UTC; if your local 'today' is ahead of the server's UTC day the window is snapped to the current UTC day so live data shows. If a network looks empty today, widen the range — its crawlers may have been idle.",
  },
  {
    q: "Why does the Accounts total differ from before?",
    tags: "accounts total 802 count differ monitored fleet number",
    a: "Accounts now counts the monitored accounts across the whole fleet (Prometheus ∪ DB), matching Crawler Insight. Earlier it only counted accounts that were active in the window, which was smaller.",
  },
  {
    q: "What is the live feed inside a system / benchmark?",
    tags: "live feed url processing now what crawling youtube gdn recent",
    a: "It shows what a machine is processing right now. GDN/Native: the most-recent crawled URLs (site, country, ads found, status) for that host. YouTube: the crawler's real-time ad feed (advertiser, type, placement, hops) from /api/youtube-live, plus that system's latest inserted ads.",
  },
  {
    q: "Clicking a system does different things — why?",
    tags: "click system card drill benchmark different gdn native youtube facebook open",
    a: "Facebook/Instagram/YouTube system → per-account drill (accounts + status + live feed). GDN/Native (proxmox) system → that machine's crawl benchmark (host-scoped). The network card body → filters the grid; the 📊 chip → the network-wide benchmark.",
  },
  {
    q: "What is this System Info dashboard?",
    tags: "what is system info dashboard crawler fleet overview purpose about",
    a: "It is a live view of the whole crawler fleet: how many machines (systems) exist and which are active, how many accounts they run, how many ads each network produced today, and what is being scraped right now. Numbers match Crawler Insight; click any system for a per-machine breakdown.",
  },
  {
    q: "What does the 'Active Now' tile mean?",
    tags: "active now tile kpi count green systems live 10 min",
    a: "How many systems are active right now — beating a heartbeat, scraping this minute, or had DB activity in the last 10 minutes. Click it to filter the grid to only active systems.",
  },
  {
    q: "What does the 'Inactive' tile mean?",
    tags: "inactive idle tile kpi count grey systems offline",
    a: "Systems that are NOT active right now (no heartbeat, not scraping, no activity in the last 10 min) — Total Systems minus Active Now. Click it to see only idle systems.",
  },
  {
    q: "What does the 'Accounts' tile do?",
    tags: "accounts tile kpi click open which account on which system list",
    a: "It is the total monitored accounts across the fleet. Click it to open the All-Accounts view — every account, which system/machine it runs on, its network, country, live status and ads — searchable and filterable.",
  },
  {
    q: "What does the 'Networks' tile mean?",
    tags: "networks tile kpi count active how many",
    a: "How many networks have at least one active system in the window (facebook, instagram, google, youtube, gdn, native, etc.).",
  },
  {
    q: "What is the 'debug' button on a system card?",
    tags: "debug button trace lineage how value obtained query system card",
    a: "It runs a live data-lineage trace for that system: step by step it shows where the name came from, how the hostname was resolved, and the exact queries used — so you can verify every value. Raw queries are hidden until you toggle them.",
  },
  {
    q: "What is the platform filter (10 / 12)?",
    tags: "platform filter 10 12 scroll plugin python crawler funnel type",
    a: "It narrows everything to a crawler type: platform 10 = Scroll Plugin, 12 = Python Crawler (more may appear, discovered from the data). With a platform selected, the ad counts switch to counting the platform table by created-date.",
  },
  {
    q: "What does the refresh interval do?",
    tags: "refresh interval auto update live reload 30s 60s polling",
    a: "It auto-refreshes the dashboard on the chosen interval (or Off). 'Live' with the green dot means it is polling; each refresh re-reads totals, per-system status and live scrape rate.",
  },
  {
    q: "What is 'Metrics source up / down'?",
    tags: "metrics source up down send-metrics exporter health prometheus raw",
    a: "A health check of the raw metrics exporter (send-metrics). Green/up = the freshest Prometheus exposition is reachable; red/down = it could not be fetched (the dashboard still works from cached Prometheus + DB).",
  },
  {
    q: "What is a network card and what happens when I click it?",
    tags: "network card click filter facebook instagram gdn native youtube grid",
    a: "Each network card shows that network's live systems + deduped Total/Unique Ads. Clicking the card filters the systems grid to that network. The 📊 chip opens that network's benchmark; the card body just filters.",
  },
  {
    q: "How do I see which account runs on which system?",
    tags: "which account on which system map find account machine accounts view",
    a: "Click the 'Accounts' tile (or any account row in a system drill). The All-Accounts view lists every account with its system_id, network, country, live status and ads — filter by system, network or country, or search by name/id.",
  },
  {
    q: "What is the status timeline?",
    tags: "status timeline system active inactive history chart over time heartbeat",
    a: "An Active/Inactive bar over the selected window for a system (from its heartbeat). Open it from a system drill via 'Status timeline'. For an account, click an account row — it draws the account's own heartbeat timeline.",
  },
  {
    q: "Why is the account status timeline empty?",
    tags: "account timeline empty blank no data why heartbeat missing",
    a: "It is empty when Prometheus has no account_active_hb_total series for that account_id in the window — the account may report under a different id, came online only minutes ago, or was active outside the date range. The panel tells you the exact reason.",
  },
  {
    q: "What is inside the GDN / Native benchmark?",
    tags: "gdn native benchmark contents providers machines proxy quality zero ad urls sites countries advertisers creatives",
    a: "Direct-DB crawl analytics: total GDN/Native creatives, URLs crawled, providers (ISPs), machines (proxmox hosts), top countries/sites/advertisers, proxy quality per country, 0-ad URLs, and a live feed of URLs being crawled now. Click a proxmox system for a host-scoped view, or the 📊 chip for the whole ISP.",
  },
  {
    q: "What do Findable %, Redirect chain % and Multi-hop mean (YouTube)?",
    tags: "youtube findable redirect chain multi hop percent meaning benchmark",
    a: "Findable % = share of YouTube ads whose creative is retrievable (thumbnail / NAS image present). Redirect chain % = ads that carry a redirect URL. Multi-hop = ads whose click goes through more than one redirect before the destination.",
  },
  {
    q: "What does 'X /min now' mean on a system card?",
    tags: "per min now rate scraping speed events green card meaning",
    a: "Live scrape speed — events per minute that machine is producing right now (rate of scroll_plugin_counter_total over the last 2 minutes × 60). It only shows when the machine is actively scraping.",
  },
  {
    q: "Why do some systems have a hostname and others don't?",
    tags: "hostname missing some systems gbsbhl pc bridge why blank",
    a: "The hostname comes from Prometheus and is matched to the system through a shared account_id. If none of a system's account_ids appear in the live counter (e.g. proxmox crawl machines, or idle accounts), there is no hostname to show.",
  },
  {
    q: "How is Unique computed for Facebook / Instagram?",
    tags: "facebook instagram unique is_unique how computed first seen new",
    a: "On the network card, Unique = ads whose first_seen is in the window (new ads), same as Crawler Insight. The per-account 'unique' inside a drill comes from is_unique flags in the activities table — that is per-account activity, not the deduped ad table.",
  },
  {
    q: "What exactly is the 'get-count' method?",
    tags: "get count method how total unique computed query last seen first seen window",
    a: "The query Crawler Insight uses for ad counts: from each <net>_ad table, Total = COUNT(id) WHERE last_seen in the window, Unique = COUNT(id) WHERE first_seen in the window. The dashboard's network-card numbers run the exact same query, so they match.",
  },
  {
    q: "Why are GDN/Native shown as proxmox machines and not the ISP?",
    tags: "gdn native proxmox machine vs isp decodo why systems shown host",
    a: "Because the physical crawlers are the proxmox boxes — that is what you manage. decodo-isp is just the proxy they route through. So the grid shows proxmox machines (with URLs / crawl-found ads); the ISP-level deduped totals live on the network card and in the 📊 benchmark.",
  },
  {
    q: "What is a phantom system?",
    tags: "phantom system noise empty hidden 0 account bare hostname filtered",
    a: "A Prometheus series with no real account_id (just a bare hostname) — it would add an empty 0-account, 0-ad, Idle card. Those are filtered out so the grid only shows machines with a real monitored account.",
  },
  {
    q: "How do I search or sort the systems grid?",
    tags: "search sort grid systems filter by ads unique accounts last active host",
    a: "Use the search box (matches system id or hostname), the All/Active/Inactive toggle, and the Sort menu (last active, total ads, unique ads, accounts). Network cards and KPI tiles also apply quick filters.",
  },
  {
    q: "What does gtext / Google mean here?",
    tags: "gtext google text ad network what is search",
    a: "gtext is the Google text-ads network (google_text_ad table). It is shown as 'Google' on the cards.",
  },
  {
    q: "What is 'creatives' in the GDN benchmark?",
    tags: "creatives gdn native benchmark meaning total ads count",
    a: "Creatives = the total rows in the GDN/Native ad table (gdn_ad / native_ad) — the all-time deduped ad catalogue for that network, separate from the windowed Total Ads on the card.",
  },
  {
    q: "How fresh is the data / is it cached?",
    tags: "fresh cache caching how often updated stale delay realtime",
    a: "The overview is cached briefly (about 60s) and refreshed on your chosen interval; live scrape rate and heartbeats are near-real-time from Prometheus; ad counts are read live from the DB. Benchmarks cache for a few seconds.",
  },
  {
    q: "What do the small D / P / B letters (source dots) mean?",
    tags: "d p b letter source dot legend color blue purple green database prometheus both",
    a: "Every value is tagged with where it comes from: D = Database (MySQL), P = Prometheus (live telemetry), B = Both (bridged). Hover a dot to see the source.",
  },
  {
    q: "What does the green pulsing dot / 'Live' next to the title mean?",
    tags: "green dot pulse live paused title header updated ago indicator",
    a: "It shows auto-refresh is on ('Live') and pulses each cycle; 'updated Xs ago' is how long since the last successful refresh. If refresh is Off it reads 'Paused' with a grey dot.",
  },
  {
    q: "What does 'Last active: —' mean on a card?",
    tags: "last active dash empty unknown idle no activity time card",
    a: "No activity timestamp for that system in the window — typically a fleet machine that is monitored (has accounts) but produced nothing today. It can still read 'Active' if a heartbeat is beating right now.",
  },
  {
    q: "Are the Total Ads / Unique Ads tiles clickable?",
    tags: "total ads unique ads tile click clickable kpi header not",
    a: "No — the Total Ads and Unique Ads tiles are display-only headline numbers (the deduped network totals). The Total Systems, Active, Inactive and Accounts tiles are clickable filters.",
  },
  {
    q: "What is the 'Scraping Now' tile?",
    tags: "scraping now tile fleet rate per min headline live speed kpi",
    a: "The fleet-wide live scrape rate — events per minute across every host right now (sum of per-host rate of scroll_plugin_counter_total × 60). It is a live indicator, not clickable.",
  },
  {
    q: "What is the 'Crawler Fleet' title / what am I looking at?",
    tags: "crawler fleet title header top what looking at name",
    a: "It is the name of this System Info view — the fleet of crawler machines. Below the title you see the live indicator, the date window, and the data-source legend.",
  },
  {
    q: "Why is Total Ads huge but each system shows a small number?",
    tags: "total ads huge big per system small different scale why header",
    a: "Total Ads is the deduped ad-table count for the whole network. A system card shows only that machine's activity/crawl, which is a different, smaller metric. Only YouTube per-system sums to its network total.",
  },
  {
    q: "What does 'System-level networks (no per-account split)' mean in a drill?",
    tags: "system level networks no per account split drill youtube gdn native section",
    a: "Some networks (gdn, native, youtube, gtext) have no per-account identity on a machine, so inside a system drill they are shown as one combined per-network line instead of an accounts table.",
  },
  {
    q: "What is the proxy quality table in the GDN benchmark?",
    tags: "proxy quality ips used ads urls country benchmark gdn health",
    a: "Per-country proxy health: how many proxy IPs exist, how many were used, and the ads/URLs they produced — to spot weak proxy countries.",
  },
  {
    q: "What are 0-ad URLs in the GDN benchmark?",
    tags: "zero ad urls 0 empty crawl no ads streak benchmark gdn waste",
    a: "URLs that were crawled but returned no ads (status 'zero' or last_total_ads = 0), with how many times in a row (streak). High streaks flag wasted crawls.",
  },
  {
    q: "What is the 'hit' / 'os' column in the machines table?",
    tags: "hit os column machines benchmark gdn meaning host operating system",
    a: "os = the machine's operating system. hit = how many of its crawled URLs actually returned ads (last_total_ads > 0). URLs = how many it crawled.",
  },
  {
    q: "What does the YouTube live feed / crawler endpoint show?",
    tags: "youtube live feed crawler endpoint api running status recent ads processing",
    a: "The YouTube benchmark pulls the crawler's own live endpoint for the true 'running' status and a real-time feed of ads being processed (advertiser, type, placement, redirect hops). ElasticSearch is the fallback if that endpoint is unreachable.",
  },
  {
    q: "What is unique vs duplicate on YouTube?",
    tags: "youtube unique duplicate dup new 1h 24h meaning benchmark",
    a: "new = ads whose first_seen is in the window (brand new); dup = ads seen again that are not new (total seen minus new). Shown for 1h and 24h.",
  },
  {
    q: "Do these numbers change between refreshes? Is that normal?",
    tags: "numbers change refresh different every time normal vary fluctuate",
    a: "Yes — it is a live dashboard. Heartbeats, scrape rate and 'now' counts update constantly, and ad counts climb as the crawlers run, so small changes each refresh are expected.",
  },
  {
    q: "What networks are tracked here?",
    tags: "networks list all which tracked facebook instagram google youtube gdn native linkedin reddit quora",
    a: "Facebook, Instagram, Google (gtext), YouTube, GDN, Native, LinkedIn, Reddit and Quora — each with its own systems, accounts and ad counts.",
  },

  /* ----- data sources / tables / metrics ----- */
  {
    q: "What is the <net>_accounts_activities table?",
    tags: "activities table accounts_activities database what is source per system events",
    a: "The per-account/per-system activity log each crawler writes to (e.g. facebook_accounts_activities). Each row is an ad-capture event with system_id, account_id, created_at, is_unique and platform. The per-system Accounts/Ads on facebook/instagram/gtext cards come from here.",
  },
  {
    q: "What is the <net>_ad table?",
    tags: "ad table net_ad facebook_ad gdn_ad native_ad youtube_ad deduped catalogue what is",
    a: "The deduped ad catalogue for a network (facebook_ad, gdn_ad, native_ad, youtube_ad, …). One row per unique ad with first_seen / last_seen. The network-card Total/Unique Ads count this table — the same source as Crawler Insight.",
  },
  {
    q: "What is gdn_crawl_quality?",
    tags: "gdn_crawl_quality crawl quality table host provider url proxmox what is gdn native",
    a: "The per-URL crawl log for GDN/Native (in gdnpro_v2). It records host (proxmox machine), provider (ISP), country, os, last_crawled, and how many ads the last crawl found (last_gdn_ads / last_native_ads). The proxmox systems, URLs and 'Ads (crawl)' come from here.",
  },
  {
    q: "What is scroll_plugin_counter_total?",
    tags: "scroll_plugin_counter_total prometheus metric counter what is accounts server_name network",
    a: "The Prometheus counter the crawler plugin increments per scraped event. Its labels (account_id, server_name, network, country) drive the fleet list, the hostname bridge and the live scrape rate.",
  },
  {
    q: "What is account_active_hb_total?",
    tags: "account_active_hb_total heartbeat prometheus metric live what is account",
    a: "The Prometheus heartbeat counter for each account. If it increased in the last ~2 minutes the account is 'Live'; over a window it draws the account status timeline.",
  },
  {
    q: "What are last_seen, first_seen, created_date, created_at, last_crawled?",
    tags: "last_seen first_seen created_date created_at last_crawled timestamp columns difference meaning",
    a: "first_seen = when an ad was first discovered (drives Unique). last_seen = when it was last observed (drives Total). created_date / created_at = the DB insert time (used for platform counts and activity rows). last_crawled = when a GDN/Native URL was last crawled.",
  },
  {
    q: "What is the is_unique column?",
    tags: "is_unique column unique flag activities new ad meaning",
    a: "A flag on each activity row marking whether that capture was a brand-new ad for that account. The per-account 'unique' inside a drill sums is_unique — it is per-account activity, not the deduped ad-table unique.",
  },
  {
    q: "What is the account_id bridge?",
    tags: "account_id bridge link join system hostname prometheus db how mapped",
    a: "system_id (DB) and server_name (Prometheus) never match directly, so they are joined through account_id — the one key both sides carry. That bridge lets CPU/RAM/heartbeat (keyed by hostname) land on the right DB system.",
  },
  {
    q: "What does 'the window' mean?",
    tags: "window date range time period selected day meaning",
    a: "The selected date range (default = today). Every count — ads, unique, activity, crawls — is measured inside this window. Change it with the date picker.",
  },
  {
    q: "What does 'deduped' mean?",
    tags: "deduped dedup unique duplicate distinct meaning ad table",
    a: "Counted once per distinct ad. The <net>_ad table is deduped (one row per ad), so network-card totals never double-count. Per-machine crawl counts are NOT deduped (an ad seen on 5 URLs counts 5 times).",
  },
  {
    q: "What does 'scraped' / crawler / scraper mean?",
    tags: "scraped crawler scraper scrape meaning what is crawl",
    a: "The crawler (a.k.a. scraper) is the program running on a machine that visits pages and captures ads. 'Scraped' = ads it captured. A 'system' here is one such crawler machine.",
  },
  {
    q: "What is a monitored account?",
    tags: "monitored account what is fleet prometheus tracked",
    a: "An account the crawler runs and reports to Prometheus (it appears in scroll_plugin_counter_total). The fleet / Accounts total is the set of monitored accounts, even if they produced no ads today.",
  },

  /* ----- per-network identity ----- */
  {
    q: "Which networks have real accounts and which don't?",
    tags: "which networks accounts hasaccount facebook instagram linkedin reddit quora gdn native youtube gtext per account",
    a: "Account-based (per-account rows): Facebook, Instagram, LinkedIn, Reddit, Quora. System/crawl-based (no per-account identity on a machine): GDN, Native, YouTube, Google text (gtext).",
  },
  {
    q: "What is the Facebook / Instagram network here?",
    tags: "facebook instagram network what is meta accounts systems",
    a: "Account-based networks: real crawler accounts run on PAS####/GLB### machines. Per-system you see accounts + activity; the card Total/Unique come from facebook_ad / instagram_ad.",
  },
  {
    q: "What is GDN?",
    tags: "gdn what is google display network ads meaning",
    a: "GDN = Google Display Network (banner/display ads). Crawled by the proxmox machines via gdn_crawl_quality; deduped ads in gdn_ad.",
  },
  {
    q: "What is the Native network?",
    tags: "native what is network ads meaning content recommendation",
    a: "Native = native/content-recommendation ads (Taboola/Outbrain-style). It shares the same proxmox crawl machines and gdn_crawl_quality table as GDN; deduped ads in native_ad.",
  },

  /* ----- UI granular ----- */
  {
    q: "What does 'X live' on a network card mean?",
    tags: "live network card green count active systems how many",
    a: "How many of that network's systems are active right now (the green-dot count). The line below shows total systems, total ads and unique ads for the network.",
  },
  {
    q: "What is the 'All networks' card?",
    tags: "all networks card first reset filter clear",
    a: "The first card in the network row. Clicking it clears the network filter and shows every system again.",
  },
  {
    q: "What do the network icons on a system card mean?",
    tags: "network icons logos system card row which networks badges",
    a: "The small round logos on a system card show which networks that machine runs (e.g. a proxmox shows GDN + Native). Hover for the name.",
  },
  {
    q: "What does the '(N · Network)' next to 'Systems' mean?",
    tags: "systems count bracket number network heading visible filtered",
    a: "How many systems are currently visible (after filters), and which network filter is applied. With no filter it is just the count.",
  },
  {
    q: "What do the blue and purple numbers on a card mean?",
    tags: "blue purple number color ads unique meaning card",
    a: "Blue (#264688) = counts like Accounts/URLs/Ads. Purple (#7c3aed) = Unique ads. It is only colour-coding to separate metrics.",
  },
  {
    q: "What does the ▶ symbol mean?",
    tags: "play arrow triangle symbol scraping now rate meaning",
    a: "It marks the live 'scraping now' rate — that machine/account is actively producing events this minute (▶ N/min now).",
  },
  {
    q: "What is the manual refresh button?",
    tags: "refresh button manual reload spin now icon",
    a: "The circular-arrow button re-fetches everything immediately (it spins while loading), regardless of the auto-refresh interval.",
  },

  /* ----- drill / accounts modal ----- */
  {
    q: "What is the system drill (the popup when I click a system)?",
    tags: "drill popup system click accounts breakdown modal what shows",
    a: "A per-system breakdown: its accounts (name, network, country, live status, ads, unique, last active), system-level networks, totals, a status-timeline button, and (for youtube) a live feed of recent ads.",
  },
  {
    q: "What do the 5 totals at the top of a drill mean?",
    tags: "drill totals accounts live now total ads unique networks header numbers",
    a: "Accounts = how many accounts on this system; Live now = how many are beating a heartbeat right now; Total Ads / Unique Ads = this system's activity sums; Networks = how many networks it runs.",
  },
  {
    q: "What does clicking an account row do?",
    tags: "click account row drill timeline status open account",
    a: "It opens that account's status timeline — an Active/Inactive bar over the window from its heartbeat. If empty, the panel explains exactly why.",
  },
  {
    q: "What is the All-Accounts view and its charts?",
    tags: "all accounts modal charts graphical top systems accounts by network grafana view",
    a: "Opened from the Accounts tile: every account with its system, network, country, live status and ads. The charts show top systems, top accounts and a by-network donut — using live scrape rate if anything is scraping, else ads in the window.",
  },

  /* ----- GDN benchmark fields ----- */
  {
    q: "What are 'GDN creatives' / 'Native creatives' in the benchmark?",
    tags: "gdn native creatives benchmark total tile meaning count",
    a: "The all-time total rows in gdn_ad / native_ad — the full deduped ad catalogue for that network (not windowed).",
  },
  {
    q: "What is 'Live session' / Mode / Done / pool in the GDN benchmark?",
    tags: "live session mode done pool benchmark gdn meaning machines",
    a: "Live session describes the current crawl run (last 3h): Mode = how many machines are crawling; Done = URLs finished; pool = the URL pool size for the countries in play.",
  },
  {
    q: "What is Throughput / split / Observed in the GDN benchmark?",
    tags: "throughput split observed gdn native benchmark hr day new meaning",
    a: "Throughput = new GDN/Native ads per hour and per day from the activities table. Observed = ads the crawl actually saw (sum of crawl counts) for GDN vs Native.",
  },
  {
    q: "What is the Providers table in the GDN benchmark?",
    tags: "providers table benchmark gdn isp proxy urls countries zero meaning",
    a: "Per ISP/proxy provider: URLs crawled, distinct countries, GDN/Native ads found, and how many URLs returned zero ads.",
  },

  /* ----- youtube benchmark fields ----- */
  {
    q: "What is 'Total ads (ES)' in the YouTube benchmark?",
    tags: "total ads es elasticsearch youtube benchmark tile meaning",
    a: "The total YouTube ad documents in the ElasticSearch index (youtube_ads_data) — the all-time deduped catalogue, read directly from ES.",
  },
  {
    q: "What does 'hops' mean in the YouTube feed?",
    tags: "hops youtube redirect chain feed meaning multi hop number",
    a: "How many redirects a YouTube ad's click passes through before the final destination. More than one hop = multi-hop.",
  },
  {
    q: "What does 'live source: crawler vs ElasticSearch' mean (YouTube)?",
    tags: "live source crawler elasticsearch youtube benchmark fallback meaning",
    a: "The YouTube live panel prefers the crawler's own live endpoint (true running status + real-time feed). If that is unreachable it falls back to ElasticSearch — the label tells you which is in use.",
  },

  /* ----- status / debug ----- */
  {
    q: "What do the green and red bars in the status timeline mean?",
    tags: "status timeline green red bars active inactive color duration meaning",
    a: "Green = the system/account was Active in that interval, red = Inactive. The totals below sum the Active and Inactive durations over the window.",
  },
  {
    q: "What does '+Xms' mean in the debug trace?",
    tags: "debug trace ms milliseconds step timing meaning plus",
    a: "How long after the trace started that step completed — a simple timing so you can see which lookup took longest.",
  },

  /* ----- troubleshooting / edge cases ----- */
  {
    q: "Why is everything 0 / empty today?",
    tags: "everything zero empty today nothing no data why all 0 blank",
    a: "Usually the crawlers were idle in the selected window, or your local 'today' is ahead of the server's UTC day. Widen the date range or pick yesterday — if data appears, it was just an idle/timezone gap, not a bug.",
  },
  {
    q: "Why does a system appear with two different hostnames / twice?",
    tags: "duplicate system twice two hostnames same machine repeated why double",
    a: "The same machine can report slightly different server_name formats across metrics (e.g. 'GLB-218-PC' vs 'GLB - 218'). The dashboard bridges via account_id to collapse them, but an unbridged variant can occasionally show separately.",
  },
  {
    q: "Why is the account name or country blank?",
    tags: "account name country blank empty missing null why not shown",
    a: "Name/country come from the network's users table keyed by account_id. If that account has no row (or a blank/N/A value), it shows '—'. Reddit uses the username as the name.",
  },
  {
    q: "Why did the dashboard get slow or heavy earlier?",
    tags: "slow heavy lag performance load cpu high resource why dashboard",
    a: "On a small shared box, many tabs refreshing at once stacked duplicate computes; that is now collapsed by a single-flight guard + caching, Prometheus calls have timeouts, and a dead Redis no longer blocks requests. So it stays light.",
  },
  {
    q: "What happens if Prometheus or a database is down?",
    tags: "prometheus down database down fail error missing fail-safe what happens",
    a: "Everything is fail-safe: each network and each Prometheus call is wrapped, so one bad source just contributes nothing (e.g. no CPU/RAM, or one network missing) instead of breaking the whole page.",
  },
  {
    q: "How do I verify a number is correct?",
    tags: "verify correct trust accurate proof check debug query report",
    a: "Open a system's 'debug' to see the exact queries that produced each value, hover any value's source dot, or run diagnostics/system-info-report.js for a full side-by-side dump against Crawler Insight.",
  },
  {
    q: "How do I see data for a past day?",
    tags: "past day yesterday history date change range previous how",
    a: "Use the date-range picker (top right). Pick any day or range; every count, system and benchmark recomputes for that window.",
  },
];

// query expansion: map a typed word to extra search terms so different phrasings
// (e.g. "add up", "tally", "blank", "machine") still hit the right answer.
const HELP_SYN = {
  match: ["reconcile", "add", "sum", "equal", "tally", "same", "agree", "addup"],
  add: ["sum", "match", "total", "equal"], sum: ["add", "match", "total"],
  blank: ["empty", "dash", "missing", "null", "nothing", "zero"],
  empty: ["blank", "dash", "missing", "zero"], dash: ["blank", "empty", "missing"],
  machine: ["system", "host", "server", "box", "node", "proxmox", "pc"],
  system: ["machine", "host", "server", "box", "node"], host: ["machine", "system", "server", "hostname"],
  ad: ["ads", "creative", "creatives"], ads: ["ad", "creative", "creatives"],
  count: ["number", "total", "figure", "value"], number: ["count", "total", "value"],
  why: ["reason", "cause"], wrong: ["incorrect", "different", "mismatch", "off"],
  account: ["accounts", "profile"], accounts: ["account", "profile"],
  live: ["realtime", "now", "current", "running"], now: ["live", "current", "realtime"],
  idle: ["inactive", "offline", "stopped", "dead", "sleeping"],
  active: ["online", "running", "working", "live"],
  proxy: ["isp", "vpn", "decodo", "provider"], isp: ["proxy", "provider", "decodo"],
  cpu: ["processor", "load"], ram: ["memory"],
  filter: ["search", "find", "narrow", "show"], find: ["search", "filter", "show"],
  date: ["window", "day", "range", "time", "today"], window: ["date", "range", "day"],
  refresh: ["update", "reload", "auto", "poll"], update: ["refresh", "reload"],
  scrape: ["scraping", "crawl", "crawling"], scraping: ["scrape", "crawl", "rate"],
  url: ["urls", "link", "site"], urls: ["url", "links", "sites"],
  total: ["all", "sum", "overall"], unique: ["new", "fresh", "firstseen"],
  reddit: ["reddit"], gdn: ["gdn", "google ads", "display"], native: ["native"],
  youtube: ["youtube", "yt", "video"], facebook: ["facebook", "fb"], instagram: ["instagram", "insta", "ig"],
};

// High-signal words: a network name or a specific concept in the question almost
// always decides the topic, so matches on these weigh 3× (a generic word like
// "ads"/"system"/"why" should never outrank "reddit").
const HELP_HOT = new Set([
  "reddit", "linkedin", "quora", "gdn", "native", "youtube", "facebook", "instagram",
  "google", "gtext", "decodo", "proxmox", "isp", "proxy", "cpu", "ram", "benchmark",
  "timeline", "phantom", "heartbeat", "platform", "findable", "redirect", "fleet",
  "click", "empty", "nothing", "hostname", "creatives", "throughput", "providers",
  "drill", "trace", "deduped", "dedup", "activities", "scraped", "scraper", "crawler",
  "hops", "bridge", "monitored", "slow", "verify", "creative", "window", "unique",
  "tile", "tiles", "debug", "refresh", "url", "urls", "country", "account", "accounts",
]);

// Generic filler words that carry no topic signal — dropped before matching so
// "why is this blank?" matches on "blank", not on "this"/"why".
const HELP_STOP = new Set([
  "the", "and", "for", "are", "was", "were", "been", "does", "did", "this", "that",
  "these", "those", "its", "you", "your", "our", "can", "could", "would", "should",
  "will", "please", "tell", "give", "show", "what", "whats", "why", "how", "when",
  "where", "which", "who", "mean", "means", "there", "here", "with", "about", "into",
  "from", "get", "got", "see", "want", "need", "know", "okay", "yes", "explain",
  "thing", "things", "any", "all", "but", "not", "out", "now", "one", "two",
]);
const HELP_GREET = /^(hi+|hey+|hello+|yo+|sup|hii?|namaste|hola|good (morning|evening|afternoon)|thanks?( you)?|thank you|ok(ay)?|cool|nice|great|got it)\b/;

// deterministic keyword matcher (no AI): score each Q&A by query-token overlap
// against the question (weight 4), tags (3) and answer (1); high-signal words ×3;
// plus a full-phrase boost. Tokens must be ≥3 chars and not filler words.
function helpMatch(query) {
  const raw = (query || "").trim().toLowerCase();
  if (!raw) return [];
  const base = [...new Set(raw.split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !HELP_STOP.has(t)))];
  if (!base.length) return [];
  const toks = new Set(base);
  for (const t of base) (HELP_SYN[t] || []).forEach((x) => toks.add(x));
  return HELP_QA
    .map((item) => {
      const ql = item.q.toLowerCase();
      const tl = (item.tags || "").toLowerCase();
      const al = item.a.toLowerCase();
      let score = 0;
      for (const t of toks) {
        const w = HELP_HOT.has(t) ? 3 : 1;
        if (ql.includes(t)) score += 4 * w;
        if (tl.includes(t)) score += 3 * w;
        if (al.includes(t)) score += 1 * w;
      }
      if (raw.length >= 4 && (ql.includes(raw) || tl.includes(raw))) score += 8;
      return { item, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.item);
}

const InfoButton = ({ onClick, className = "" }) => (
  <button
    onClick={(e) => { e.stopPropagation(); onClick(); }}
    className={`inline-flex h-5 w-5 items-center justify-center rounded-full border border-[#cdd6f4] bg-white text-[11px] font-bold text-[#1f296a] hover:bg-[#eef2ff] ${className}`}
    data-tooltip-id="dash-tip"
    data-tooltip-content="Where does this data come from?"
  >
    i
  </button>
);

/* ------------------------------------------------------------------ */
/* small presentational pieces                                         */
/* ------------------------------------------------------------------ */

const KpiTile = ({ label, value, accent = "#1f296a", sub, onClick, active, hint, source }) => (
  <div
    onClick={onClick}
    data-tooltip-id={hint ? "dash-tip" : undefined}
    data-tooltip-content={hint}
    className={`flex flex-col justify-between rounded-[14px] border bg-white px-5 py-4 shadow-sm min-w-[150px] transition ${
      onClick ? "cursor-pointer hover:border-[#1f296a] hover:shadow-md" : ""
    } ${active ? "border-[#1f296a] ring-1 ring-[#1f296a]" : "border-[#e6e9f5]"}`}
  >
    <span className="flex items-center gap-1.5 text-[13px] font-medium text-[#7a83a8] uppercase tracking-wide">
      {label}
      {source ? <SourceDot s={source} /> : null}
    </span>
    <span className="text-[30px] font-[700] leading-tight" style={{ color: accent }}>
      {value}
    </span>
    {sub ? <span className="text-[12px] text-[#9aa2c0]">{sub}</span> : null}
  </div>
);

const MiniBar = ({ value, color }) => (
  <div className="h-[6px] w-full rounded-full bg-[#eef1fb] overflow-hidden">
    <div
      className="h-full rounded-full transition-all"
      style={{ width: `${Math.min(100, Math.max(0, value || 0))}%`, background: color }}
    />
  </div>
);

// Compact table for the GDN/Native benchmark modal. cols = [[key, label, isNum?], ...]
const BenchTable = ({ title, rows, cols, limit = 25 }) => {
  const data = (rows || []).slice(0, limit);
  if (!data.length) return null;
  return (
    <div className="rounded-[12px] border border-[#eef1fb]">
      <div className="border-b border-[#eef1fb] px-3 py-2 text-[12px] font-semibold text-[#1f296a]">{title}</div>
      <div className="max-h-[220px] overflow-auto">
        <table className="w-full text-left text-[12px]">
          <thead className="sticky top-0 bg-white text-[10px] uppercase text-[#9aa2c0]">
            <tr className="border-b border-[#f4f6fc]">
              {cols.map(([k, l, isNum]) => (
                <th key={k} className={`px-3 py-1.5 ${isNum ? "text-right" : ""}`}>{l}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((r, i) => (
              <tr key={i} className="border-b border-[#f7f8fd] hover:bg-[#f7f8fd]">
                {cols.map(([k, , isNum]) => (
                  <td key={k} className={`px-3 py-1.5 ${isNum ? "text-right tabular-nums text-[#264688]" : "text-[#7a83a8]"}`}>
                    {isNum ? Number(r[k] || 0).toLocaleString("en-US") : (r[k] ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

const CrawlerDashboard = () => {
  const dispatch = useDispatch();
  const { dashboardOverview, loadingDashboardOverview, dashboardError, exporterHealth,
          dashboardSystem, loadingDashboardSystem, StatusSystemInfo, loadingStatusSystemInfo,
          dashboardAccounts, loadingDashboardAccounts,
          dashboardAccountTimeline, loadingDashboardAccountTimeline,
          dashboardPlatforms, systemDebug, loadingSystemDebug,
          gdnBenchmark, loadingGdnBenchmark,
          ytBenchmark, loadingYtBenchmark } =
    useSelector((s) => s.poweradspy);

  const [dateRange, setDateRange] = useState(loadSelectedDates());
  const [platform, setPlatform] = useState([]); // [] = both 10 & 12 (no filter)
  const [showFilter, setShowFilter] = useState(false);
  const [refreshMs, setRefreshMs] = useState(60000); // 60s default — lighter on Prometheus/DB
  const [lastUpdated, setLastUpdated] = useState(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // all | active | inactive
  const [netFilter, setNetFilter] = useState(null); // null = all networks
  const [sortBy, setSortBy] = useState("recent"); // recent | ads | unique | accounts
  const [scrapingOnly, setScrapingOnly] = useState(false); // "Scraping Now" tile filter
  const [infoOpen, setInfoOpen] = useState(false); // help chat-bot modal
  const [chatLog, setChatLog] = useState([]);      // [{ role:'user'|'bot', text }]
  const [chatInput, setChatInput] = useState("");
  const chatEndRef = useRef(null);
  // GDN/Native scraping-benchmark modal
  const [benchOpen, setBenchOpen] = useState(false);
  // YouTube monitoring-benchmark modal
  const [ytOpen, setYtOpen] = useState(false);
  // debug / data-lineage modal
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugSys, setDebugSys] = useState(null);
  const [debugReveal, setDebugReveal] = useState(0); // how many steps shown (real-time feel)
  const [showRawQ, setShowRawQ] = useState(false);

  const systemsRef = useRef(null);

  // drill-down: system status timeline (reuses existing working endpoint)
  const [statusModal, setStatusModal] = useState(false);
  // drill-down: per-system account breakdown (new endpoint)
  const [drillOpen, setDrillOpen] = useState(false);
  const [drillSys, setDrillSys] = useState(null); // the clicked system row
  // filters inside the drill (accounts table)
  const [acctStatus, setAcctStatus] = useState("all"); // all | live | idle
  const [acctNet, setAcctNet] = useState("all");
  const [acctCountry, setAcctCountry] = useState("all");
  const [acctSearch, setAcctSearch] = useState("");
  // account status-timeline modal (new account_id-based endpoint)
  const [acctModal, setAcctModal] = useState(false);
  const [acctModalName, setAcctModalName] = useState("");

  // ALL-accounts modal (Accounts tile / Scraping-Now tile)
  const [accountsModal, setAccountsModal] = useState(false);
  const [allStatus, setAllStatus] = useState("all"); // all | live | idle | scraping
  const [allNet, setAllNet] = useState("all");
  const [allCountry, setAllCountry] = useState("all");
  const [allSystem, setAllSystem] = useState("all");
  const [allSearch, setAllSearch] = useState("");

  const filterRef = useRef(null);
  const filterBtnRef = useRef(null);

  /* persist + build the request payload */
  useEffect(() => {
    sessionStorage.setItem(
      "dateRange",
      JSON.stringify({
        startDate: dateRange.startDate.toISOString(),
        endDate: dateRange.endDate.toISOString(),
      })
    );
  }, [dateRange]);

  const buildPayload = useCallback(
    () => ({
      range: { from: fmtDate(dateRange.startDate), to: fmtDate(dateRange.endDate) },
      platform: platform.length ? platform : undefined,
      activeWindowMin: 10,
    }),
    [dateRange, platform]
  );

  const load = useCallback(() => {
    dispatch(fetchDashboardOverview(buildPayload()))
      .unwrap()
      .then(() => setLastUpdated(Date.now()))
      .catch(() => {});
    // raw metrics-source health (send-metrics) — separate, never blocks overview
    dispatch(fetchExporterHealth());
  }, [dispatch, buildPayload]);

  /* fetch on filter/date change */
  useEffect(() => {
    load();
  }, [load]);

  /* discover all platform values once (for the filter) */
  useEffect(() => {
    dispatch(fetchDashboardPlatforms());
  }, [dispatch]);

  // platform options: discovered list from backend, fallback to the known pair
  const platformOptions = useMemo(
    () => (dashboardPlatforms?.length ? dashboardPlatforms : PLATFORM_OPTIONS),
    [dashboardPlatforms]
  );

  /* live auto-refresh */
  useEffect(() => {
    if (!refreshMs) return undefined;
    const id = setInterval(load, refreshMs);
    return () => clearInterval(id);
  }, [refreshMs, load]);

  /* close filter popover on outside click */
  useEffect(() => {
    const onClick = (e) => {
      if (
        showFilter &&
        filterRef.current &&
        !filterRef.current.contains(e.target) &&
        !filterBtnRef.current?.contains(e.target)
      )
        setShowFilter(false);
    };
    if (showFilter) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [showFilter]);

  /* "x ago" ticker for the live indicator */
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const togglePlatform = (val) =>
    setPlatform((prev) => (prev.includes(val) ? prev.filter((v) => v !== val) : [...prev, val]));

  const totals = dashboardOverview?.totals || {};
  const live = dashboardOverview?.live || {};
  const networks = dashboardOverview?.networks || [];
  const systems = useMemo(() => dashboardOverview?.systems || [], [dashboardOverview]);

  /* derive filtered + sorted systems */
  const visibleSystems = useMemo(() => {
    let rows = systems.slice();
    if (netFilter) rows = rows.filter((r) => (r.networks || []).includes(netFilter));
    if (statusFilter === "active") rows = rows.filter((r) => r.active);
    if (statusFilter === "inactive") rows = rows.filter((r) => !r.active);
    if (scrapingOnly) rows = rows.filter((r) => r.now_rate_per_min > 0);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(
        (r) =>
          String(r.system_id).toLowerCase().includes(q) ||
          String(r.hostname || "").toLowerCase().includes(q)
      );
    }
    rows.sort((a, b) => {
      if (sortBy === "ads") return (b.ads || 0) - (a.ads || 0);
      if (sortBy === "unique") return (b.unique_ads || 0) - (a.unique_ads || 0);
      if (sortBy === "accounts") return (b.accounts || 0) - (a.accounts || 0);
      // recent
      return (a.last_active_ago_sec ?? 1e15) - (b.last_active_ago_sec ?? 1e15);
    });
    return rows;
  }, [systems, netFilter, statusFilter, search, sortBy, scrapingOnly]);

  const handleDateChange = (startDate, endDate) => setDateRange({ startDate, endDate });

  // KPI tile click → apply a quick filter/sort on the systems grid + scroll to it
  const focusSystems = ({ status = "all", net = null, sort = "recent", scraping = false } = {}) => {
    setStatusFilter(status);
    setNetFilter(net);
    setSortBy(sort);
    setScrapingOnly(scraping);
    setTimeout(() => systemsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  // open the GDN/Native scraping-benchmark modal (direct DB, ported v2 dashboard).
  // host = one proxmox system (system-card click); no host = ISP/proxy view (📊).
  const openBenchmark = (opts = {}) => {
    setBenchOpen(true);
    dispatch(fetchGdnBenchmark(opts.host ? { host: opts.host } : { system_id: "decodo-isp" }));
  };

  // open the YouTube monitoring-benchmark modal (direct ES, ported v2 dashboard)
  const openYtBenchmark = () => {
    setYtOpen(true);
    dispatch(fetchYoutubeBenchmark({ limit: 250 }));
  };

  // open the debug / data-lineage trace for a system
  const openDebug = (sys) => {
    setDebugSys(sys);
    setDebugReveal(0);
    setShowRawQ(false);
    setDebugOpen(true);
    dispatch(
      fetchSystemDebug({
        system_id: sys.system_id,
        range: { from: fmtDate(dateRange.startDate), to: fmtDate(dateRange.endDate) },
        platform: platform.length ? platform : undefined,
      })
    );
  };

  // reveal debug steps one-by-one for a "live process" feel
  useEffect(() => {
    if (!debugOpen || !systemDebug?.steps?.length) return undefined;
    if (debugReveal >= systemDebug.steps.length) return undefined;
    const id = setTimeout(() => setDebugReveal((n) => n + 1), 500);
    return () => clearTimeout(id);
  }, [debugOpen, systemDebug, debugReveal]);

  // open the account drill for a system
  const openDrill = (sys) => {
    setDrillSys(sys);
    setDrillOpen(true);
    dispatch(
      fetchDashboardSystem({
        system_id: sys.system_id,
        range: { from: fmtDate(dateRange.startDate), to: fmtDate(dateRange.endDate) },
        platform: platform.length ? platform : undefined,
      })
    );
  };

  // open the Prometheus status-timeline modal (existing endpoint)
  const openSystemStatus = (sys) => {
    setStatusModal(true);
    dispatch(
      fetchStatusSystemInfo({
        range: { from: fmtDate(dateRange.startDate), to: fmtDate(dateRange.endDate) },
        systemName: sys.system_id,
        steps: daysInclusive(dateRange.startDate, dateRange.endDate),
      })
    );
  };

  // open per-account status timeline (NEW account_id-based endpoint — reliable).
  const openAccountStatus = (a) => {
    setAcctModalName(a.name || a.account_id || "Account");
    setAcctModal(true);
    dispatch(
      fetchDashboardAccountTimeline({
        account_id: a.account_id,
        server_name: a.prom_server || drillSys?.hostname || undefined,
        range: { from: fmtDate(dateRange.startDate), to: fmtDate(dateRange.endDate) },
      })
    );
  };

  // open the ALL-accounts modal (Accounts tile / Scraping-Now tile)
  const openAccounts = (preset = "all") => {
    setAllStatus(preset);
    setAllNet("all");
    setAllCountry("all");
    setAllSystem("all");
    setAllSearch("");
    setAccountsModal(true);
    dispatch(
      fetchDashboardAccounts({
        range: { from: fmtDate(dateRange.startDate), to: fmtDate(dateRange.endDate) },
        platform: platform.length ? platform : undefined,
      })
    );
  };

  // all-accounts after the modal filters
  const allAccounts = useMemo(() => dashboardAccounts?.accounts || [], [dashboardAccounts]);
  const visibleAllAccounts = useMemo(() => {
    let rows = allAccounts.slice();
    if (allStatus === "live") rows = rows.filter((a) => a.live);
    if (allStatus === "idle") rows = rows.filter((a) => !a.live);
    if (allStatus === "scraping") rows = rows.filter((a) => a.now_rate_per_min > 0);
    if (allNet !== "all") rows = rows.filter((a) => a.network === allNet);
    if (allCountry !== "all") rows = rows.filter((a) => a.country === allCountry);
    if (allSystem !== "all") rows = rows.filter((a) => a.system_id === allSystem);
    if (allSearch.trim()) {
      const q = allSearch.trim().toLowerCase();
      rows = rows.filter(
        (a) =>
          String(a.name || "").toLowerCase().includes(q) ||
          String(a.account_id || "").toLowerCase().includes(q) ||
          String(a.system_id || "").toLowerCase().includes(q)
      );
    }
    return rows;
  }, [allAccounts, allStatus, allNet, allCountry, allSystem, allSearch]);

  // chart data for the Grafana-style graphical view in the accounts modal.
  // Uses live scrape rate when anything is scraping, else falls back to ads.
  const accountCharts = useMemo(() => {
    const rateMode = visibleAllAccounts.some((a) => a.now_rate_per_min > 0);
    const metric = (a) => (rateMode ? a.now_rate_per_min : a.ads);
    const unit = rateMode ? "/min" : " ads";

    const sysAgg = {};
    const netAgg = {};
    for (const a of visibleAllAccounts) {
      const m = metric(a) || 0;
      if (a.system_id) sysAgg[a.system_id] = (sysAgg[a.system_id] || 0) + m;
      const nk = a.network || "other";
      netAgg[nk] = (netAgg[nk] || 0) + m;
    }
    const topSystems = Object.entries(sysAgg)
      .map(([k, v]) => ({ name: k, value: v }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
    const topAccounts = visibleAllAccounts
      .map((a) => ({ name: a.name || String(a.account_id), value: metric(a) || 0, network: a.network }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
    const byNetwork = Object.entries(netAgg)
      .map(([k, v]) => ({ name: NETWORK_LABEL[k] || k, key: k, value: v }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);
    return { rateMode, unit, topSystems, topAccounts, byNetwork };
  }, [visibleAllAccounts]);

  // accounts after the in-modal filters (status / network / country / search)
  const drillAccounts = useMemo(() => dashboardSystem?.accounts || [], [dashboardSystem]);
  const drillCountries = useMemo(
    () => [...new Set(drillAccounts.map((a) => a.country).filter(Boolean))].sort(),
    [drillAccounts]
  );
  const drillNets = useMemo(
    () => [...new Set(drillAccounts.map((a) => a.network).filter(Boolean))],
    [drillAccounts]
  );
  const visibleAccounts = useMemo(() => {
    let rows = drillAccounts.slice();
    if (acctStatus === "live") rows = rows.filter((a) => a.live);
    if (acctStatus === "idle") rows = rows.filter((a) => !a.live);
    if (acctNet !== "all") rows = rows.filter((a) => a.network === acctNet);
    if (acctCountry !== "all") rows = rows.filter((a) => a.country === acctCountry);
    if (acctSearch.trim()) {
      const q = acctSearch.trim().toLowerCase();
      rows = rows.filter(
        (a) =>
          String(a.name || "").toLowerCase().includes(q) ||
          String(a.account_id || "").toLowerCase().includes(q)
      );
    }
    return rows;
  }, [drillAccounts, acctStatus, acctNet, acctCountry, acctSearch]);

  // ── help chat-bot: free-text question → best answer from the knowledge base ──
  // Deterministic (no AI): score Q&A by keyword overlap; fall back to the field
  // → data-source reference; else a guiding message.
  const askBot = (raw) => {
    const text = (raw ?? chatInput).trim();
    if (!text) return;
    const ql = text.toLowerCase();
    const matches = helpMatch(text);
    const toks = ql.split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !HELP_STOP.has(t));
    const field = !matches.length && toks.length
      ? (FIELD_SOURCES.find((r) => `${r.f} ${r.how} ${r.k || ""}`.toLowerCase().includes(ql))
         || FIELD_SOURCES.find((r) => toks.some((t) => `${r.f} ${r.k || ""}`.toLowerCase().includes(t))))
      : null;
    let answer;
    if (matches.length) {
      answer = matches[0].a;
      const more = matches.slice(1, 3).map((m) => m.q);
      if (more.length) answer += `\n\nRelated you can ask: ${more.join("  ·  ")}`;
    } else if (field) {
      answer = `“${field.f}” comes from ${SOURCE[field.s].label}. ${field.how}`;
    } else if (HELP_GREET.test(ql) || !toks.length) {
      // greeting / filler / nothing meaningful typed
      answer = "Hi! 👋 Ask me anything about System Info — in your own words. For example: \"why is reddit 0 systems but has ads?\", \"what is decodo-isp?\", \"why is unique blank?\", \"how is total systems counted?\", \"cpu blank\". Even one keyword works.";
    } else {
      answer = "I couldn't find that one. Try a keyword from what you see, e.g.:\n• counts / match / total / unique ads\n• systems / total systems / active / idle / accounts\n• decodo-isp / proxy / gdn / native / youtube / reddit\n• scraping now / live / heartbeat / cpu / ram\n• benchmark / live feed / debug / timeline / date window";
    }
    setChatLog((log) => [...log, { role: "user", text }, { role: "bot", text: answer }]);
    setChatInput("");
  };

  // seed a greeting when the chat opens; auto-scroll to the newest message
  useEffect(() => {
    if (infoOpen && chatLog.length === 0) {
      setChatLog([{ role: "bot", text: "Hi! I'm the System Info assistant. Ask me anything about this dashboard in your own words — why numbers look the way they do, where a value comes from, what something means. I answer from a fixed knowledge base (no AI). For example: \"why don't the ad counts match the network card?\"" }]);
    }
  }, [infoOpen, chatLog.length]);
  useEffect(() => {
    if (infoOpen) chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatLog, infoOpen]);

  const updatedAgo = lastUpdated ? Math.floor((Date.now() - lastUpdated) / 1000) : null;

  return (
    <div className="w-full flex flex-col gap-[18px]">
      {/* ===== Header / controls ===== */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
         <div className="flex items-center gap-3">
          <span className="text-[28px] font-[700] text-[#264688]">Crawler Fleet</span>
          <span className="flex items-center gap-1.5 text-[13px] text-[#7a83a8]">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${
                refreshMs ? "bg-green-500 animate-pulse" : "bg-gray-300"
              }`}
            />
            {refreshMs ? "Live" : "Paused"}
            {lastUpdated ? ` · updated ${updatedAgo}s ago` : ""}
          </span>
          {/* raw metrics source (send-metrics) health */}
          {exporterHealth && (
            <span
              className="flex items-center gap-1.5 rounded-full border border-[#e6e9f5] bg-white px-2 py-0.5 text-[12px] text-[#7a83a8]"
              data-tooltip-id="dash-tip"
              data-tooltip-content={
                exporterHealth.up
                  ? `send-metrics up · ${nfmt(exporterHealth.series)} series · ${exporterHealth.latency_ms}ms`
                  : `send-metrics unreachable${exporterHealth.error ? ` · ${exporterHealth.error}` : ""}`
              }
            >
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  exporterHealth.up ? "bg-green-500" : "bg-red-500"
                }`}
              />
              Metrics source {exporterHealth.up ? "up" : "down"}
            </span>
          )}
         </div>
         {/* date context + data-source legend */}
         <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[#9aa2c0]">
           <span>
             Showing data for{" "}
             <b className="text-[#7a83a8]">
               {windowLabel(dashboardOverview?.window) || windowLabel({ from: fmtDate(dateRange.startDate), to: fmtDate(dateRange.endDate) })}
             </b>
           </span>
           <span className="flex items-center gap-1.5">
             <SourceDot s="db" /> DB
             <SourceDot s="prom" /> Prometheus
             <SourceDot s="both" /> Both
             <InfoButton onClick={() => setInfoOpen(true)} className="ml-1" />
           </span>
         </div>
        </div>

        <div className="flex items-center gap-2">
          {/* refresh interval */}
          <select
            value={refreshMs}
            onChange={(e) => setRefreshMs(Number(e.target.value))}
            className="!rounded-lg !border !border-gray-300 !bg-white !px-2 !py-1.5 text-[14px] text-[#1f296a] focus:!outline-0"
            data-tooltip-id="dash-tip"
            data-tooltip-content="Live auto-refresh interval"
          >
            {REFRESH_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label === "Off" ? "Refresh: Off" : `Every ${o.label}`}
              </option>
            ))}
          </select>

          {/* manual refresh */}
          <button
            onClick={load}
            className="flex items-center justify-center !rounded-lg !border !border-gray-300 !bg-white !p-2 !w-10"
            data-tooltip-id="dash-tip"
            data-tooltip-content="Refresh now"
          >
            <FiRefreshCw className={`h-5 w-5 ${loadingDashboardOverview ? "animate-spin" : ""}`} />
          </button>

          {/* platform filter */}
          <div className="relative">
            <button
              ref={filterBtnRef}
              onClick={() => setShowFilter((s) => !s)}
              className={`flex items-center justify-center !rounded-lg !border !border-gray-300 !p-1.5 !w-10 ${
                platform.length ? "!bg-[#d2dfff]" : "!bg-white"
              }`}
              data-tooltip-id="dash-tip"
              data-tooltip-content="Filter by crawler type"
            >
              <CiFilter className="h-6 w-6" />
            </button>
            {showFilter && (
              <div
                ref={filterRef}
                className="absolute right-0 top-[50px] z-50 w-72 rounded-xl border border-[#e0e7ff] bg-white p-5 shadow-xl"
              >
                <div className="mb-3 flex items-center justify-between">
                  <label className="text-sm font-medium text-gray-700">Crawler type</label>
                  <svg
                    onClick={() => setShowFilter(false)}
                    className="h-5 w-5 cursor-pointer"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
                <div className="flex flex-wrap gap-2">
                  {platformOptions.map((o) => (
                    <div
                      key={o.value}
                      onClick={() => togglePlatform(o.value)}
                      className={`cursor-pointer rounded-full border px-3 py-1 text-sm ${
                        platform.includes(o.value)
                          ? "border-blue-500 bg-blue-100 text-blue-700"
                          : "border-gray-300 bg-gray-100 text-gray-700"
                      }`}
                      data-tooltip-id="dash-tip"
                      data-tooltip-content={`Platform ${o.value}`}
                    >
                      {o.label}
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex justify-end">
                  <button
                    onClick={() => {
                      setPlatform([]);
                      setShowFilter(false);
                    }}
                    className="!rounded-lg !border !border-[#d1d5db] !bg-gray-200 !px-4 !py-2 text-sm font-medium text-[#1f296a]"
                  >
                    Reset
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* date range (existing component, preserved) */}
          <SimpleDateRangePicker
            initialStartDate={dateRange.startDate}
            initialEndDate={dateRange.endDate}
            onDateChange={handleDateChange}
            setSelectedSystem={() => {}}
            setShowFilterModal={setShowFilter}
          />
        </div>
      </div>

      {dashboardError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
          Could not load dashboard: {String(dashboardError)}
        </div>
      )}

      {/* ===== KPI tiles (clickable → filter/sort the grid) ===== */}
      <div className="flex flex-wrap gap-3">
        <KpiTile
          label="Total Systems" value={nfmt(totals.systems)} accent="#1f296a" source="db"
          hint="Show all systems"
          active={statusFilter === "all" && !netFilter && !scrapingOnly}
          onClick={() => focusSystems({ status: "all" })}
        />
        <KpiTile
          label="Active Now" value={nfmt(totals.active_systems)} accent="#16a34a" sub="live / last 10 min" source="both"
          hint="Show only active systems"
          active={statusFilter === "active" && !scrapingOnly}
          onClick={() => focusSystems({ status: "active" })}
        />
        <KpiTile
          label="Inactive" value={nfmt(totals.inactive_systems)} accent="#9aa2c0" source="both"
          hint="Show only idle systems"
          active={statusFilter === "inactive"}
          onClick={() => focusSystems({ status: "inactive" })}
        />
        <KpiTile
          label="Scraping Now" source="prom"
          value={live.scrape_rate_per_min != null ? `${nfmt(live.scrape_rate_per_min)}/min` : "—"}
          accent="#16a34a" sub="live fleet rate"
        />
        <KpiTile
          label="Accounts" value={nfmt(totals.accounts)} accent="#264688" source="db"
          hint="Open all accounts (which account on which system)"
          onClick={() => openAccounts("all")}
        />
        <KpiTile label="Total Ads" value={nfmt(totals.ads)} accent="#264688" source="db"
          hint="<net>_ad last_seen in window (same as Crawler Insight /get-count)" />
        <KpiTile label="Unique Ads" value={nfmt(totals.unique_ads)} accent="#7c3aed" source="db"
          hint="<net>_ad first_seen in window (new ads)" />
        <KpiTile label="Networks" value={nfmt(totals.networks_active)} accent="#264688" source="db" />
      </div>

      {/* Live activity strip (cycles/captures/plugin-events) hidden until the
          prod metric names are confirmed — they were returning 0. The Scraping
          Now tile (scrape_rate_per_min) works and stays. */}

      {/* ===== Per-network cards (clickable filter) ===== */}
      <div className="flex flex-wrap gap-3">
        <div
          onClick={() => setNetFilter(null)}
          className={`cursor-pointer rounded-[12px] border px-4 py-3 ${
            netFilter === null ? "border-[#1f296a] bg-[#eef2ff]" : "border-[#e6e9f5] bg-white"
          }`}
        >
          <div className="text-[13px] font-semibold text-[#1f296a]">All networks</div>
          <div className="text-[12px] text-[#7a83a8]">{nfmt(totals.systems)} systems</div>
        </div>
        {networks
          .filter((n) => n && (n.systems > 0 || n.ads > 0))
          .map((n) => {
            const sel = netFilter === n.network;
            const hasGdnBench = n.network === "gdn" || n.network === "native";
            const isYt = n.network === "youtube";
            return (
              <div
                key={n.network}
                onClick={() => setNetFilter(sel ? null : n.network)}
                className={`flex cursor-pointer items-center gap-3 rounded-[12px] border px-4 py-3 ${
                  sel ? "border-[#1f296a] bg-[#eef2ff]" : "border-[#e6e9f5] bg-white"
                }`}
                data-tooltip-id="dash-tip"
                data-tooltip-content="Filter systems by this network"
              >
                {NETWORK_ICONS[n.network] && (
                  <img src={NETWORK_ICONS[n.network]} alt="" className="h-8 w-8 rounded-full border border-[#e6e9f5] p-1" />
                )}
                <div className="flex flex-col">
                  <div className="flex items-center gap-2 text-[14px] font-semibold text-[#1f296a]">
                    {NETWORK_LABEL[n.network] || n.network}
                    <span className="flex items-center gap-1 text-[11px] font-normal text-[#16a34a]">
                      <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
                      {n.active_systems} live
                    </span>
                    {(hasGdnBench || isYt) && (
                      <button
                        onClick={(e) => { e.stopPropagation(); isYt ? openYtBenchmark() : openBenchmark(); }}
                        className="rounded-full bg-[#7c3aed] px-1.5 text-[9px] font-bold text-white hover:bg-[#6d28d9]"
                        data-tooltip-id="dash-tip"
                        data-tooltip-content={isYt ? "Open YouTube live benchmark (status, 1h/3h/24h, recent ads feed)" : "Open ISP/proxy crawl-benchmark (all machines, providers, proxy)"}
                      >
                        📊
                      </button>
                    )}
                  </div>
                  <div className="text-[12px] text-[#7a83a8]">
                    {n.systems} sys · {nfmt(n.ads)} ads · {nfmt(n.unique_ads)} uniq
                  </div>
                </div>
              </div>
            );
          })}
      </div>

      {/* ===== Systems panel controls ===== */}
      <div ref={systemsRef} className="flex flex-wrap items-center justify-between gap-3 scroll-mt-4">
        <div className="flex items-center gap-2 text-[18px] font-[600] text-[#264688]">
          Systems
          {scrapingOnly && (
            <span className="rounded-full bg-green-50 px-2 py-0.5 text-[12px] font-normal text-green-600">scraping now</span>
          )}
          <span className="text-[14px] font-normal text-[#9aa2c0]">
            ({visibleSystems.length}{netFilter ? ` · ${NETWORK_LABEL[netFilter] || netFilter}` : ""})
          </span>
          <InfoButton onClick={() => setInfoOpen(true)} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* status filter */}
          <div className="flex overflow-hidden rounded-lg border border-gray-300">
            {[
              { v: "all", l: "All" },
              { v: "active", l: "Active" },
              { v: "inactive", l: "Inactive" },
            ].map((o) => (
              <button
                key={o.v}
                onClick={() => setStatusFilter(o.v)}
                className={`!px-3 !py-1.5 text-[13px] ${
                  statusFilter === o.v ? "!bg-[#1f296a] !text-white" : "!bg-white !text-[#1f296a]"
                }`}
              >
                {o.l}
              </button>
            ))}
          </div>
          {/* sort */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="!rounded-lg !border !border-gray-300 !bg-white !px-2 !py-1.5 text-[13px] text-[#1f296a] focus:!outline-0"
          >
            <option value="recent">Sort: Last active</option>
            <option value="ads">Sort: Total ads</option>
            <option value="unique">Sort: Unique ads</option>
            <option value="accounts">Sort: Accounts</option>
          </select>
          {/* search */}
          <div className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5">
            <CiSearch className="h-5 w-5 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search system / host"
              className="w-[170px] text-[13px] focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* ===== Systems grid ===== */}
      {loadingDashboardOverview && !systems.length ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-[150px] animate-pulse rounded-[14px] border border-[#eef1fb] bg-white" />
          ))}
        </div>
      ) : visibleSystems.length === 0 ? (
        <div className="rounded-[14px] border border-[#eef1fb] bg-white px-6 py-10 text-center text-[#9aa2c0]">
          No systems for the selected window / filters.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visibleSystems.map((sys) => (
            <div
              key={sys.system_id}
              onClick={() => (sys.kind === "gdncrawl" ? openBenchmark({ host: sys.system_id }) : openDrill(sys))}
              className="group cursor-pointer rounded-[14px] border border-[#e6e9f5] bg-white p-4 shadow-sm transition hover:border-[#1f296a] hover:shadow-md"
            >
              {/* row 1: id + status */}
              <div className="flex items-start justify-between">
                <div className="flex flex-col gap-0.5">
                  {/* system name — from DB (activities.system_id) */}
                  <span className="flex items-center gap-1 text-[15px] font-[700] text-[#1f296a] group-hover:underline">
                    {sys.system_id}
                    <SourceDot s="db" />
                    {/* <button
                      onClick={(e) => { e.stopPropagation(); openDebug(sys); }}
                      className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-[#cdd6f4] text-[10px] font-bold text-[#1f296a] hover:bg-[#eef2ff]"
                      data-tooltip-id="dash-tip"
                      data-tooltip-content="System name source — click to trace + see query"
                    >
                      i
                    </button> */}
                  </span>
                  {/* hostname — from Prometheus (server_name, bridged) */}
                  {sys.hostname && (
                    <span className="flex items-center gap-1 text-[11px] text-gray-400">
                      {sys.hostname}
                      <SourceDot s="prom" />
                      {/* <button
                        onClick={(e) => { e.stopPropagation(); openDebug(sys); }}
                        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-[#cdd6f4] text-[10px] font-bold text-[#7c3aed] hover:bg-[#f5f0ff]"
                        data-tooltip-id="dash-tip"
                        data-tooltip-content="Hostname source — click to trace + see query"
                      >
                        i
                      </button> */}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); openDebug(sys); }}
                    className="rounded-md border border-[#e6e9f5] bg-white px-1.5 py-0.5 text-[11px] font-medium text-[#7a83a8] hover:border-[#1f296a] hover:text-[#1f296a]"
                    data-tooltip-id="dash-tip"
                    data-tooltip-content="Debug: where did this data come from?"
                  >
                    ⓘ debug
                  </button>
                  <span
                    className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      sys.active ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        sys.active ? "bg-green-500 animate-pulse" : "bg-gray-400"
                      }`}
                    />
                    {sys.active ? "Active" : "Idle"}
                  </span>
                </div>
              </div>

              {/* row 1b: live scraping rate "right now" */}
              {sys.now_rate_per_min > 0 && (
                <div className="mt-1.5">
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-600">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                    ▶ {nfmt(sys.now_rate_per_min)}/min now
                  </span>
                </div>
              )}

              {/* row 2: last active + network icons */}
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[12px] text-[#7a83a8]">
                  Last active: <b className="text-[#1f296a]">{agoText(sys.last_active_ago_sec)}</b>
                </span>
                <div className="flex -space-x-1">
                  {(sys.networks || []).slice(0, 5).map((net) =>
                    NETWORK_ICONS[net] ? (
                      <img
                        key={net}
                        src={NETWORK_ICONS[net]}
                        alt={net}
                        title={NETWORK_LABEL[net] || net}
                        className="h-6 w-6 rounded-full border border-white bg-white"
                      />
                    ) : null
                  )}
                </div>
              </div>

              {/* row 3: mini stats — when a network is filtered, show THAT
                  network's portion (not the combined gdn+native sum). */}
              {(() => {
                const pn = netFilter ? sys.perNetwork?.[netFilter] : null;
                const isCrawl = sys.kind === "gdncrawl";
                const cAds = pn ? pn.ads : sys.ads;
                const cUniq = pn ? pn.unique_ads : sys.unique_ads;
                const cUrls = pn ? pn.urls : sys.urls;
                const cAcc = pn ? pn.accounts : sys.accounts;
                return (
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    {/* gdn/native: physical machines → show URLs crawled (clean, verifiable).
                        Others: account-based → show Accounts. */}
                    <div
                      className="rounded-lg bg-[#f7f8fd] py-1.5"
                      data-tooltip-id={isCrawl ? "dash-tip" : undefined}
                      data-tooltip-content={isCrawl ? "URLs this proxmox machine crawled in the window (gdn_crawl_quality)." : undefined}
                    >
                      <div className="text-[15px] font-[700] text-[#264688]">{nfmt(isCrawl ? cUrls : cAcc)}</div>
                      <div className="text-[10px] uppercase text-[#9aa2c0]">{isCrawl ? "URLs" : "Accounts"}</div>
                    </div>
                    <div
                      className="rounded-lg bg-[#f7f8fd] py-1.5"
                      data-tooltip-id={isCrawl ? "dash-tip" : undefined}
                      data-tooltip-content={isCrawl ? "Ads found by this machine across crawls (with duplicates across URLs) — NOT the dedup'd network total. The gdn/native ad table tags ads to the proxy (decodo-isp), not the machine, so per-machine cannot equal the network card." : undefined}
                    >
                      <div className="text-[15px] font-[700] text-[#264688]">{nfmt(cAds)}</div>
                      <div className="text-[10px] uppercase text-[#9aa2c0]">{isCrawl ? "Ads (crawl)" : "Ads"}</div>
                    </div>
                    <div
                      className="rounded-lg bg-[#f7f8fd] py-1.5"
                      data-tooltip-id={isCrawl ? "dash-tip" : undefined}
                      data-tooltip-content={isCrawl ? "Unique can't be attributed per machine for gdn/native (ads are tagged to the proxy, not the machine)." : undefined}
                    >
                      <div className="text-[15px] font-[700] text-[#7c3aed]">{isCrawl ? "—" : nfmt(cUniq)}</div>
                      <div className="text-[10px] uppercase text-[#9aa2c0]">Unique</div>
                    </div>
                  </div>
                );
              })()}

              {/* row 4: cpu / ram (when Prometheus has it) */}
              {(sys.cpu != null || sys.ram != null) && (
                <div className="mt-3 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-9 text-[11px] text-[#7a83a8]">CPU</span>
                    <MiniBar value={sys.cpu} color="#1f296a" />
                    <span className="w-9 text-right text-[11px] text-[#1f296a]">
                      {sys.cpu != null ? `${sys.cpu}%` : "—"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-9 text-[11px] text-[#7a83a8]">RAM</span>
                    <MiniBar value={sys.ram} color="#7c3aed" />
                    <span className="w-9 text-right text-[11px] text-[#1f296a]">
                      {sys.ram != null ? `${sys.ram}%` : "—"}
                    </span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ===== System drill modal — accounts breakdown ===== */}
      {drillOpen && drillSys && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 transition-all duration-300"
          onClick={() => setDrillOpen(false)}
        >
          <div
            className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-[20px] border border-white/20 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* header */}
            <div className="flex items-start justify-between border-b border-[#eef1fb] px-6 py-4">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-[20px] font-[700] text-[#1f296a]">{drillSys.system_id}</span>
                  <InfoButton onClick={() => setInfoOpen(true)} />
                  <span
                    className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      drillSys.active ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    <span className={`inline-block h-2 w-2 rounded-full ${drillSys.active ? "bg-green-500" : "bg-gray-400"}`} />
                    {drillSys.active ? "Active" : "Idle"}
                  </span>
                  {drillSys.now_rate_per_min > 0 && (
                    <span className="text-[12px] font-semibold text-green-600">▶ {nfmt(drillSys.now_rate_per_min)}/min now</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 text-[12px] text-[#7a83a8]">
                  {drillSys.hostname && <span>{drillSys.hostname}</span>}
                  <span>Last active: <b className="text-[#1f296a]">{agoText(drillSys.last_active_ago_sec)}</b></span>
                  {drillSys.cpu != null && <span>CPU {drillSys.cpu}%</span>}
                  {drillSys.ram != null && <span>RAM {drillSys.ram}%</span>}
                  <span>Window: <b className="text-[#1f296a]">{windowLabel(dashboardSystem?.window) || windowLabel(dashboardOverview?.window)}</b></span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openSystemStatus(drillSys)}
                  className="!rounded-lg !border !border-[#d2dfff] !bg-[#eef2ff] !px-3 !py-1.5 text-[13px] font-medium text-[#1f296a]"
                >
                  Status timeline
                </button>
                <button onClick={() => setDrillOpen(false)} className="text-gray-400 hover:text-gray-600">
                  <svg className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>

            {/* totals */}
            <div className="flex flex-wrap gap-3 px-6 py-3">
              {[
                { l: "Accounts", v: dashboardSystem?.totals?.accounts, c: "#264688" },
                { l: "Live now", v: dashboardSystem?.totals?.live_accounts, c: "#16a34a" },
                { l: "Total Ads", v: dashboardSystem?.totals?.ads, c: "#264688" },
                { l: "Unique Ads", v: dashboardSystem?.totals?.unique_ads, c: "#7c3aed" },
                { l: "Networks", v: dashboardSystem?.totals?.networks, c: "#264688" },
              ].map((t) => (
                <div key={t.l} className="rounded-lg bg-[#f7f8fd] px-4 py-2">
                  <div className="text-[18px] font-[700]" style={{ color: t.c }}>{nfmt(t.v)}</div>
                  <div className="text-[10px] uppercase text-[#9aa2c0]">{t.l}</div>
                </div>
              ))}
            </div>

            {/* account filters */}
            {drillAccounts.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 px-6 pb-1">
                <div className="flex overflow-hidden rounded-lg border border-gray-300 text-[12px]">
                  {[
                    { v: "all", l: "All" },
                    { v: "live", l: "Live" },
                    { v: "idle", l: "Idle" },
                  ].map((o) => (
                    <button
                      key={o.v}
                      onClick={() => setAcctStatus(o.v)}
                      className={`!px-3 !py-1 ${acctStatus === o.v ? "!bg-[#1f296a] !text-white" : "!bg-white !text-[#1f296a]"}`}
                    >
                      {o.l}
                    </button>
                  ))}
                </div>
                {drillNets.length > 1 && (
                  <select
                    value={acctNet}
                    onChange={(e) => setAcctNet(e.target.value)}
                    className="!rounded-lg !border !border-gray-300 !bg-white !px-2 !py-1 text-[12px] text-[#1f296a]"
                  >
                    <option value="all">All networks</option>
                    {drillNets.map((n) => (
                      <option key={n} value={n}>{NETWORK_LABEL[n] || n}</option>
                    ))}
                  </select>
                )}
                {drillCountries.length > 0 && (
                  <select
                    value={acctCountry}
                    onChange={(e) => setAcctCountry(e.target.value)}
                    className="!rounded-lg !border !border-gray-300 !bg-white !px-2 !py-1 text-[12px] text-[#1f296a]"
                  >
                    <option value="all">All countries</option>
                    {drillCountries.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                )}
                <div className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2 py-1">
                  <CiSearch className="h-4 w-4 text-gray-400" />
                  <input
                    value={acctSearch}
                    onChange={(e) => setAcctSearch(e.target.value)}
                    placeholder="Search account / id"
                    className="w-[150px] text-[12px] focus:outline-none"
                  />
                </div>
                <span className="text-[12px] text-[#9aa2c0]">({visibleAccounts.length})</span>
              </div>
            )}

            {/* accounts table */}
            <div className="flex-1 overflow-auto px-6 pb-5">
              {loadingDashboardSystem ? (
                <div className="space-y-2 pt-2">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-9 animate-pulse rounded bg-[#f1f3fb]" />
                  ))}
                </div>
              ) : (dashboardSystem?.accounts?.length || dashboardSystem?.perNetwork?.length || dashboardSystem?.recent?.length) ? (
                <>
                  {drillAccounts.length > 0 && (
                    <table className="w-full text-left text-[13px]">
                      <thead className="sticky top-0 bg-white text-[11px] uppercase text-[#9aa2c0]">
                        <tr className="border-b border-[#eef1fb]">
                          <th className="py-2"><span className="inline-flex items-center gap-1">Account <SourceDot s="db" /></span></th>
                          <th className="py-2"><span className="inline-flex items-center gap-1">Network <SourceDot s="db" /></span></th>
                          <th className="py-2"><span className="inline-flex items-center gap-1">Country <SourceDot s="db" /></span></th>
                          <th className="py-2"><span className="inline-flex items-center gap-1">Status <SourceDot s="prom" /></span></th>
                          <th className="py-2 text-right"><span className="inline-flex items-center gap-1">Ads <SourceDot s="db" /></span></th>
                          <th className="py-2 text-right"><span className="inline-flex items-center gap-1">Unique <SourceDot s="db" /></span></th>
                          <th className="py-2 text-right"><span className="inline-flex items-center gap-1">Last active <SourceDot s="db" /></span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleAccounts.map((a, i) => (
                          <tr
                            key={`${a.network}-${a.account_id}-${i}`}
                            onClick={() => openAccountStatus(a)}
                            className="cursor-pointer border-b border-[#f4f6fc] hover:bg-[#f7f8fd]"
                            data-tooltip-id="dash-tip"
                            data-tooltip-content="Click for account status timeline"
                          >
                            <td className="py-2">
                              <div className="flex flex-col">
                                <span className="font-medium text-[#1f296a] hover:underline">
                                  {a.name || a.account_id || "—"}
                                </span>
                                {a.name && a.account_id && (
                                  <span className="text-[11px] text-gray-400">{a.account_id}</span>
                                )}
                              </div>
                            </td>
                            <td className="py-2">
                              <span className="inline-flex items-center gap-1.5 text-[#7a83a8]">
                                {NETWORK_ICONS[a.network] && (
                                  <img src={NETWORK_ICONS[a.network]} alt="" className="h-4 w-4 rounded-full" />
                                )}
                                {NETWORK_LABEL[a.network] || a.network}
                              </span>
                            </td>
                            <td className="py-2 text-[#7a83a8]">{a.country || "—"}</td>
                            <td className="py-2">
                              <span
                                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                  a.live ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-500"
                                }`}
                              >
                                <span className={`inline-block h-1.5 w-1.5 rounded-full ${a.live ? "bg-green-500 animate-pulse" : "bg-gray-400"}`} />
                                {a.live ? "Live" : "Idle"}
                              </span>
                            </td>
                            <td className="py-2 text-right tabular-nums">{nfmt(a.ads)}</td>
                            <td className="py-2 text-right tabular-nums text-[#7c3aed]">{nfmt(a.unique_ads)}</td>
                            <td className="py-2 text-right text-[#7a83a8]">{agoText(a.last_active_ago_sec)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  {/* system-only networks (no accounts) */}
                  {dashboardSystem?.perNetwork?.some((p) => p.accounts === 0) && (
                    <div className="mt-4">
                      <div className="mb-2 text-[11px] uppercase text-[#9aa2c0]">
                        System-level networks (no per-account split)
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {dashboardSystem.perNetwork.filter((p) => p.accounts === 0).map((p) => (
                          <div key={p.network} className="flex items-center gap-2 rounded-lg border border-[#eef1fb] px-3 py-2 text-[12px]">
                            {NETWORK_ICONS[p.network] && <img src={NETWORK_ICONS[p.network]} alt="" className="h-4 w-4 rounded-full" />}
                            <span className="font-medium text-[#1f296a]">{NETWORK_LABEL[p.network] || p.network}</span>
                            <span className="text-[#7a83a8]">{nfmt(p.ads)} ads · {nfmt(p.unique_ads)} uniq</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 🔴 per-system LIVE feed (youtube): the latest ads THIS machine just processed */}
                  {dashboardSystem?.recent?.length > 0 && (
                    <div className="mt-4 rounded-[12px] border border-[#fde2e2] bg-[#fff7f7]">
                      <div className="flex items-center gap-2 border-b border-[#fde2e2] px-3 py-2 text-[12px] font-semibold text-[#b42318]">
                        <span className="inline-block h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                        Live feed — ads this system just processed (most recent first)
                      </div>
                      <div className="max-h-[240px] overflow-auto">
                        <table className="w-full text-left text-[12px]">
                          <thead className="sticky top-0 bg-[#fff7f7] text-[10px] uppercase text-[#9aa2c0]">
                            <tr className="border-b border-[#fde2e2]">
                              <th className="px-3 py-1.5">When</th><th className="px-3 py-1.5">Ad ID</th>
                              <th className="px-3 py-1.5">Type</th><th className="px-3 py-1.5">Placement</th>
                            </tr>
                          </thead>
                          <tbody>
                            {dashboardSystem.recent.slice(0, 60).map((p, i) => (
                              <tr key={i} className="border-b border-[#fbeaea] hover:bg-[#fff0f0]">
                                <td className="px-3 py-1.5 whitespace-nowrap text-[#7a83a8]">{p.ts ? agoText(Math.max(0, Math.floor(Date.now() / 1000) - p.ts)) : "—"}</td>
                                <td className="px-3 py-1.5 text-[#1f296a]">{p.ad_id}</td>
                                <td className="px-3 py-1.5 text-[#7a83a8]">{p.ad_type || "—"}</td>
                                <td className="px-3 py-1.5 text-[#7a83a8]">{p.ad_position || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="py-10 text-center text-[#9aa2c0]">
                  No account activity for this system in the selected window.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== ALL accounts modal (Accounts / Scraping-Now tiles) ===== */}
      {accountsModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 transition-all duration-300"
          onClick={() => setAccountsModal(false)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-[20px] border border-white/20 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* header */}
            <div className="flex items-start justify-between border-b border-[#eef1fb] px-6 py-4">
              <div className="flex flex-col gap-1">
                <span className="flex items-center gap-2 text-[20px] font-[700] text-[#1f296a]">
                  {allStatus === "scraping" ? "Accounts scraping now" : "All accounts"}
                  <InfoButton onClick={() => setInfoOpen(true)} />
                </span>
                <span className="text-[12px] text-[#9aa2c0]">
                  Realtime · {windowLabel(dashboardAccounts?.window) || windowLabel(dashboardOverview?.window)}
                </span>
              </div>
              <button onClick={() => setAccountsModal(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>

            {/* totals */}
            <div className="flex flex-wrap gap-3 px-6 py-3">
              {[
                { l: "Accounts", v: dashboardAccounts?.totals?.accounts, c: "#264688" },
                { l: "Live now", v: dashboardAccounts?.totals?.live, c: "#16a34a" },
                { l: "Scraping now", v: dashboardAccounts?.totals?.scraping, c: "#16a34a" },
                { l: "Total Ads", v: dashboardAccounts?.totals?.ads, c: "#264688" },
                { l: "Unique Ads", v: dashboardAccounts?.totals?.unique_ads, c: "#7c3aed" },
              ].map((t) => (
                <div key={t.l} className="rounded-lg bg-[#f7f8fd] px-4 py-2">
                  <div className="text-[18px] font-[700]" style={{ color: t.c }}>{nfmt(t.v)}</div>
                  <div className="text-[10px] uppercase text-[#9aa2c0]">{t.l}</div>
                </div>
              ))}
            </div>

            {/* filters */}
            <div className="flex flex-wrap items-center gap-2 px-6 pb-2">
              <div className="flex overflow-hidden rounded-lg border border-gray-300 text-[12px]">
                {[
                  { v: "all", l: "All" },
                  { v: "live", l: "Live" },
                  { v: "idle", l: "Idle" },
                  { v: "scraping", l: "Scraping" },
                ].map((o) => (
                  <button
                    key={o.v}
                    onClick={() => setAllStatus(o.v)}
                    className={`!px-3 !py-1 ${allStatus === o.v ? "!bg-[#1f296a] !text-white" : "!bg-white !text-[#1f296a]"}`}
                  >
                    {o.l}
                  </button>
                ))}
              </div>
              <select
                value={allNet}
                onChange={(e) => setAllNet(e.target.value)}
                className="!rounded-lg !border !border-gray-300 !bg-white !px-2 !py-1 text-[12px] text-[#1f296a]"
              >
                <option value="all">All networks</option>
                {(dashboardAccounts?.facets?.networks || []).map((n) => (
                  <option key={n} value={n}>{NETWORK_LABEL[n] || n}</option>
                ))}
              </select>
              <select
                value={allCountry}
                onChange={(e) => setAllCountry(e.target.value)}
                className="!rounded-lg !border !border-gray-300 !bg-white !px-2 !py-1 text-[12px] text-[#1f296a]"
              >
                <option value="all">All countries</option>
                {(dashboardAccounts?.facets?.countries || []).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <select
                value={allSystem}
                onChange={(e) => setAllSystem(e.target.value)}
                className="!rounded-lg !border !border-gray-300 !bg-white !px-2 !py-1 text-[12px] text-[#1f296a]"
              >
                <option value="all">All systems</option>
                {(dashboardAccounts?.facets?.systems || []).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <div className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2 py-1">
                <CiSearch className="h-4 w-4 text-gray-400" />
                <input
                  value={allSearch}
                  onChange={(e) => setAllSearch(e.target.value)}
                  placeholder="Search account / id / system"
                  className="w-[180px] text-[12px] focus:outline-none"
                />
              </div>
              <span className="text-[12px] text-[#9aa2c0]">({visibleAllAccounts.length})</span>
            </div>

            {/* ===== graphical view (Grafana-style) ===== */}
            {(accountCharts.topSystems.length > 0 || accountCharts.byNetwork.length > 0) && (
              <div className="px-6 pb-2">
                <div className="mb-2 flex items-center gap-2 text-[12px] text-[#9aa2c0]">
                  <span className="inline-block h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                  Graphical view —{" "}
                  <b className="text-[#7a83a8]">
                    {accountCharts.rateMode ? "live scrape rate (/min)" : "ads in window"}
                  </b>
                </div>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                  {/* top systems */}
                  <div className="rounded-[12px] border border-[#eef1fb] bg-white p-3">
                    <div className="mb-1 text-[12px] font-semibold text-[#1f296a]">Top systems</div>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={accountCharts.topSystems} layout="vertical" margin={{ left: 8, right: 16 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#eef1fb" />
                        <XAxis type="number" tick={{ fontSize: 11, fill: "#9aa2c0" }} />
                        <YAxis type="category" dataKey="name" width={70} tick={{ fontSize: 11, fill: "#7a83a8" }} />
                        <RTooltip formatter={(v) => [`${nfmt(v)}${accountCharts.unit}`, "value"]} />
                        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                          {accountCharts.topSystems.map((_, i) => (
                            <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* top accounts */}
                  <div className="rounded-[12px] border border-[#eef1fb] bg-white p-3">
                    <div className="mb-1 text-[12px] font-semibold text-[#1f296a]">Top accounts</div>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={accountCharts.topAccounts} layout="vertical" margin={{ left: 8, right: 16 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#eef1fb" />
                        <XAxis type="number" tick={{ fontSize: 11, fill: "#9aa2c0" }} />
                        <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11, fill: "#7a83a8" }}
                          tickFormatter={(v) => (String(v).length > 12 ? String(v).slice(0, 12) + "…" : v)} />
                        <RTooltip formatter={(v) => [`${nfmt(v)}${accountCharts.unit}`, "value"]} />
                        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                          {accountCharts.topAccounts.map((d, i) => (
                            <Cell key={i} fill={NETWORK_COLORS[d.network] || CHART_PALETTE[i % CHART_PALETTE.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* by network donut */}
                  <div className="rounded-[12px] border border-[#eef1fb] bg-white p-3">
                    <div className="mb-1 text-[12px] font-semibold text-[#1f296a]">By network</div>
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie data={accountCharts.byNetwork} dataKey="value" nameKey="name"
                          innerRadius={45} outerRadius={75} paddingAngle={2}>
                          {accountCharts.byNetwork.map((d, i) => (
                            <Cell key={i} fill={NETWORK_COLORS[d.key] || CHART_PALETTE[i % CHART_PALETTE.length]} />
                          ))}
                        </Pie>
                        <RTooltip formatter={(v, n) => [`${nfmt(v)}${accountCharts.unit}`, n]} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}

            {/* table */}
            <div className="flex-1 overflow-auto px-6 pb-5">
              {loadingDashboardAccounts && !allAccounts.length ? (
                <div className="space-y-2 pt-2">
                  {[...Array(8)].map((_, i) => (
                    <div key={i} className="h-9 animate-pulse rounded bg-[#f1f3fb]" />
                  ))}
                </div>
              ) : visibleAllAccounts.length === 0 ? (
                <div className="py-10 text-center text-[#9aa2c0]">No accounts match these filters.</div>
              ) : (
                <table className="w-full text-left text-[13px]">
                  <thead className="sticky top-0 bg-white text-[11px] uppercase text-[#9aa2c0]">
                    <tr className="border-b border-[#eef1fb]">
                      <th className="py-2"><span className="inline-flex items-center gap-1">Account <SourceDot s="db" /></span></th>
                      <th className="py-2"><span className="inline-flex items-center gap-1">Network <SourceDot s="db" /></span></th>
                      <th className="py-2"><span className="inline-flex items-center gap-1">Country <SourceDot s="db" /></span></th>
                      <th className="py-2"><span className="inline-flex items-center gap-1">System <SourceDot s="db" /></span></th>
                      <th className="py-2"><span className="inline-flex items-center gap-1">Status <SourceDot s="prom" /></span></th>
                      <th className="py-2 text-right"><span className="inline-flex items-center gap-1">Ads <SourceDot s="db" /></span></th>
                      <th className="py-2 text-right"><span className="inline-flex items-center gap-1">Unique <SourceDot s="db" /></span></th>
                      <th className="py-2 text-right"><span className="inline-flex items-center gap-1">Last active <SourceDot s="db" /></span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleAllAccounts.map((a, i) => (
                      <tr
                        key={`${a.network}-${a.account_id}-${a.system_id}-${i}`}
                        onClick={() => openAccountStatus(a)}
                        className="cursor-pointer border-b border-[#f4f6fc] hover:bg-[#f7f8fd]"
                        data-tooltip-id="dash-tip"
                        data-tooltip-content="Click for account status timeline"
                      >
                        <td className="py-2">
                          <div className="flex flex-col">
                            <span className="font-medium text-[#1f296a] hover:underline">{a.name || a.account_id || "—"}</span>
                            {a.name && a.account_id && (
                              <span className="text-[11px] text-gray-400">{a.account_id}</span>
                            )}
                          </div>
                        </td>
                        <td className="py-2">
                          <span className="inline-flex items-center gap-1.5 text-[#7a83a8]">
                            {NETWORK_ICONS[a.network] && <img src={NETWORK_ICONS[a.network]} alt="" className="h-4 w-4 rounded-full" />}
                            {NETWORK_LABEL[a.network] || a.network}
                          </span>
                        </td>
                        <td className="py-2 text-[#7a83a8]">{a.country || "—"}</td>
                        <td className="py-2 font-medium text-[#264688]">{a.system_id || "—"}</td>
                        <td className="py-2">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                a.live ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-500"
                              }`}
                            >
                              <span className={`inline-block h-1.5 w-1.5 rounded-full ${a.live ? "bg-green-500 animate-pulse" : "bg-gray-400"}`} />
                              {a.live ? "Live" : "Idle"}
                            </span>
                            {a.now_rate_per_min > 0 && (
                              <span className="text-[11px] font-semibold text-green-600">▶ {nfmt(a.now_rate_per_min)}/min</span>
                            )}
                          </div>
                        </td>
                        <td className="py-2 text-right tabular-nums">{nfmt(a.ads)}</td>
                        <td className="py-2 text-right tabular-nums text-[#7c3aed]">{nfmt(a.unique_ads)}</td>
                        <td className="py-2 text-right text-[#7a83a8]">{agoText(a.last_active_ago_sec)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== System status timeline modal (existing component) ===== */}
      {statusModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm transition-all duration-300"
          onClick={() => setStatusModal(false)}
        >
          <div
            className="flex h-[400px] w-full max-w-7xl items-center justify-center overflow-auto rounded-[20px] border border-white/20 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <TimeChart
              StatusSystemInfo={StatusSystemInfo}
              loadingStatusSystemInfo={loadingStatusSystemInfo}
              dateRange1={dateRange}
              onClose={() => setStatusModal(false)}
              onStageClick={() => {}}
            />
          </div>
        </div>
      )}

      {/* ===== Account status timeline modal (existing component) ===== */}
      {acctModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm transition-all duration-300"
          onClick={() => setAcctModal(false)}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-7xl flex-col overflow-auto rounded-[20px] border border-white/20 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {acctModalName && (
              <div className="px-6 pt-4 text-[13px] text-[#7a83a8]">
                Account: <b className="text-[#1f296a]">{acctModalName}</b>
              </div>
            )}
            <ModalAccountStatusInfo
              AccountInfo={dashboardAccountTimeline}
              loadingStatusAccountInfo={loadingDashboardAccountTimeline}
              dateRange1={dateRange}
              onClose={() => setAcctModal(false)}
              onStageClick={() => {}}
            />
            {dashboardAccountTimeline?.empty && (
              <div className="mx-6 mb-4 rounded-lg border border-[#ffe0b3] bg-[#fff8e6] px-4 py-3 text-[12px] text-[#8a6d1a]">
                <div className="mb-1 font-semibold">Why is this empty?</div>
                <div>{dashboardAccountTimeline.reason || "No heartbeat data in the selected window."}</div>
                {dashboardAccountTimeline.servers?.length > 0 && (
                  <div className="mt-1 text-[#7a83a8]">Heartbeat seen on: {dashboardAccountTimeline.servers.join(", ")}</div>
                )}
                {showRawQ && dashboardAccountTimeline.query && (
                  <code className="mt-2 block whitespace-pre-wrap break-all text-[11px] text-[#7a83a8]">{dashboardAccountTimeline.query}</code>
                )}
                <button onClick={() => setShowRawQ((v) => !v)} className="mt-2 text-[11px] font-medium text-[#1f296a] underline">
                  {showRawQ ? "Hide" : "Show"} Prometheus query
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== GDN / Native scraping-benchmark modal ===== */}
      {benchOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 transition-all duration-300"
          onClick={() => setBenchOpen(false)}
        >
          <div
            className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[20px] border border-white/20 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* header */}
            <div className="flex items-start justify-between border-b border-[#eef1fb] px-6 py-4">
              <div className="flex flex-col gap-1">
                <span className="flex items-center gap-2 text-[20px] font-[700] text-[#1f296a]">
                  {gdnBenchmark?.scope === "host" ? `System · ${gdnBenchmark.system_id}` : "GDN / Native Scraping Benchmark"}
                  {gdnBenchmark?.live && (
                    <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      gdnBenchmark.live.status === "running" ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-500"}`}>
                      <span className={`inline-block h-2 w-2 rounded-full ${gdnBenchmark.live.status === "running" ? "bg-green-500 animate-pulse" : "bg-gray-400"}`} />
                      {gdnBenchmark.live.status || "—"}
                    </span>
                  )}
                </span>
                <span className="text-[12px] text-[#9aa2c0]">
                  {gdnBenchmark?.scope === "host" ? (
                    <>System (proxmox machine): <b className="text-[#7a83a8]">{gdnBenchmark.system_id}</b> · GDN + Native crawl · direct DB</>
                  ) : (
                    <>ISP/Proxy: <b className="text-[#7a83a8]">{gdnBenchmark?.system_id || "decodo-isp"}</b> (not a system) · systems = machines below · direct DB</>
                  )}
                  {gdnBenchmark?.live?.country ? ` · ${gdnBenchmark.live.country}` : ""}
                </span>
              </div>
              <button onClick={() => setBenchOpen(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-auto px-6 py-4">
              {loadingGdnBenchmark && !gdnBenchmark ? (
                <div className="space-y-2">{[...Array(6)].map((_, i) => <div key={i} className="h-10 animate-pulse rounded bg-[#f1f3fb]" />)}</div>
              ) : !gdnBenchmark ? (
                <div className="py-10 text-center text-[#9aa2c0]">No benchmark data.</div>
              ) : (() => {
                const ov = gdnBenchmark.overview || {};
                const lv = gdnBenchmark.live || {};
                const t = ov.totals || {};
                const tp = ov.throughput || {};
                const sp = ov.split || {};
                const Tile = ({ l, v, c = "#264688" }) => (
                  <div className="rounded-lg bg-[#f7f8fd] px-4 py-2">
                    <div className="text-[18px] font-[700]" style={{ color: c }}>{nfmt(v)}</div>
                    <div className="text-[10px] uppercase text-[#9aa2c0]">{l}</div>
                  </div>
                );
                return (
                  <div className="flex flex-col gap-4">
                    {/* tiles */}
                    <div className="flex flex-wrap gap-3">
                      <Tile l="GDN creatives" v={t.gtot} />
                      <Tile l="Native creatives" v={t.ntot} c="#0ea5e9" />
                      <Tile l="GDN ads /24h" v={t.ah24} c="#16a34a" />
                      <Tile l="URLs crawled" v={t.urls} />
                      <Tile l="Countries" v={t.ccs} />
                      <Tile l="Advertisers" v={t.advertisers} c="#7c3aed" />
                      <Tile l="GDN new (live)" v={lv.gdn_new} c="#16a34a" />
                      <Tile l="Native new (live)" v={lv.native_new} c="#16a34a" />
                    </div>

                    {/* live + throughput strip */}
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div className="rounded-[12px] border border-[#eef1fb] p-3 text-[12px] text-[#7a83a8]">
                        <div className="mb-1 text-[12px] font-semibold text-[#1f296a]">Live session</div>
                        <div>Mode: <b className="text-[#1f296a]">{lv.mode || "—"}</b></div>
                        <div>Done / pool: <b className="text-[#1f296a]">{nfmt(lv.done)}</b> / {nfmt(lv.pool)}</div>
                        <div>Today new: <b className="text-[#1f296a]">{nfmt(gdnBenchmark.today_new)}</b> · ads/hr: <b className="text-[#1f296a]">{nfmt(gdnBenchmark.ads_hr)}</b> (gdn {nfmt(gdnBenchmark.gdn_hr)} / native {nfmt(gdnBenchmark.native_hr)})</div>
                        {gdnBenchmark.fleet?.text && <div className="mt-1 text-[#16a34a]">{gdnBenchmark.fleet.text}</div>}
                      </div>
                      <div className="rounded-[12px] border border-[#eef1fb] p-3 text-[12px] text-[#7a83a8]">
                        <div className="mb-1 text-[12px] font-semibold text-[#1f296a]">Throughput / split</div>
                        <div>GDN new: <b className="text-[#1f296a]">{nfmt(tp.fg_hr)}</b>/hr · <b className="text-[#1f296a]">{nfmt(tp.fg_day)}</b>/day</div>
                        <div>Native new: <b className="text-[#1f296a]">{nfmt(tp.fn_hr)}</b>/hr · <b className="text-[#1f296a]">{nfmt(tp.fn_day)}</b>/day</div>
                        <div>Observed: gdn <b className="text-[#1f296a]">{nfmt(sp.g_obs)}</b> · native <b className="text-[#1f296a]">{nfmt(sp.n_obs)}</b></div>
                      </div>
                    </div>

                    {/* 🔴 LIVE feed — which URLs are being crawled right now (most recent first) */}
                    <div className="rounded-[12px] border border-[#fde2e2] bg-[#fff7f7]">
                      <div className="flex items-center gap-2 border-b border-[#fde2e2] px-3 py-2 text-[12px] font-semibold text-[#b42318]">
                        <span className="inline-block h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                        Live feed — URLs being processed now {gdnBenchmark?.scope === "host" ? `(${gdnBenchmark.system_id})` : ""}
                        <span className="font-normal text-[#9aa2c0]">· most recent first</span>
                      </div>
                      <div className="max-h-[260px] overflow-auto">
                        {(gdnBenchmark.pages || []).length === 0 ? (
                          <div className="px-3 py-6 text-center text-[12px] text-[#9aa2c0]">No crawl activity in this window.</div>
                        ) : (
                          <table className="w-full text-left text-[12px]">
                            <thead className="sticky top-0 bg-[#fff7f7] text-[10px] uppercase text-[#9aa2c0]">
                              <tr className="border-b border-[#fde2e2]">
                                <th className="px-3 py-1.5">When</th><th className="px-3 py-1.5">Site</th>
                                <th className="px-3 py-1.5">URL</th><th className="px-3 py-1.5">Cc</th><th className="px-3 py-1.5">OS</th>
                                <th className="px-3 py-1.5 text-right">GDN</th><th className="px-3 py-1.5 text-right">Native</th>
                                <th className="px-3 py-1.5">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(gdnBenchmark.pages || []).slice(0, 60).map((p, i) => (
                                <tr key={i} className="border-b border-[#fbeaea] hover:bg-[#fff0f0]">
                                  <td className="px-3 py-1.5 whitespace-nowrap text-[#7a83a8]">{p.ts ? agoText(Math.max(0, Math.floor(Date.now() / 1000) - p.ts)) : "—"}</td>
                                  <td className="px-3 py-1.5 text-[#1f296a]">{p.site || "—"}</td>
                                  <td className="px-3 py-1.5 max-w-[280px] truncate text-[#7a83a8]" title={p.url}>{p.url || "—"}</td>
                                  <td className="px-3 py-1.5 text-[#7a83a8]">{p.cc || "—"}</td>
                                  <td className="px-3 py-1.5 text-[#7a83a8]">{p.os || "—"}</td>
                                  <td className="px-3 py-1.5 text-right tabular-nums text-[#16a34a]">{p.n_gdn == null ? "—" : nfmt(p.n_gdn)}</td>
                                  <td className="px-3 py-1.5 text-right tabular-nums text-[#0ea5e9]">{p.n_native == null ? "—" : nfmt(p.n_native)}</td>
                                  <td className="px-3 py-1.5">
                                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                                      (p.n_total || 0) > 0 ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-500"}`}>
                                      {p.status || ((p.n_total || 0) > 0 ? "hit" : "zero")}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>

                    {/* tables */}
                    <BenchTable title="Providers" rows={ov.providers} cols={[["provider","Provider"],["urls","URLs",1],["countries","Cc",1],["gdn","GDN",1],["native","Native",1],["zero_urls","0-ad",1]]} />
                    <BenchTable title="Machines = Systems (proxmox)" rows={ov.machines} cols={[["host","System (host)"],["os","OS"],["urls","URLs",1],["gdn","GDN",1],["native","Native",1],["hit","Hit",1]]} />
                    <BenchTable title="Native networks" rows={ov.networks} cols={[["network","Network"],["creatives","Creatives",1]]} />
                    <BenchTable title="Top countries" rows={ov.countries} cols={[["country","Country"],["urls","URLs",1],["gdn","GDN",1],["nat","Native",1]]} limit={12} />
                    <BenchTable title="Top sites" rows={ov.sites} cols={[["site","Site"],["urls","URLs",1],["ads","Ads",1]]} limit={12} />
                    <BenchTable title="Top advertisers" rows={ov.advertisers} cols={[["post_owner_name","Advertiser"],["ads_count","Ads",1]]} limit={12} />
                    <BenchTable title={`Proxy quality (${nfmt(ov.proxy_quality?.totals?.ips)} IPs · ${nfmt(ov.proxy_quality?.totals?.ads)} ads)`} rows={ov.proxy_quality?.rows} cols={[["country","Country"],["ips","IPs",1],["used","Used",1],["ads","Ads",1],["urls","URLs",1]]} limit={12} />
                    <BenchTable title={`0-ad URLs (${nfmt(ov.zero_urls?.count)})`} rows={ov.zero_urls?.rows} cols={[["site","Site"],["country","Cc"],["os","OS"],["zero_streak","Streak",1]]} limit={12} />
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ===== YouTube monitoring-benchmark modal (ElasticSearch) ===== */}
      {ytOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 transition-all duration-300"
          onClick={() => setYtOpen(false)}
        >
          <div
            className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[20px] border border-white/20 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-[#eef1fb] px-6 py-4">
              <div className="flex flex-col gap-1">
                <span className="flex items-center gap-2 text-[20px] font-[700] text-[#1f296a]">
                  YouTube Monitoring Benchmark
                  {ytBenchmark?.live && (
                    <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      ytBenchmark.live.status === "running" ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-500"}`}>
                      <span className={`inline-block h-2 w-2 rounded-full ${ytBenchmark.live.status === "running" ? "bg-green-500 animate-pulse" : "bg-gray-400"}`} />
                      {ytBenchmark.live.status || "—"}
                    </span>
                  )}
                </span>
                <span className="text-[12px] text-[#9aa2c0]">
                  Live: <b className="text-[#7a83a8]">{ytBenchmark?.live_source === "crawler" ? "crawler feed (real-time)" : "ElasticSearch"}</b>
                  {" · "}overview: ES index <b className="text-[#7a83a8]">{ytBenchmark?.index || "youtube_ads_data"}</b>
                </span>
              </div>
              <button onClick={() => setYtOpen(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-auto px-6 py-4">
              {loadingYtBenchmark && !ytBenchmark ? (
                <div className="space-y-2">{[...Array(6)].map((_, i) => <div key={i} className="h-10 animate-pulse rounded bg-[#f1f3fb]" />)}</div>
              ) : !ytBenchmark ? (
                <div className="py-10 text-center text-[#9aa2c0]">No YouTube data.</div>
              ) : (() => {
                const ov = ytBenchmark.overview || {};
                const lv = ytBenchmark.live || {};
                const t = ov.totals || {};
                const u = ov.unique || {};
                const Tile = ({ l, v, c = "#264688", suf = "" }) => (
                  <div className="rounded-lg bg-[#f7f8fd] px-4 py-2">
                    <div className="text-[18px] font-[700]" style={{ color: c }}>{v == null ? "—" : nfmt(v)}{suf}</div>
                    <div className="text-[10px] uppercase text-[#9aa2c0]">{l}</div>
                  </div>
                );
                return (
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-wrap gap-3">
                      <Tile l="Total ads (ES)" v={t.total} />
                      <Tile l="Ads · 1h" v={t.ads_1h} c="#16a34a" />
                      <Tile l="Ads · 24h" v={t.ads_24h} c="#16a34a" />
                      <Tile l="Findable" v={t.shown_pct} suf="%" c="#7c3aed" />
                      <Tile l="Redirect chain" v={ov.redirect_chain?.pct} suf="%" c="#0ea5e9" />
                      <Tile l="Multi-hop (live)" v={lv.multi_hop} c="#ff7f0e" />
                    </div>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div className="rounded-[12px] border border-[#eef1fb] p-3 text-[12px] text-[#7a83a8]">
                        <div className="mb-1 text-[12px] font-semibold text-[#1f296a]">Unique vs duplicate</div>
                        <div>1h: new <b className="text-[#16a34a]">{nfmt(u.new_1h)}</b> · dup <b className="text-[#1f296a]">{nfmt(u.dup_1h)}</b></div>
                        <div>24h: new <b className="text-[#16a34a]">{nfmt(u.new_24h)}</b> · dup <b className="text-[#1f296a]">{nfmt(u.dup_24h)}</b></div>
                      </div>
                      <div className="rounded-[12px] border border-[#eef1fb] p-3 text-[12px] text-[#7a83a8]">
                        <div className="mb-1 text-[12px] font-semibold text-[#1f296a]">Live activity (last_seen)</div>
                        <div>1h <b className="text-[#1f296a]">{nfmt(lv.ads_1h)}</b> · 3h <b className="text-[#1f296a]">{nfmt(lv.ads_3h)}</b> · 24h <b className="text-[#1f296a]">{nfmt(lv.ads_24h)}</b></div>
                        <div>new 1h/3h/24h: <b className="text-[#16a34a]">{nfmt(lv.new_1h)}</b> / {nfmt(lv.new_3h)} / {nfmt(lv.new_24h)}</div>
                      </div>
                    </div>

                    <BenchTable title="By ad type (all-time)" rows={ov.by_type} cols={[["type","Type"],["count","Ads",1]]} limit={15} />
                    <BenchTable title="By placement (all-time)" rows={ov.by_position} cols={[["position","Placement"],["count","Ads",1]]} limit={20} />
                    <BenchTable title="By type · 1h vs 24h" rows={ov.by_type_win} cols={[["type","Type"],["h1","1h",1],["d1","24h",1]]} limit={15} />
                    <BenchTable title="By placement · 1h vs 24h" rows={ov.by_position_win} cols={[["position","Placement"],["h1","1h",1],["d1","24h",1]]} limit={20} />
                    <BenchTable title={`Recent ads (multi-hop: ${nfmt(lv.multi_hop)})`} rows={ytBenchmark.pages} cols={[["advertiser","Advertiser"],["ad_type","Type"],["ad_position","Placement"],["hops","Hops",1]]} limit={25} />
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ===== System Info assistant — free-text chat bot (no AI) ===== */}
      {infoOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 transition-all duration-300"
          onClick={() => setInfoOpen(false)}
        >
          <div
            className="flex h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-[20px] border border-white/20 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* header */}
            <div className="flex items-center justify-between border-b border-[#eef1fb] px-5 py-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#1f296a] text-[16px]">💬</span>
                <div className="flex flex-col">
                  <span className="text-[15px] font-[700] text-[#1f296a]">System Info Assistant</span>
                  <span className="flex items-center gap-1 text-[11px] text-[#9aa2c0]">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
                    Ask anything · instant answers (no AI)
                  </span>
                </div>
              </div>
              <button onClick={() => setInfoOpen(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>

            {/* conversation */}
            <div className="flex-1 overflow-auto bg-[#f7f8fd] px-4 py-4">
              <div className="flex flex-col gap-3">
                {chatLog.map((m, i) => (
                  <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    {m.role === "bot" && (
                      <span className="mr-2 mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-full bg-[#1f296a] text-[13px]">💬</span>
                    )}
                    <div className={`max-w-[78%] whitespace-pre-line rounded-[14px] px-3.5 py-2 text-[13px] leading-relaxed shadow-sm ${
                      m.role === "user" ? "rounded-br-sm bg-[#1f296a] text-white" : "rounded-bl-sm border border-[#e6e9f5] bg-white text-[#33405f]"
                    }`}>
                      {m.text}
                    </div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
            </div>

            {/* input */}
            <div className="flex items-center gap-2 border-t border-[#eef1fb] bg-white px-4 py-3">
              <input
                autoFocus
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); askBot(); } }}
                placeholder="Ask anything… e.g. why don't the ad counts match?"
                className="flex-1 rounded-full border border-gray-300 px-4 py-2 text-[13px] focus:border-[#1f296a] focus:outline-none"
              />
              <button
                onClick={() => askBot()}
                disabled={!chatInput.trim()}
                className="flex-none rounded-full bg-[#1f296a] px-4 py-2 text-[13px] font-medium text-white hover:bg-[#16205a] disabled:opacity-40"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Debug / data-lineage modal ===== */}
      {debugOpen && debugSys && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 transition-all duration-300"
          onClick={() => setDebugOpen(false)}
        >
          <div
            className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-[20px] border border-white/20 bg-[#0f1424] text-[#d7def5] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-white/10 px-6 py-4">
              <div className="flex flex-col gap-1">
                <span className="flex items-center gap-2 text-[18px] font-[700] text-white">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-green-500 animate-pulse" />
                  Live trace · {debugSys.system_id}
                </span>
                <span className="text-[12px] text-[#8b95bf]">
                  Where & how each value was fetched — step by step (raw queries hidden)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowRawQ((v) => !v)}
                  className="rounded-md border border-white/15 px-2 py-1 text-[12px] text-[#b9c2e6] hover:bg-white/10"
                >
                  {showRawQ ? "Hide" : "Show"} raw queries
                </button>
                <button onClick={() => setDebugOpen(false)} className="text-[#8b95bf] hover:text-white">
                  <svg className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto px-6 py-4 font-mono text-[13px]">
              {loadingSystemDebug && !systemDebug?.steps ? (
                <div className="flex items-center gap-2 text-[#8b95bf]">
                  <span className="inline-block h-2 w-2 animate-ping rounded-full bg-green-500" /> running queries…
                </div>
              ) : systemDebug?.error ? (
                <div className="text-red-400">Trace failed: {String(systemDebug.error)}</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {(systemDebug?.steps || []).slice(0, debugReveal).map((st) => {
                    const sc = st.source === "prom" ? "prom" : st.source === "db" ? "db" : "both";
                    const statusColor =
                      st.status === "ok" ? "text-green-400" :
                      st.status === "warn" ? "text-yellow-400" :
                      st.status === "error" ? "text-red-400" : "text-[#8b95bf]";
                    return (
                      <div key={st.n} className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                        <div className="flex items-start gap-2">
                          <span className={`mt-0.5 ${statusColor}`}>
                            {st.status === "ok" ? "✓" : st.status === "warn" ? "!" : st.status === "error" ? "✕" : "›"}
                          </span>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-white">{st.title}</span>
                              <SourceDot s={sc} />
                              <span className="text-[10px] text-[#5f6a93]">+{st.at_ms}ms</span>
                            </div>
                            {st.detail && <div className="mt-0.5 text-[12px] text-[#b9c2e6]">{st.detail}</div>}
                            {showRawQ && st.query && (
                              <code className="mt-1 block whitespace-pre-wrap break-all rounded bg-black/40 px-2 py-1 text-[11px] text-[#7fd1b9]">
                                {st.query}
                              </code>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {debugReveal < (systemDebug?.steps?.length || 0) && (
                    <div className="flex items-center gap-2 pl-1 text-[#8b95bf]">
                      <span className="inline-block h-2 w-2 animate-ping rounded-full bg-green-500" /> …
                    </div>
                  )}
                  {systemDebug?.steps && debugReveal >= systemDebug.steps.length && (
                    <div className="mt-1 border-t border-white/10 pt-2 text-[12px] text-[#8b95bf]">
                      Done in {systemDebug.total_ms}ms · found in: {systemDebug.networks_found?.join(", ") || "—"}
                      {systemDebug.hosts?.length ? ` · hostname: ${systemDebug.hosts.join(", ")}` : " · no hostname"}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <Tooltip
        id="dash-tip"
        place="top"
        effect="solid"
        className="z-50 !rounded-[20px] !bg-[#d2dfff] !text-[13px] !text-[#1f296a]"
        delayShow={300}
      />
    </div>
  );
};

export default CrawlerDashboard;
