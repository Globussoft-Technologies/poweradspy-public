# System-Info Crawler Dashboard — Manifest (as built)

Grafana-style admin **System Info** tab: fleet overview → per-network → per-system →
per-account, fully clickable, live auto-refresh, every value tagged with its data
source. Additive only — **no existing endpoint/query was modified.**

- Frontend: `react_admin/.../pages/user/CrawlerDashboard.jsx` (the whole tab;
  `SystemInfo.jsx` just renders it). Old table UI preserved in git history.
- Backend: `admin_panel_backend/src/system-dashboard.js`, mounted in
  `routes/system-metrics-api.js`. Read-only, node-cache, fail-safe per source.

---

## 1. Data sources (verified on prod, 2026-06-18)

| Value | Source | How |
|-------|--------|-----|
| **Total Ads** (header + per-network) | MySQL `<net>_ad` | `COUNT(id) WHERE last_seen` in window — **reuses Crawler Insight's `/network-name/get-count` (`dynamicCountFilter`, metric=range)** so numbers match exactly |
| **Unique Ads** (header + per-network) | MySQL `<net>_ad` | `COUNT(id) WHERE first_seen` in window. With a **platform filter** → metric=platform: `COUNT() FROM platform-table WHERE created in window AND platform IN(...)` |
| System name (`PAS####`/`GLB###`/`decodo-isp`) | MySQL | raw `<net>_accounts_activities.system_id` (not derived) |
| Machine hostname (`GBSBHL####-PC`) | Prometheus | `scroll_plugin_counter_total.server_name`, bridged via shared `account_id` |
| Accounts / Account ID | MySQL | `<net>_accounts_activities` (`COUNT(DISTINCT account_id)`) |
| Account name / Country | MySQL | `<net>_users` (`name`/username, `current_country`/`country`) |
| Per-system Ads (card) | MySQL | `<net>_accounts_activities` COUNT in window (activity — ad table can't attribute per-system; will NOT sum to the network total) |
| Last active / "X ago" | MySQL | `MAX(created_at)` in activities |
| Active / Idle | DB + Prometheus | heartbeat OR scraping-now OR DB last-activity ≤ 10 min |
| Live now / Scraping ▶/min | Prometheus | `increase(account_active_hb_total[120s])` / `rate(scroll_plugin_counter_total[2m])×60` |
| CPU% / RAM% | Prometheus | `cpu_utilization` / `ram_utilization` (per host) |
| System/Account status timeline | Prometheus | `account_active_hb_total` (account-timeline filters by `account_id` only — server_name labels differ across metrics) |

Reused config (imported, not duplicated): `dynamic-count-analytics.js` `DB_DATA`
(main table, `first_seen`, `created`, `db_id`, gdnQuirk), `db-query-metrics.js`
`adCountAcrossSelectedNetworks` (account→system bridge).

**Network key map:** dashboard `gtext` → dynamic-count `google`.

### env
- `PROMETHEUS_URL=https://prometheus.poweradspy.ai`
- `SEND_METRICS_URL=https://send-metrics.poweradspy.ai/metrics` (raw exposition, used
  only by the exporter-health endpoint — NOT for dashboard numbers).

---

## 2. Backend endpoints (`/admin-panel/system-metrics/`)

1. `POST /dashboard/overview` `{range, platform?, activeWindowMin?}` — fleet totals,
   per-network cards (ads/unique = get-count match), per-system rows
   (status/last-active/accounts/cpu/ram/now-rate). Cache 20s (live refresh).
2. `POST /dashboard/system` `{system_id, range, platform?}` — per-account breakdown
   (name/country/live/ads/unique/last-active) + system-only network summary.
3. `POST /dashboard/accounts` `{range, platform?}` — ALL accounts across the fleet
   (name, country, network, **system_id**, live, scrape-rate-now, ads/unique). Drives
   the Accounts + Scraping-Now tiles. Returns `facets` (networks/countries/systems).
4. `POST /dashboard/account-timeline` `{account_id, range}` — active/inactive timeline
   by `account_id` (reliable; on empty returns the **exact reason**).
5. `POST /dashboard/platforms` — distinct platform values present (last 7 days) → filter.
6. `POST /dashboard/system-debug` `{system_id, range}` — step-by-step data-lineage trace
   (which table/Prometheus query gave each value; raw queries included, hidden by default).
7. `GET  /dashboard/exporter-health` — send-metrics reachability + raw snapshot (separate
   from overview so it never slows the poll).

---

## 3. Frontend (`CrawlerDashboard.jsx`)

- Header: title, **Live** auto-refresh (Off/10s/30s/1m) + manual refresh + "updated Xs
  ago", metrics-source health chip, **date-range calendar** (preserved), **platform
  filter** (dynamic — all platforms), **data-source legend (D/P/B) + Info "i" button**.
- KPI tiles (clickable → filter/sort the grid + scroll): Total Systems, Active Now,
  Inactive, Scraping Now, Accounts (→ all-accounts modal), Total Ads, Unique Ads, Networks.
  Each tile carries a **source dot**.
- Per-network cards (click = filter). Systems card grid: status dot, ▶/min, last-active,
  network icons, accounts/ads/unique, CPU/RAM bars, **per-value "i" + "debug" button**.
- Drill modal (system → accounts): filters (live/idle, network, country, search),
  clickable account rows → account status timeline.
- All-accounts modal: Grafana charts (recharts — top systems / top accounts / by-network)
  + filters (status/network/country/**system**/search) + table.
- Debug modal: dark "live trace", reveals steps one-by-one, "show raw queries" toggle.
- Info modal: full field → source → how-computed table (single source of truth).
- Redux: `fetchDashboardOverview/System/Accounts/AccountTimeline/Platforms`,
  `fetchSystemDebug`, `fetchExporterHealth` (+ reused `fetchStatusSystemInfo`).

---

## 4. Diagnostics (read-only, run on prod)

- `diagnostics/ad-count-probe.js --net=<net>` — every candidate ad-count query (MySQL ad
  table / activities / meta / domains / windows + ES) to confirm which matches a target.
- `diagnostics/dashboard-data-dump.js`, `diagnostics/full-dashboard-dump.js` — schema/volume dumps.

---

## 5. Status

- ✅ Overview / system drill / accounts / account-timeline / platforms / system-debug /
  exporter-health — built, syntax-clean.
- ✅ Total/Unique ads reconciled to Crawler Insight (`get-count`) for every network;
  platform filter honored (metric=platform).
- ✅ Live auto-refresh, date+platform filters, source tagging, debug trace, charts.
- ⏳ Live-activity strip (cycles/captures/plugin-events) hidden until prod metric names
  confirmed (returned 0). Per-system ads intentionally activity-based (labeled).
