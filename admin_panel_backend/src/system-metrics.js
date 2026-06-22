require('dotenv').config();
const axios = require('axios');
const dayjs = require('dayjs');
const dayjsTz = require('dayjs/plugin/timezone');
const dayjsUtc = require('dayjs/plugin/utc');
const PROMETHEUS_URL = `${process.env.PROMETHEUS_URL}/api/v1/query_range`;
const {adCountAcrossSelectedNetworks, getDomainMetrics, fetchAccountGeo} = require('../utils/db-query-metrics')
const cache = require("../utils/cache")

dayjs.extend(dayjsTz);
dayjs.extend(dayjsUtc);
const mode = process.env.NODE_ENV === "production" ? "prod": "dev";
const Qnetworks = process.env.NETWORKS ? process.env.NETWORKS.split(',') : [];

function getInitialAndFinalTimestamps(range, format = null) {
  if (!range?.from || !range?.to) {
    throw new Error('Invalid date range');
  }

  const timeZone = 'Asia/Kolkata';

  const fromDate = dayjs.tz(range.from, timeZone).startOf('day');
  const toDate = dayjs.tz(range.to, timeZone).endOf('day');

  if (format === "ISO") {
    return {
      from: fromDate.toISOString(),
      to: toDate.toISOString()
    };
  }
  if (format === "IST") {
    return {
      from: fromDate.format(),
      to: toDate.format()
    };
  }
  return {
    from: fromDate.unix(),
    to: toDate.unix()
  };
}

  async function queryRange(promql, start, end, step = '1h') {
    const url = `${PROMETHEUS_URL}?query=${encodeURIComponent(promql)}&start=${start}&end=${end}&step=${step}`;
    try {
        const response = await axios.get(url, { timeout: 20000 });
        return response.data;
    } catch (error) {
        console.error('Error querying Prometheus:', error.message);
        throw error;
    }
}

async function instantQuery(promql) {
  const url = `${process.env.PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(promql)}`;
  try {
    const response = await axios.get(url, { timeout: 20000 });
    return response.data;
  } catch (error) {
    console.error('Error during instantQuery:', error.message);
    throw error;
  }
}

// Get system names and their ad counts
async function systemsNames(req, res){
  const { range,platform } = req.body;

  if (!range?.from || !range?.to) {
    return res.status(400).json({ error: 'Missing date range' });
  }

  const currentFrom = dayjs(range.from);
  const currentTo = dayjs(range.to);
  const diffDays = currentTo.diff(currentFrom, 'day') + 1;

  const previousRange = {
    from: currentFrom.subtract(diffDays, 'day').format('YYYY-MM-DD'),
    to: currentFrom.subtract(1, 'day').format('YYYY-MM-DD'),
  };
  const cacheKey = `systemsNames_${currentFrom.toISOString()}_${currentTo.toISOString()}_${previousRange.from}_${previousRange.to}_${platform}`;

        const cachedResult = cache.get(cacheKey);
        if (cachedResult) {
            return res.json(cachedResult);
        }

  try {
    const [currentResults, previousResults] = await Promise.all([
      Promise.all(Qnetworks.map(nw => adCountAcrossSelectedNetworks(range, [nw],null,platform))),
      Promise.all(Qnetworks.map(nw => adCountAcrossSelectedNetworks(previousRange, [nw],null,platform)))
    ]);
    const flattenResults = arr => arr.flat().filter(e => e.system_name); 

    const current = flattenResults(currentResults);
    const previous = flattenResults(previousResults);

    const getGroupedData = (data) => {
      const map = {};
      for (const { system_name, network,  unqiue_ads } of data) {
        const key = `${system_name}_${network}`;
        map[key] = (map[key] || 0) +  unqiue_ads;
      }
      return map;
    };

    const currentMap = getGroupedData(current);
    const previousMap = getGroupedData(previous);

    const systems = [...new Set(current.map(e => e.system_name))];
    const response = [];

    for (const system of systems) {
      const netStats = [];

      for (const network of Qnetworks) {
        const key = `${system}_${network}`;
        const currentAds = currentMap[key] || 0;
        const previousAds = previousMap[key] || 0;

        let percentage = 0;
        let change = 'no_change';

        if (previousAds === 0 && currentAds > 0) {
          percentage = 100;
          change = 'increase';
        } else if (currentAds === 0 && previousAds > 0) {
          percentage = -100;
          change = 'decrease';
        } else if (previousAds > 0) {
          percentage = +(((currentAds - previousAds) / previousAds) * 100).toFixed(2);
          change = percentage > 0 ? 'increase' : percentage < 0 ? 'decrease' : 'no_change';
        }

        netStats.push({ network, percentage, change });
      }

      response.push({ systemName: system, network: netStats });
    }
    response.sort((a, b) => {
      const sumA = a.network.reduce((acc, n) => acc + n.percentage, 0);
      const sumB = b.network.reduce((acc, n) => acc + n.percentage, 0);
      return sumA - sumB;
    });
    cache.set(cacheKey, response);
    res.json(response);
  } catch (error) {
    console.error('Comparison error:', error);
    res.status(500).json({ error: 'Failed to compare performance' });
  }
}


//Get system analytics
async function systemsAnalytics(req, res) {
  const { range, searchTerm, steps, platform } = req.body;

  if (!range?.from || !range?.to || !steps) {
    return res.status(400).json({ error: 'Missing required fields in request body' });
  }

  const { from, to } = getInitialAndFinalTimestamps(range);
  const step = `${steps}h`;
  const knownNetworks = ['facebook', 'instagram', 'gtext', 'gdn', 'native', 'linkedin', 'reddit', 'tiktok', 'pinterest','youtube','quora'];

  const cacheKey = `systemsAnalytics_${from}_${to}_${platform}`;
  const cachedResult = cache.get(cacheKey);
  if (cachedResult) {
    return res.json(cachedResult);
  }

  try {
    const [adCountsResults, prometheusResults] = await Promise.all([
      Promise.all(Qnetworks.map(network => 
        adCountAcrossSelectedNetworks(range, [network], "systemsAnalytics", platform)
          .catch(error => {
            console.error(`Error fetching data for ${network}:`, error);
            return null;
          }))
      ),
      fetchPrometheusData(from, to, step)
        .catch(error => {
          console.error('Error fetching Prometheus data:', error);
          return [];
        })
    ]);

    const validAdCountsResults = adCountsResults.filter(result => result !== null);

    if (validAdCountsResults.length === 0) {
      return res.status(500).json({ error: 'Failed to fetch data from all networks' });
    }

    const { adCounts, systemMetrics, query3Results } = processAdCounts(validAdCountsResults, knownNetworks);
  
    if (adCounts.length === 0) {
      return res.json([]);
    }
    // account_id -> system_id, so CPU/RAM (keyed by hostname in Prometheus) can be
    // mapped back onto the DB system.
    const acctToSystem = new Map();
    for (const a of adCounts) {
      if (a.account_id && a.account_id !== 'N/A') acctToSystem.set(String(a.account_id), a.system_name);
    }
    if (Array.isArray(prometheusResults)) {
      processPrometheusData(prometheusResults, systemMetrics, acctToSystem);
    }

    const { summary, detailedBySystem } = generateSummaryAndDetails(adCounts, systemMetrics, knownNetworks, query3Results);

    const responseData = {
      summary,
      detailsData: Object.values(detailedBySystem),
      accountActivities: query3Results
    };

    cache.set(cacheKey, responseData);
    return res.json(responseData);

  } catch (error) {
    console.error('Error in systemsAnalytics:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch system analytics',
      details: error.message 
    });
  }
}

async function fetchPrometheusData(from, to, step) {
  try {
    const queries = {
      cpu: `max_over_time(cpu_utilization[${step}])`,
      ram: `max_over_time(ram_utilization[${step}])`,
      accounts:`scroll_plugin_counter_total{mode="prod"}`
    };

    const results = await Promise.all(
      Object.entries(queries).map(async ([key, query]) => {
        try {
          const url = `${PROMETHEUS_URL}?query=${encodeURIComponent(query)}&start=${from}&end=${to}&step=${step}`;
          const { data } = await axios.get(url, { timeout: 20000 });
          return { key, data: data?.data?.result || [] };
        } catch (error) {
          console.error(`Error fetching ${key} from Prometheus:`, error);
          return { key, data: [] };
        }
      })
    );

    return results.filter(result => result !== null);
  } catch (error) {
    console.error('Error in fetchPrometheusData:', error);
    return [];
  }
}

function processPrometheusData(results = [], systemMetrics = {}, acctToSystem = new Map()) {
  try {
    if (!Array.isArray(results)) {
      console.error('Prometheus results is not an array:', results);
      return;
    }

    const cpuData = results.find(r => r?.key === 'cpu')?.data || [];
    const ramData = results.find(r => r?.key === 'ram')?.data || [];
    const accountsData = results.find(r => r?.key === 'accounts')?.data || [];


    systemMetrics.accounts = accountsData;

    // Prometheus keys CPU/RAM by machine HOSTNAME, but systemMetrics is keyed by
    // DB system_id. Bridge hostname -> system_id via the account_id present on the
    // ads counter (accountsData) so CPU/RAM land on the correct system. Falls back
    // to the raw hostname when no account bridge exists.
    const hostToSystem = new Map();
    for (const entry of accountsData) {
      const host = entry?.metric?.server_name;
      const acct = entry?.metric?.account_id != null ? String(entry.metric.account_id) : '';
      const sys = acctToSystem.get(acct);
      if (host && sys && !hostToSystem.has(host)) hostToSystem.set(host, sys);
    }

    for (const entry of cpuData) {
      if (!entry?.metric?.server_name) continue;

      const serverName = hostToSystem.get(entry.metric.server_name) || entry.metric.server_name;
      if (!systemMetrics[serverName]) {
        systemMetrics[serverName] = {
          ram: [],
          cpu: [],
          performance: [],
          adsByDay: {}
        };
      }

      systemMetrics[serverName].cpu = (entry.values || []).map(([ts, val]) => ({
        date: parseInt(ts),
        value: parseFloat(val)
      })).filter(e => e.date !== 0);
    }

    for (const entry of ramData) {
      if (!entry?.metric?.server_name) continue;

      const serverName = hostToSystem.get(entry.metric.server_name) || entry.metric.server_name;
      if (!systemMetrics[serverName]) {
        systemMetrics[serverName] = {
          ram: [],
          cpu: [],
          performance: [],
          adsByDay: {}
        };
      }

      systemMetrics[serverName].ram = (entry.values || []).map(([ts, val]) => ({
        date: parseInt(ts),
        value: parseFloat(val)
      })).filter(e => e.date !== 0);
    }

  
    const coreCount = 12;
    for (const [serverName, metrics] of Object.entries(systemMetrics)) {
      if (serverName === 'accounts') continue; // Skip accounts key
      metrics.performance = (metrics.cpu || []).map(({ date }) => {
        const ads = metrics.adsByDay[dayjs.unix(date).startOf('day').unix()] || 0;
        return { 
          value: +(ads / coreCount).toFixed(2), 
          date 
        };
      });
    }
  } catch (error) {
    console.error('Error in processPrometheusData:', error);
  }
}
function processAdCounts(adCountsResults, knownNetworks) {
  const adCounts = [];
  const systemMetrics = {};
  const adCountsByDay = {};

  for (const result of adCountsResults.flat()) {
    const { network, query, query2, query3 } = result;
    const totalAdsMap = {};
  
    for (const item of (query3 || [])) {
      const key = item.account_id || item.system_id || '';
      if (key) {
        totalAdsMap[key] = item.total_ads;
      }
    }
  
    for (const row of query) {
      const { system_name, account_id, unqiue_ads, account_name } = row;
      const systemKey = system_name || 'NULL_SYSTEM';
      
      const lookupKey = account_id && account_id !== "N/A" ? account_id : system_name;
      const total_ads = totalAdsMap[lookupKey] || 0;
      const updated_ads = total_ads - (unqiue_ads || 0);
      
      adCounts.push({
        system_name: system_name,
        account_name: account_name || "N/A",
        network: network,
        account_id: account_id || "N/A",
        unqiue_ads: unqiue_ads || 0,
        total_ads: total_ads,
        updated_ads: updated_ads
      });
    }
  
    for (const row of query2 || []) {
      const { system_name, ad_date, ads_count } = row;
      const ts = dayjs(ad_date).startOf('day').unix();
  
      const systemKey = system_name || 'NULL_SYSTEM';
      
      if (!adCountsByDay[systemKey]) {
        adCountsByDay[systemKey] = {};
      }
  
      adCountsByDay[systemKey][ts] = (adCountsByDay[systemKey][ts] || 0) + ads_count;
    }
  }

  for (const [systemName, dayData] of Object.entries(adCountsByDay)) {
    systemMetrics[systemName] = {
      ram: [],
      cpu: [],
      performance: [],
      adsByDay: dayData,
      isNullSystem: systemName === 'NULL_SYSTEM'
    };
  }

  return { adCounts, systemMetrics };
}

function generateSummaryAndDetails(adCounts, systemMetrics, knownNetworks) {
  const detailedBySystem = {};
  const accountIds = new Set();
  const networkAccounts = {};
  const networkSystems = {};
  const uniqueSystems = new Set();

  for (const net of knownNetworks) {
    networkAccounts[net] = new Set();
    networkSystems[net] = new Set();
  }

  // account_id -> DB system_id, and hostname -> system_id. Prometheus accounts are
  // labelled by machine hostname (e.g. "GBSBHL1012-PC"); without this bridge they
  // get counted as a SEPARATE system from their DB id ("PAS1012"), double-counting
  // the same machine and inflating the system/account totals.
  const acctToSystem = new Map();
  for (const a of adCounts) {
    if (a.account_id && a.account_id !== 'N/A' && a.system_name) acctToSystem.set(String(a.account_id), a.system_name);
  }
  const hostToSystem = new Map();
  const systemToHost = new Map();
  for (const entry of (systemMetrics.accounts || [])) {
    const host = entry?.metric?.server_name;
    const acct = entry?.metric?.account_id != null ? String(entry.metric.account_id) : '';
    const sys = acctToSystem.get(acct);
    if (host && sys && !hostToSystem.has(host)) hostToSystem.set(host, sys);
    if (host && sys && !systemToHost.has(sys)) systemToHost.set(sys, host); // system_id -> machine hostname (for display)
  }


  for (const { system_name, account_name, network, total_ads, updated_ads, account_id, unqiue_ads } of adCounts) {
    const normNetwork = knownNetworks.includes(network) ? network : 'native';
    const systemKey = system_name || 'NULL_SYSTEM';

    uniqueSystems.add(systemKey);

    if (!detailedBySystem[systemKey]) {
      detailedBySystem[systemKey] = {
        systemName: system_name,
        ...Object.fromEntries(knownNetworks.map(n => [n, 0])),
        ram: [],
        cpu: [],
        performance: [],
        accounts: [],
        adsByDay: []
      };
    }

    detailedBySystem[systemKey][normNetwork] += total_ads;

    const accountData = {
      account: account_name,
      account_id: account_id,
      system: 'Active',
      network: normNetwork,
      unique_ads: unqiue_ads,
      total_ads: total_ads,
      updated_ads: updated_ads
    };

    const isDuplicate = detailedBySystem[systemKey].accounts.some(acc => 
      acc.account_id === accountData.account_id && acc.network === accountData.network
    );

    if (!isDuplicate) {
      detailedBySystem[systemKey].accounts.push(accountData);
    }

    if (account_id && account_id !== "N/A") {
      const uniqueKey = `${account_id}_${normNetwork}`;
      networkAccounts[normNetwork].add(uniqueKey);
      accountIds.add(uniqueKey);
    }
    networkSystems[normNetwork].add(systemKey);
  }


  const prometheusAccounts = systemMetrics.accounts || [];

  const adCountsAccountKeys = new Set(
    adCounts
      .filter(item => item.account_id && item.account_id !== "N/A")
      .map(item => `${item.account_id}_${item.network}`)
  );

  for (const entry of prometheusAccounts) {
    const { metric } = entry;
    const { account_id, account_name, server_name, network } = metric;

   
    if (!Qnetworks.includes(network) || ['youtube', 'gtext', 'gdn', 'native'].includes(network)) {
      continue;
    }

    const uniqueKey = `${account_id}_${network}`;
    if (adCountsAccountKeys.has(uniqueKey)) {
      continue;
    }

    // Collapse the machine hostname onto its DB system_id so the same machine is
    // never shown twice (e.g. "PAS1012" with accounts + a phantom empty
    // "GBSBHL1012-PC"). Only genuinely DB-unknown machines keep their hostname.
    const systemKey = hostToSystem.get(server_name) || server_name || 'NULL_SYSTEM';


    if (!detailedBySystem[systemKey]) {
      detailedBySystem[systemKey] = {
        systemName: systemKey,
        ...Object.fromEntries(knownNetworks.map(n => [n, 0])),
        ram: [],
        cpu: [],
        performance: [],
        accounts: [],
        adsByDay: []
      };
      uniqueSystems.add(systemKey);
    }

    const accountData = {
      account: account_name || "N/A",
      account_id: account_id || "N/A",
      system: 'Inactive',
      network: network,
      unique_ads: 0,
      total_ads: 0,
      updated_ads: 0
    };

   
    const isDuplicate = detailedBySystem[systemKey].accounts.some(acc => 
      acc.account_id === accountData.account_id && acc.network === accountData.network
    );

    if (!isDuplicate) {
      detailedBySystem[systemKey].accounts.push(accountData);
      networkAccounts[network].add(uniqueKey);
      accountIds.add(uniqueKey);
      networkSystems[network].add(systemKey);
    }
  }


  for (const [sys, data] of Object.entries(detailedBySystem)) {
    const metrics = systemMetrics[sys] || {};
    data.adsByDay = Object.entries(metrics.adsByDay || {}).map(([ts, val]) => ({
      timestamp: parseInt(ts),
      value: val
    }));
    data.performance = metrics.performance || [];
    data.cpu = metrics.cpu || [];
    data.ram = metrics.ram || [];
    // Machine hostname for this system_id (null when it's the same as the name or
    // unknown) so the UI can show "PAS1012 — GBSBHL1012-PC".
    const host = systemToHost.get(sys) || null;
    data.hostname = host && host !== data.systemName ? host : null;
  }


  const networksWithData = knownNetworks.filter(net => 
    networkAccounts[net].size > 0 || networkSystems[net].size > 0
  );

  const detailArr = Object.values(detailedBySystem);
  const summary = {
    totalNetworks: networksWithData.length,
    totalSystems: uniqueSystems.size,
    totalAccounts: accountIds.size
  };

  for (const net of knownNetworks) {
    summary[net] = {
      accounts: networkAccounts[net].size,
      // Count systems that actually produced ads in this network (matches the
      // system-active list = 79), not systems that merely have a monitored,
      // zero-ad account (which inflated this to 95).
      systems: detailArr.filter(d => (d[net] || 0) > 0).length
    };
  }

  return { summary, detailedBySystem: Object.values(detailedBySystem) };
}

// Get account metrics
async function accountsMetrics(req, res) {
  const { range, steps, platform } = req.body;
  if (!range?.from || !range?.to || !steps) return res.status(400).json({ error: 'Missing required fields' });
  const { from, to } = getInitialAndFinalTimestamps(range);
  const step = `${steps}h`;
  const cacheKey = `accountMetrics_${from}_${to}_${platform}`;
  const cachedResult = cache.get(cacheKey);
  if (cachedResult) return res.json(cachedResult);

  try {
    const filtered = arr => arr.filter(p => !['gdn','native','gtext','youtube'].includes(p));
    const validNetworks = filtered(Qnetworks); 
    const adCountsResults = await Promise.all(validNetworks.map(network => adCountAcrossSelectedNetworks(range, [network], 'accountMetrics', platform).catch(() => null)));
    const validNetworkResults = adCountsResults.filter(result => result !== null).flat();
    const allAccounts = new Map();
    
    validNetworkResults.forEach(networkResult => {
      if (!networkResult.query || !networkResult.query3) return;
      const accountInfoMap = {};
      networkResult.query.forEach(account => {
        if (account.account_id) accountInfoMap[account.account_id.toString()] = {
          account_name: account.account_name || null, 
          system_name: account.system_name || 'Unknown',
          unique_ads: account.unqiue_ads || 0
        };
      });
      networkResult.query3.forEach(account => {
        const accountId = account.account_id?.toString();
        if (!accountId || !accountInfoMap[accountId]) return;
        const accountInfo = accountInfoMap[accountId];
        allAccounts.set(accountId, {
          account_name: accountInfo.account_name, 
          account_id: accountId,
          network: networkResult.network.toLowerCase(),
          system_name: accountInfo.system_name,
          unique_ads: accountInfo.unique_ads,
          total_ads: account.total_ads || 0,
          updated_ads: Math.max(0, (account.total_ads || 0) - accountInfo.unique_ads)
        });
      });
    });

    const prometheusData = await fetchPrometheusMetrics(from, to, step);
    const { adsData, cpuData, heartbeatData, accountsData } = prometheusData;
    const cpuMap = createCpuMap(cpuData);
    const heartbeatMap = createHeartbeatMap(heartbeatData);

    // Bridge machine hostname <-> DB system_id so Prometheus-only accounts are
    // attributed to the real system (e.g. "PAS1012") instead of the bare hostname,
    // and so each account can also carry its machine hostname for display.
    const acctToSystem = new Map();
    for (const [id, acc] of allAccounts) {
      if (acc.system_name && acc.system_name !== 'Unknown') acctToSystem.set(id, acc.system_name);
    }
    const hostToSystem = new Map();
    const systemToHost = new Map();
    for (const { metric } of accountsData) {
      const host = metric?.server_name;
      const acct = metric?.account_id != null ? String(metric.account_id) : '';
      const sys = acctToSystem.get(acct);
      if (host && sys && !hostToSystem.has(host)) hostToSystem.set(host, sys);
      if (host && sys && !systemToHost.has(sys)) systemToHost.set(sys, host);
    }

    accountsData.forEach(({ metric }) => {
      const accountId = metric.account_id?.toString();
      if (!accountId || !validNetworks.includes(metric.network?.toLowerCase())) return;

      const compositeKey = `${accountId}_${metric.server_name || 'Unknown'}`;
      if (!allAccounts.has(accountId)) {
        allAccounts.set(accountId, {
          account_name: metric.account_name || null,
          account_id: accountId,
          network: metric.network.toLowerCase(),
          system_name: hostToSystem.get(metric.server_name) || metric.server_name || 'Unknown',
          unique_ads: 0,
          total_ads: 0,
          updated_ads: 0,
          // Store composite key for heartbeat lookup
          compositeKey
        });
      }
    });
  

    const defaultPerformance = generateDefaultPerformance(from, to, step);
    // Everything is keyed by account_id — the only identifier shared across the DB
    // rows, the ads counter, and the account heartbeat.
    const accountMetrics = processMetricsWithFallback(
      adsData,
      cpuMap,
      allAccounts,
      defaultPerformance,
      heartbeatMap
    );
    const response = [...allAccounts.values()].map(account => {
      const metricsKey = String(account.account_id);

      const metrics = accountMetrics.get(metricsKey) || {
        performance: defaultPerformance,
        rawAdsByDay: {},
        heartbeatStatus: [],
        isActive: false
      };
      const heartbeatInfo = heartbeatMap.get(metricsKey) || {
        statusData: [],
        isAlert: true
      };
      metrics.heartbeatStatus = heartbeatInfo.statusData;
      metrics.isActive = !heartbeatInfo.isAlert;
      const adsByDay = Object.entries(metrics.rawAdsByDay).map(([timestamp, value]) => ({ timestamp: parseInt(timestamp, 10), value: Math.round(value) })).sort((a, b) => a.timestamp - b.timestamp);
      const heartbeatStatus = metrics.heartbeatStatus.map(item => ({ timestamp: item.timestamp, active: item.active, value: item.active ? 1 : 0 }));
      const currentTime = Math.floor(Date.now() / 1000);
      const lastHeartbeat = metrics.heartbeatStatus.sort((a, b) => b.timestamp - a.timestamp)[0];
      const isInactive = !lastHeartbeat || (currentTime - lastHeartbeat.timestamp) > 1800 || !lastHeartbeat.active;
      let alert = { isActive: metrics.isActive, lastHeartbeat: metrics.heartbeatStatus[0]?.timestamp || null, message: null, color: null };
      if (account.total_ads === 0 && metrics.isActive) { alert.message = 'Account is active but has no ads'; alert.color = 'yellow'; } else if (isInactive) { alert.message = 'Account is inactive'; alert.color = 'red'; }
      const acctHost = systemToHost.get(account.system_name) || null;
      return {
        account_id: account.account_id,
        account: account.account_name,
        system: account.system_name,
        hostname: acctHost && acctHost !== account.system_name ? acctHost : null,
        network: account.network.charAt(0).toUpperCase() + account.network.slice(1),
        ads: account.total_ads,
        unique_ads: account.unique_ads,
        updated_ads: account.updated_ads,
        performance: metrics.performance.map(p => ({ value: p.value ? Math.round(p.value * 100) / 100 : 0, date: p.date })),
        adsByDay,
        heartbeatStatus,
        alert
      };
    }).filter(item => item !== null);

    // ── Country + IP enrichment (System-Info table columns) ──────────────────
    // Country prefers the Prometheus `country` label (clean + consistent); IP and
    // the country fallback come from the DB user-table via fetchAccountGeo, looked
    // up per network keyed by account_id. Wrapped so geo lookup can NEVER 500 the
    // endpoint — on any failure the accounts table still renders (country/ip null).
    try {
      const promCountryMap = new Map();
      accountsData.forEach(({ metric }) => {
        const id = metric.account_id?.toString();
        if (id && metric.country && !promCountryMap.has(id)) promCountryMap.set(id, metric.country);
      });
      const idsByNetwork = {};
      for (const r of response) {
        const net = (r.network || '').toLowerCase();
        if (!net || !r.account_id) continue;
        (idsByNetwork[net] ||= new Set()).add(String(r.account_id));
      }
      const geoEntries = await Promise.all(
        Object.entries(idsByNetwork).map(async ([net, set]) => [net, await fetchAccountGeo(net, [...set])])
      );
      const geoByNetwork = Object.fromEntries(geoEntries);
      for (const r of response) {
        const net = (r.network || '').toLowerCase();
        const g = geoByNetwork[net]?.get(String(r.account_id));
        r.country = promCountryMap.get(String(r.account_id)) || g?.country || null;
        r.ip_address = g?.ip || null;
      }
    } catch (geoErr) {
      console.error('accountsMetrics country/IP enrichment failed (non-fatal):', geoErr.message);
      for (const r of response) { r.country = r.country ?? null; r.ip_address = r.ip_address ?? null; }
    }

    cache.set(cacheKey, response);
    return res.json(response);
  } catch (error) {
    console.error('Failed to process metrics:', error);
    return res.status(500).json({ error: 'Internal server error', details: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
}

function createHeartbeatMap(heartbeatData) {
  const heartbeatMap = new Map();
  const currentTime = Math.floor(Date.now() / 1000);
  const alertThreshold = 300; // 5 minutes in seconds

  // account_active_hb_total has a reliable account_id but a messy/inconsistent
  // server_name (sometimes a hostname, sometimes a code, sometimes blank), so key
  // purely by account_id. An account may report on several systems; keep the most
  // recent heartbeat across them.
  heartbeatData.forEach(({ metric, values = [] }) => {
    const accountId = metric.account_id != null ? String(metric.account_id) : '';
    if (!accountId || accountId === '-') return;

    // Find the most recent heartbeat in the last 5 minutes
    const latestHeartbeat = values.reduce((latest, [timestamp, value]) => {
      const ts = parseInt(timestamp, 10);
      const isActive = parseFloat(value) > 0;
      return (ts > latest.timestamp) ? { timestamp: ts, active: isActive } : latest;
    }, { timestamp: 0, active: false });

    const existing = heartbeatMap.get(accountId);
    if (existing && (existing.statusData[0]?.timestamp || 0) >= latestHeartbeat.timestamp) return;

    const isActive = latestHeartbeat.active && (currentTime - latestHeartbeat.timestamp) <= alertThreshold;

    heartbeatMap.set(accountId, {
      statusData: [{
        timestamp: latestHeartbeat.timestamp,
        active: isActive,
        value: isActive ? 1 : 0
      }],
      isAlert: !isActive
    });
  });

  return heartbeatMap;
}

function generateDefaultPerformance(from, to, step) {
  const performance = [];
  const stepInSeconds = parseInt(step) * 3600; 
  let current = from;
  while (current <= to) {
    performance.push({ value: 0, date: current });
    current += stepInSeconds;
  }
  return performance;
}

function processMetricsWithFallback(adsData, cpuMap, validKeys, defaultPerformance, heartbeatMap) {
  const accountMetrics = new Map();
  validKeys.forEach((account, accountId) => {
    const heartbeatInfo = heartbeatMap.get(accountId) || { statusData: [], isAlert: true };
    accountMetrics.set(accountId, { performance: JSON.parse(JSON.stringify(defaultPerformance)), rawAdsByDay: {}, heartbeatStatus: heartbeatInfo.statusData, isActive: !heartbeatInfo.isAlert });
  });
  for (const { metric, values = [] } of adsData) {
    // Match by account_id — the ads counter's server_name is a hostname while our
    // accounts are keyed by DB system_id, so a name-based key never lines up.
    const accountId = metric.account_id != null ? String(metric.account_id) : '';
    if (!accountId || !validKeys.has(accountId)) continue;
    const cpuSeries = cpuMap[metric.server_name] || [];
    const metricEntry = accountMetrics.get(accountId);
    for (let idx = 0; idx < values.length; idx++) {
      const [ts, val] = values[idx];
      const adsCount = parseFloat(val);
      const cpuVal = cpuSeries[idx]?.value || 1;
      const perf = Math.round(adsCount / cpuVal * 100) / 100;
      const timestamp = parseInt(ts, 10);
      if (metricEntry.performance[idx]) {
        metricEntry.performance[idx].value = perf;
        metricEntry.performance[idx].date = timestamp;
      }
      const dayTimestamp = Math.floor(timestamp / 86400) * 86400;
      metricEntry.rawAdsByDay[dayTimestamp] = (metricEntry.rawAdsByDay[dayTimestamp] || 0) + adsCount;
    }
  }
  return accountMetrics;
}

async function fetchPrometheusMetrics(from, to, step) {
  const queries = [
    ['ads', `max by (account_id, account_name, network, server_name) (increase(scroll_plugin_counter_total{mode="prod"}[${step}]))`],
    ['cpu', `max_over_time(cpu_utilization[${step}])`],
    ['heartbeat', `increase(account_active_hb_total[100s]) > 0`],
    ['accounts', `scroll_plugin_counter_total{mode="prod"}`]
  ];
  
  const results = await Promise.all(queries.map(async ([key, query]) => {
    let queryUrl = query;
    if (key === 'heartbeat') {
      queryUrl = `${PROMETHEUS_URL}?query=${encodeURIComponent(query)}&start=${Math.floor(Date.now() / 1000) - 300}&end=${Math.floor(Date.now() / 1000)}&step=15s`;
    } else {
      queryUrl = `${PROMETHEUS_URL}?query=${encodeURIComponent(query)}&start=${from}&end=${to}&step=${step}`;
    }
    const { data } = await axios.get(queryUrl, { timeout: 20000 });
    return { key, data: data.data.result };
  }));
  
  return {
    adsData: results[0].data,
    cpuData: results[1].data,
    heartbeatData: results[2].data,
    accountsData: results[3].data
  };
}



function createCpuMap(cpuData) {
  const cpuMap = Object.create(null);
  for (const { metric: { server_name }, values = [] } of cpuData) {
    cpuMap[server_name] = values.map(([ts, val]) => ({ date: parseInt(ts, 10), value: parseFloat(val) }));
  }
  return cpuMap;
}


//Get account names
async function accountsNameList(req, res) {
  const { range, mode, steps } = req.body;

  if (!range?.from || !range?.to || !steps || !mode) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const from = dayjs(range.from).unix();
  const to = dayjs(range.to).unix();
  const step = `${steps}h`;

  const query = `sum by (account_name) (increase(scroll_plugin_counter_total[${step}]))`;

  const cacheKey = `accountsNameList_${from}_${to}_${steps}_${mode}`;

  const cachedResult = cache.get(cacheKey);
  if (cachedResult) {
    return res.json(cachedResult);
  }

  try {
    const url = `${PROMETHEUS_URL}?query=${encodeURIComponent(query)}&start=${from}&end=${to}&step=${step}`;
    const { data } = await axios.get(url, { timeout: 20000 });

    const accounts = new Set();

    for (const result of data.data?.result || []) {
      const name = result.metric?.account_name || 'na';
      accounts.add(name);
    }

    const result = { accounts: [...accounts] };

    cache.set(cacheKey, result);

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch Prometheus data' });
  }
}

// Get system details
async function systemsDetails(req, res) {
  try {
    const { range, system, steps, network, mode } = req.body;

    if (!range?.from || !range?.to || !steps || !system) {
      return res.status(400).json({ error: 'Missing required fields in request body' });
    }

    const { from, to } = getInitialAndFinalTimestamps(range, 'ISO');
    const cacheKey = `systemsDetails_${system}_${from}_${to}_${steps}_${network}_${mode}`;
    
    const cachedResult = cache.get(cacheKey);
    if (cachedResult) {
      return res.json(cachedResult);
    }

    // Resolve the DB system_id to the machine hostname Prometheus actually labels
    // its series with (e.g. "GLB193" -> "GLB-193-PC"). Every metric below is keyed
    // by that hostname, so querying the raw system_id returns N/A for everything.
    const hostMap = await getSystemHostMap(range);
    const hosts = (hostMap[system] && hostMap[system].length) ? hostMap[system] : [system];
    const hostSel = `server_name=~"${hosts.map(h => h.replace(/[.+*?^${}()|[\]\\]/g, '\\$&')).join('|')}"`;

    const detailsQuery = `system_details{${hostSel}}`;
    const detailsResp = await instantQuery(detailsQuery);
    
    const defaultDetails = {
      hostname: system,
      os: 'unknown',
      platform: 'unknown',
      cpu_model: 'unknown',
      cpu_cores: 0,
      disk_storage: { value: 0.0, unit: 'GB' },
      total_ram: { value: 0.0, unit: 'GB' },
      alerts: {
        high_cpu: false,
        high_ram: false,
        high_disk: false,
      },
    };

    const details = detailsResp.data.result?.reduce((acc, resItem) => {
      const m = resItem.metric || {};
      return {
        ...acc,
        hostname: m.hostname || system,
        os: m.os || 'unknown',
        platform: m.platform || 'unknown',
        cpu_model: m.cpu_model || 'unknown',
        cpu_cores: parseInt(m.cpu_cores || 0),
        disk_storage: { value: parseFloat(m.total_storage_gb || 0), unit: 'GB' },
        total_ram: { value: parseFloat(m.total_ram_gb || 0), unit: 'GB' },
        alerts: {
          high_cpu: m.is_cpu_usage_high === 'True',
          high_ram: m.is_ram_usage_high === 'True',
          high_disk: m.is_disk_usage_high === 'True',
        },
      };
    }, defaultDetails);

    const getMetricStats = async (metricName) => {
      try {
        const query = `${metricName}{${hostSel}}`;
        const resp = await queryRange(query, from, to, `${steps}h`);
        
        if (!resp.data.result?.length) return null;
        
        const values = resp.data.result[0].values
          .map(v => parseFloat(v[1]))
          .filter(v => !isNaN(v));
        
        if (!values.length) return null;
        
        values.sort((a, b) => a - b);
        
        return {
          min: values[0],
          max: values[values.length - 1],
          avg: values.reduce((a, b) => a + b, 0) / values.length,
          '25%': values[Math.floor(values.length * 0.25)],
          '50%': values[Math.floor(values.length * 0.5)],
          '75%': values[Math.floor(values.length * 0.75)],
          current: values[values.length - 1] 
        };
      } catch (err) {
        console.warn(`Error fetching ${metricName}:`, err.message);
        return null;
      }
    };

    const checkSystemStatus = async () => {
      try {
        const hbQuery = `irate(system_active_hb_total{${hostSel}}[90s])`;
        const recentStart = dayjs().subtract(1, 'hour').toISOString();
        const recentEnd = dayjs().toISOString();

        const hbResp = await queryRange(hbQuery, recentStart, recentEnd, '90s');
        const values = hbResp.data.result?.[0]?.values || [];

        let isActive = values.some(v => parseFloat(v[1]) > 0);
        let lastActiveTs = (values.filter(v => parseFloat(v[1]) > 0).pop() || [])[0];

        // Fallback: some machines keep working (CPU live, accounts scraping) while
        // their system_active_hb_total counter is flat/stuck. Treat the system as
        // active if any of its accounts is currently beating. account_active_hb's
        // server_name is often the system_id itself, so match that and the hostname.
        if (!isActive) {
          const acctScope = [...new Set([system, ...hosts])]
            .map(h => h.replace(/[.+*?^${}()|[\]\\]/g, '\\$&')).join('|');
          const acctResp = await instantQuery(`increase(account_active_hb_total{server_name=~"${acctScope}"}[100s]) > 0`);
          const acctSeries = acctResp.data.result || [];
          if (acctSeries.length) {
            isActive = true;
            lastActiveTs = Math.max(...acctSeries.map(s => parseInt(s.value?.[0] || 0)));
          }
        }

        // Real uptime comes from the dedicated `system_uptime` gauge (seconds since
        // boot). The old `now - lastHeartbeat` formula was always ~0 for an active
        // system, so "Up Time" never showed anything useful.
        let uptimeSec = 0;
        try {
          const upResp = await instantQuery(`system_uptime{${hostSel}}`);
          const ups = (upResp.data.result || []).map(s => parseFloat(s.value?.[1] || 0)).filter(v => !isNaN(v));
          if (ups.length) uptimeSec = Math.max(...ups);
        } catch (e) {
          console.warn('system_uptime query failed:', e.message);
        }

        return {
          status: isActive ? 'active' : 'inactive',
          lastActive: lastActiveTs ? parseInt(lastActiveTs) : null,
          uptime: Math.round(uptimeSec)
        };
      } catch (err) {
        console.warn('Heartbeat query failed:', err.message);
        return {
          status: 'inactive',
          lastActive: null,
          uptime: 0
        };
      }
    };

    const getNetworkUsage = async () => {
      try {
        const query = `network_usage_total{${hostSel}}`;
        const resp = await queryRange(query, dayjs().subtract(1, 'hour').toISOString(), dayjs().toISOString(), '1m');
        
        if (!resp.data.result?.length) return 0;
        
        const values = resp.data.result[0].values
          .map(v => parseFloat(v[1]))
          .filter(v => !isNaN(v));
        
        return values.length ? Math.max(...values) : 0;
      } catch (err) {
        console.warn('Network usage query failed:', err.message);
        return 0;
      }
    };

    const [cpuStats, ramStats, statusInfo, netVal] = await Promise.all([
      getMetricStats('cpu_utilization'),
      getMetricStats('ram_utilization'),
      checkSystemStatus(),
      getNetworkUsage()
    ]);

    const nowTs = Math.floor(Date.now() / 1000);
    
    const response = {
      start: from,
      end: to,
      steps,
      server_name: system,
      network,
      mode,
      system_info: details,
      metrics: {
        cpu: { 
          unit: '%', 
          values: cpuStats || { 
            min: 0, max: 0, avg: 0, '25%': 0, '50%': 0, '75%': 0, current: 0 
          } 
        },
        ram: { 
          unit: '%', 
          values: ramStats || { 
            min: 0, max: 0, avg: 0, '25%': 0, '50%': 0, '75%': 0, current: 0 
          } 
        },
        network: { 
          unit: 'MB', 
          max: netVal,
          current: netVal 
        },
        uptime: { 
          unit: 'seconds', 
          last: statusInfo.uptime, 
          last_timestamp: statusInfo.lastActive || nowTs, 
          status: statusInfo.status 
        },
      },
      last_updated: nowTs
    };

    cache.set(cacheKey, response);
    res.json(response);
  } catch (err) {
    console.error('Error in /system/details:', err);
    res.status(500).json({ 
      error: 'Internal server error',
      message: err.message 
    });
  }
}

// Get plugin with chart
async function pluginWithChart(req, res) {
  try {
    const { range, steps, network, system: requestedSystem, platform } = req.body;

    if (!range?.from || !range?.to || !steps || !network || !requestedSystem) {
      return res.status(400).json({ error: 'Missing required fields in request body' });
    }

    const { from, to } = getInitialAndFinalTimestamps(range);
    const start = from;
    const end = to;
    const step = `${steps}h`;

    const cacheKey = `pluginWithChart_${network}_${requestedSystem}_${start}_${end}_${steps}_${platform}`;
    const cachedResult = cache.get(cacheKey);
    if (cachedResult) {
      return res.json(cachedResult);
    }

    const sqlData = (await adCountAcrossSelectedNetworks(range, [network], null, platform))
      .filter(item => item.system_name === requestedSystem);
    
    if (sqlData.length === 0) {
      return res.status(404).json({ 
        error: 'No data found for the specified system',
        requestedSystem,
        network
      });
    }

    const sqlAccountMap = new Map();
    sqlData.forEach(item => {
      sqlAccountMap.set(item.account_id.toString(), {
        system_name: item.system_name,
        network: item.network,
        account_name: item.account_name || null, 
        total_ads: item.unqiue_ads
      });
    });

    const accountIds = Array.from(sqlAccountMap.keys()).join('|');
    const promQL = `sum by(plugin_id, account_id, country) (
      scroll_plugin_counter_total{
        network="${network}",
        server_name="${requestedSystem}",
        account_id=~"${accountIds}",
        mode="${mode}"
      }
    )`;

    const params = {
      query: promQL,
      start,
      end,
      step
    };

    const prometheusRes = await axios.get(PROMETHEUS_URL, { params, timeout: 20000 });
    const results = prometheusRes.data.data.result;

    const prometheusAccountMap = new Map();
    results.forEach(series => {
      const account_id = series.metric.account_id;
      prometheusAccountMap.set(account_id, {
        plugin_id: series.metric.plugin_id,
        country: series.metric.country
      });
    });

    const response = {
      system: requestedSystem,
      network,
      total_ad_count: 0,
      plugin_count: 0,
      accounts: []
    };

    sqlAccountMap.forEach((sqlAccount, account_id) => {
      const prometheusData = prometheusAccountMap.get(account_id) || {};
      
      const account = {
        ...sqlAccount,
        account_id, 
        plugin_id: prometheusData.plugin_id || null,
        country: prometheusData.country || null,
        ad_types: {},
        messages: {
          inserted: 0,
          updated: 0,
          undefined: 0,
          failed: 0
        }
      };

      response.accounts.push(account);
      response.total_ad_count += sqlAccount.total_ads;
    });

    response.plugin_count = new Set(
      response.accounts.map(a => a.plugin_id).filter(Boolean)
    ).size;

    response.metadata = {
      sql_account_count: sqlAccountMap.size,
      prometheus_account_count: prometheusAccountMap.size,
      accounts_missing_prometheus_data: Array.from(sqlAccountMap.keys())
        .filter(id => !prometheusAccountMap.has(id))
        .map(id => ({
          account_id: id,
          account_name: sqlAccountMap.get(id).account_name 
        }))
    };

    cache.set(cacheKey, response);
    return res.json(response);
  } catch (err) {
    console.error(err.message);
    return res.status(500).json({ 
      error: 'Internal Server Error',
      details: err.message 
    });
  }
}


class SystemStatus {
  constructor(uptime_changes = false, cpu_changes = false, ram_changes = false, final_status = 'stopped') {
    this.uptime_changes = uptime_changes;
    this.cpu_changes = cpu_changes;
    this.ram_changes = ram_changes;
    this.final_status = final_status;
  }
}

class ActiveResponse {
  constructor(start, end, mode, active_systems, inactive_systems, all_status) {
    this.start = start;
    this.end = end;
    this.mode = mode;
    this.active_systems = active_systems;
    this.inactive_systems = inactive_systems;
    this.all_status = all_status;
  }
}

// Get system active details
async function systemActive(req, res) {
  const { range, network, platform } = req.body;

  if (!range?.from || !range?.to || !network) {
    return res.status(400).json({ error: 'Missing required fields in request body' });
  }

  const { from, to } = getInitialAndFinalTimestamps(range, 'ISO');
  const cacheKey = `systemActive_${network}_${from}_${to}_${platform}`;
  const cachedResult = cache.get(cacheKey);
  if (cachedResult && Date.now() - cachedResult.cachedAt < 5000) {
    return res.json(cachedResult.response);
  }

  try {
    // DB `system_name` is the logical system_id (e.g. "PAS1105"), but Prometheus
    // labels every series by the machine HOSTNAME (e.g. "GBSBHL1105-PC"). The two
    // never match directly, so we bridge through account_id — the only key shared
    // by both sides — to map each system_id to its hostname(s), then read the
    // hostname's heartbeat. (mode is forced to the env-derived value; the frontend
    // used to send mode:"test" which has no data in prod.)
    const [dbRows, pluginResult] = await Promise.all([
      adCountAcrossSelectedNetworks(range, [network], null, platform),
      queryRange(`scroll_plugin_counter_total{network="${network}",mode="${mode}"}`, from, to)
        .catch(err => {
          console.error('Plugin query failed:', err);
          return { data: { result: [] } };
        })
    ]);

    // system_id -> itself (set of all systems) and account_id -> system_id
    const allSystems = new Set();
    const acctToSystem = new Map();
    for (const row of dbRows || []) {
      if (!row?.system_name) continue;
      allSystems.add(row.system_name);
      const acct = row.account_id != null ? String(row.account_id) : '';
      if (acct && acct !== 'N/A') acctToSystem.set(acct, row.system_name);
    }

    // system_id -> Set(hostname), resolved via the account_id on each plugin series.
    // Fallback: for account-less networks (gdn/gtext/youtube/native) the system_id
    // may itself be the hostname, so match directly when no account bridge exists.
    const systemToHosts = new Map();
    for (const series of pluginResult.data.result) {
      const host = series.metric.server_name;
      if (!host) continue;
      const acct = series.metric.account_id != null ? String(series.metric.account_id) : '';
      const target = acctToSystem.get(acct) || (allSystems.has(host) ? host : null);
      if (!target) continue;
      if (!systemToHosts.has(target)) systemToHosts.set(target, new Set());
      systemToHosts.get(target).add(host);
    }

    const allHosts = [...new Set([...systemToHosts.values()].flatMap(s => [...s]))];

    let activeHosts = new Set();
    if (allHosts.length) {
      const recentStart = dayjs().subtract(30, 'minute').toISOString();
      const recentEnd = dayjs().toISOString();
      const escaped = allHosts.map(h => h.replace(/[.+*?^${}()|[\]\\]/g, '\\$&')).join('|');
      const hbQuery = `irate(system_active_hb_total{server_name=~"${escaped}"}[90s])`;

      const hbResult = await queryRange(hbQuery, recentStart, recentEnd, '90s')
        .catch(err => {
          console.error('Heartbeat query failed:', err);
          return { data: { result: [] } };
        });

      activeHosts = new Set(
        hbResult.data.result
          .filter(res => res.values?.some(v => parseFloat(v[1]) > 0))
          .map(res => res.metric.server_name)
      );
    }

    // Some machines emit ONLY account heartbeats (no system_active_hb_total and no
    // ads counter), so the hostname bridge above can't see them at all. Treat a
    // system as active when any of its accounts is currently beating. account_id is
    // the reliable bridge; account_active_hb_total's server_name is often the
    // system_id itself (e.g. "PAS1086"), so match that too.
    const activeAccountSystems = new Set();
    try {
      const acctHb = await instantQuery(`increase(account_active_hb_total[100s]) > 0`);
      for (const s of (acctHb.data.result || [])) {
        const acct = s.metric.account_id != null ? String(s.metric.account_id) : '';
        const sys = acctToSystem.get(acct) || (allSystems.has(s.metric.server_name) ? s.metric.server_name : null);
        if (sys) activeAccountSystems.add(sys);
      }
    } catch (err) {
      console.error('Account heartbeat query failed:', err.message);
    }

    const isSystemActive = (sys) => {
      const hosts = systemToHosts.get(sys);
      if (hosts && [...hosts].some(h => activeHosts.has(h))) return true;
      return activeAccountSystems.has(sys);
    };

    const systemsList = [...allSystems];
    const allStatus = Object.fromEntries(
      systemsList.map(system => [
        system,
        new SystemStatus(false, false, false, isSystemActive(system) ? 'running' : 'stopped')
      ])
    );

    const finalActive = systemsList.filter(isSystemActive).sort();
    const finalInactive = systemsList.filter(s => !isSystemActive(s)).sort();

    // system_id -> machine hostname, so the UI can label each system "PAS1012 — GBSBHL1012-PC".
    const hostnames = {};
    for (const [sys, hostSet] of systemToHosts) {
      const h = [...hostSet][0];
      if (h && h !== sys) hostnames[sys] = h;
    }

    const response = new ActiveResponse(
      from,
      to,
      mode,
      finalActive,
      finalInactive,
      allStatus
    );
    response.hostnames = hostnames;

    cache.set(cacheKey, {
      response,
      cachedAt: Date.now()
    });

    return res.json(response);

  } catch (error) {
    console.error('System active check failed:', error);
    return res.status(500).json({ error: 'Failed to check system status' });
  }
}

function formatDuration(seconds) {
  const h = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

// Build a system_id -> [hostname] map by bridging DB account_id to the hostname
// Prometheus reports on. The UI shows DB system_ids (e.g. "PAS1105") but every
// heartbeat/metric series is labelled by the machine hostname (e.g.
// "GBSBHL1105-PC"), so any query keyed by system_id returns nothing. Cached per
// range (default 3 min TTL) and reused across timeline requests.
async function getSystemHostMap(range) {
  const { from, to } = getInitialAndFinalTimestamps(range);
  const cacheKey = `systemHostMap_${from}_${to}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const dbResults = await Promise.all(
    Qnetworks.map(nw => adCountAcrossSelectedNetworks(range, [nw], null, null).catch(() => []))
  );
  const acctToSystem = new Map();
  for (const rows of dbResults) {
    for (const r of (rows || [])) {
      if (r?.system_name && r.account_id && r.account_id !== 'N/A') {
        acctToSystem.set(String(r.account_id), r.system_name);
      }
    }
  }

  let pcResult = { data: { result: [] } };
  try {
    pcResult = await instantQuery(`scroll_plugin_counter_total{mode="${mode}"}`);
  } catch (e) {
    console.error('getSystemHostMap plugin query failed:', e.message);
  }

  const sysToHosts = {};
  for (const s of (pcResult.data.result || [])) {
    const host = s.metric.server_name;
    const acct = s.metric.account_id != null ? String(s.metric.account_id) : '';
    const sys = acctToSystem.get(acct);
    if (!host || !sys) continue;
    if (!sysToHosts[sys]) sysToHosts[sys] = new Set();
    sysToHosts[sys].add(host);
  }
  const obj = {};
  for (const k of Object.keys(sysToHosts)) obj[k] = [...sysToHosts[k]];

  cache.set(cacheKey, obj);
  return obj;
}

const systemStateChart = async (req, res) => {
  try {
    const { range, systemName } = req.body;
    if(!range?.from || !range?.to || !systemName) {
      return res.status(400).json({ error: "Missing required fields in request body" });
    }
    const { from, to } = getInitialAndFinalTimestamps(range);
    const step = 135;

    // Resolve the system_id to its machine hostname(s); fall back to the raw value
    // for systems whose id is already a hostname (e.g. DESKTOP-*/GLB-*).
    const hostMap = await getSystemHostMap(range);
    const hosts = (hostMap[systemName] && hostMap[systemName].length) ? hostMap[systemName] : [systemName];
    const escaped = hosts.map(h => h.replace(/[.+*?^${}()|[\]\\]/g, '\\$&')).join('|');

    // A system is "busy" at any step when its system heartbeat OR any of its account
    // heartbeats advanced. system_active_hb alone isn't enough: some machines emit
    // ONLY account heartbeats (no system_active_hb_total at all, e.g. PAS1250), and
    // some have a stuck/flat system counter while their scrapers keep running — both
    // must read as Active. So fetch both and merge per-timestamp (active if either).
    const acctScope = [...new Set([systemName, ...hosts])]
      .map(h => h.replace(/[.+*?^${}()|[\]\\]/g, '\\$&')).join('|');

    const [sysResp, acctResp] = await Promise.all([
      axios.get(PROMETHEUS_URL, { params: { query: `sum(increase(system_active_hb_total{server_name=~"${escaped}"}[135s]))`, start: from, end: to, step } }),
      axios.get(PROMETHEUS_URL, { params: { query: `sum(increase(account_active_hb_total{server_name=~"${acctScope}"}[135s]))`, start: from, end: to, step } }),
    ]);

    const sysVals = sysResp.data.data.result[0]?.values || [];
    const acctVals = acctResp.data.data.result[0]?.values || [];

    const merged = new Map();
    for (const [ts, v] of sysVals) merged.set(parseInt(ts), parseFloat(v) > 0);
    for (const [ts, v] of acctVals) {
      const t = parseInt(ts);
      if (parseFloat(v) > 0) merged.set(t, true);
      else if (!merged.has(t)) merged.set(t, false);
    }

    // Back into the [ts, "1"/"0"] shape the timeline builder below expects.
    const values = [...merged.entries()].sort((a, b) => a[0] - b[0]).map(([ts, active]) => [ts, active ? '1' : '0']);
    if (!values.length) {
      return res.status(404).json({ error: "No data found for the given system" });
    }
    let timeline = [];
    let totalActive = 0;
    let totalInactive = 0;
    let currentState = parseFloat(values[0][1]) > 0;
    let periodStart = parseInt(values[0][0]);

    for (let i = 1; i < values.length; i++) {
      const [timestampStr, valStr] = values[i];
      const timestamp = parseInt(timestampStr);
      const newState = parseFloat(valStr) > 0;

      if (newState !== currentState) {
        const periodEnd = timestamp - 1;
        const duration = periodEnd - periodStart + 1;

        if (currentState) totalActive += duration;
        else totalInactive += duration;

        timeline.push({
          category: systemName,
          from: periodStart,
          to: periodEnd,
          name: currentState ? "Active" : "Inactive",
          columnSettings: {
            fill: currentState ? "am5.color(0x4caf50)" : "am5.color(0xcd213b)",
          },
        });

        currentState = newState;
        periodStart = timestamp;
      }
    }

    const lastTimestamp = parseInt(values[values.length - 1][0]);
    const lastDuration = lastTimestamp - periodStart + 1;

    if (currentState) totalActive += lastDuration;
    else totalInactive += lastDuration;

    timeline.push({
      category: systemName,
      from: periodStart,
      to: lastTimestamp,
      name: currentState ? "Active" : "Inactive",
      columnSettings: {
        fill: currentState ? "am5.color(0x4caf50)" : "am5.color(0xcd213b)",
      },
    });

    res.json({
      timeline,
      totalActive: formatDuration(totalActive),
      totalInactive: formatDuration(totalInactive),
    });
  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

const accountStateChart = async (req, res) => {
  try {
    const { range, accountName,systemName } = req.body;
    if(!range?.from || !range?.to || !accountName || !systemName) {
      return res.status(400).json({ error: "Missing required fields in request body" });
    }
    const { from, to } = getInitialAndFinalTimestamps(range);
    const step = 180; 

    const prometheusQuery = `increase(account_active_hb_total{account_name="${accountName}",server_name="${systemName}"}[100s])`;
    const response = await axios.get(PROMETHEUS_URL, {
      timeout: 20000,
      params: {
        query: prometheusQuery,
        start: from,
        end: to,
        step,
      },
    });

    const result = response.data.data.result[0];
    if (!result || !result.values || result.values.length === 0) {
      return res.status(404).json({ error: "No data found for the given account" });
    }

    const values = result.values;
    let timeline = [];
    let totalActive = 0;
    let totalInactive = 0;

    let currentState = parseFloat(values[0][1]) > 0;
    let periodStart = parseInt(values[0][0]);

    for (let i = 1; i < values.length; i++) {
      const [timestampStr, valStr] = values[i];
      const timestamp = parseInt(timestampStr);
      const newState = parseFloat(valStr) > 0;

      if (newState !== currentState) {
        const periodEnd = timestamp - 1; 
        const duration = periodEnd - periodStart + 1;

        if (currentState) totalActive += duration;
        else totalInactive += duration;

        timeline.push({
          category: accountName,
          from: periodStart,
          to: periodEnd,
          name: currentState ? "Active" : "Inactive",
          columnSettings: {
            fill: currentState ? "am5.color(0x4caf50)" : "am5.color(0xcd213b)",
          },
        });
        currentState = newState;
        periodStart = timestamp;
      }
    }

    const lastTimestamp = parseInt(values[values.length - 1][0]);
    const lastDuration = lastTimestamp - periodStart + 1;

    if (currentState) totalActive += lastDuration;
    else totalInactive += lastDuration;

    timeline.push({
      category: accountName,
      from: periodStart,
      to: lastTimestamp,
      name: currentState ? "Active" : "Inactive",
      columnSettings: {
        fill: currentState ? "am5.color(0x4caf50)" : "am5.color(0xcd213b)",
      },
    });

    res.json({
      timeline,
      totalActive: formatDuration(totalActive),
      totalInactive: formatDuration(totalInactive),
    });
  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

const getDomainsProcessed = async (req, res) => {
  try {
    const { range } = req.body;

    if (!range?.from || !range?.to) {
      return res.status(400).json({ error: 'Missing required fields in request body' });
    }
    const cacheKey = `domainMetrics-${range.from}-${range.to}`;
    const cachedResult = cache.get(cacheKey);
    if (cachedResult) {
      return res.status(200).json(cachedResult);
    }
    const domainData = await Promise.all(
      ['facebook','instagram'].map(async (net) => {
        const data = await getDomainMetrics(net, range);
        return data;
      })
    );

    const flatResult = domainData.flat();
    cache.set(cacheKey, flatResult);

    res.status(200).json(flatResult);
  } catch (error) {
    res.status(500).json({
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};


module.exports = {systemsNames, systemsAnalytics, accountsMetrics, accountsNameList, pluginWithChart, systemsDetails, systemActive,systemStateChart,accountStateChart,getDomainsProcessed}