'use strict';

/**
 * Markdown report generator for the per-network unhealthy-ads audits.
 *
 * Produces two artifacts:
 *   1. A per-run <reportPrefix>-<timestamp>.md with full ES + SQL details,
 *      failure factors, type breakdowns, and a cross-store gap conclusion.
 *   2. A central audit log (audit-reports/central-audit-log.md) that every
 *      run appends to, giving a running history across all networks.
 */

const fs = require('fs');
const path = require('path');

const REPORT_DIR = path.join(__dirname, '..', 'audit-reports');
const CENTRAL_LOG = path.join(REPORT_DIR, 'central-audit-log.md');

const fmt = (n) => (n === undefined || n === null ? '—' : Number(n).toLocaleString('en-US'));
const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) + '%' : '—');
const fmtDate = (d) => {
  if (!d) return '—';
  try { return new Date(d).toISOString(); } catch { return String(d); }
};

function mdTable(rows) {
  if (!rows || rows.length === 0) return '';
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i] ?? '').length)));
  const pad = (v, i) => String(v ?? '').padEnd(widths[i], ' ');
  const lines = [
    '| ' + rows[0].map(pad).join(' | ') + ' |',
    '|' + rows[0].map((_, i) => ' ' + '-'.repeat(widths[i]) + ' ').join('|') + '|',
  ];
  for (let i = 1; i < rows.length; i++) {
    lines.push('| ' + rows[i].map(pad).join(' | ') + ' |');
  }
  return lines.join('\n');
}

function buildPerNetworkMarkdown(rep) {
  const es = rep.elasticsearch;
  const sql = rep.mysql;
  const network = rep.network || 'unknown';
  const generated = rep.generatedAt ? fmtDate(rep.generatedAt) : '—';

  const lines = [];
  lines.push(`# ${network.toUpperCase()} Unhealthy-Ads Audit`);
  lines.push('');
  lines.push(`**Generated:** ${generated}`);
  lines.push(`**Network:** ${network}`);
  if (es) lines.push(`**ES Index:** ${es.index}`);
  if (sql) lines.push(`**SQL Database / Media Table:** ${sql.database} / ${sql.mediaTable}`);
  lines.push('');

  // Executive summary
  lines.push('## Executive Summary');
  lines.push('');
  const summaryRows = [
    ['Store', 'Total', 'Healthy / Displayable', 'Unhealthy / Non-displayable', 'Unhealthy %'],
  ];
  if (es) {
    summaryRows.push([
      'Elasticsearch',
      fmt(es.total),
      fmt(es.displayable),
      fmt(es.unhealthy),
      pct(es.unhealthy, es.total),
    ]);
  }
  if (sql) {
    summaryRows.push([
      'MySQL',
      fmt(sql.total),
      fmt(sql.healthy),
      fmt(sql.unhealthy),
      pct(sql.unhealthy, sql.total),
    ]);
  }
  lines.push(mdTable(summaryRows));
  lines.push('');

  // Cross-store gap analysis
  if (es && sql && typeof es.displayable === 'number' && typeof sql.healthy === 'number') {
    const gap = es.displayable - sql.healthy;
    lines.push('### ES ↔ SQL Gap');
    lines.push('');
    lines.push(`- **ES displayable:** ${fmt(es.displayable)}`);
    lines.push(`- **SQL healthy:** ${fmt(sql.healthy)}`);
    lines.push(`- **Gap:** ${fmt(Math.abs(gap))} ads ${gap >= 0 ? 'are displayable in ES but lack healthy SQL media rows' : 'have healthy SQL media but are not displayable in ES'}.`);
    lines.push('');
    lines.push('This gap indicates that media was uploaded to NAS and indexed in Elasticsearch, but the corresponding SQL media child row is missing, empty, or out of sync. The live product reads search results and media URLs from ES, so users still see these ads correctly. However, SQL is the persistence layer; if it is rebuilt or reindexed to ES without first backfilling the missing media rows, those ads would disappear from the product.');
    lines.push('');
  }

  // Elasticsearch details
  if (es) {
    lines.push('## Elasticsearch Details');
    lines.push('');
    lines.push(`- **Total docs:** ${fmt(es.total)}`);
    lines.push(`- **Displayable:** ${fmt(es.displayable)} (${pct(es.displayable, es.total)})`);
    lines.push(`- **Non-displayable:** ${fmt(es.unhealthy)} (${pct(es.unhealthy, es.total)})`);
    if (es.duplicates) {
      const d = es.duplicates;
      lines.push(`- **Docs with an ad id:** ${fmt(d.scannedDocs)}`);
      lines.push(`- **Docs with NO ad id:** ${fmt(d.missingAdId)}`);
      lines.push(`- **Distinct ad ids:** ${fmt(d.distinctIds)}`);
      lines.push(`- **Duplicated ad ids (count > 1):** ${fmt(d.duplicatedIds)}`);
      lines.push(`- **Duplicate copies (extra docs):** ${fmt(d.extraDocs)}`);
    }
    if (typeof es.deletable === 'number') {
      lines.push(`- **Total deletable (upper bound):** ${fmt(es.deletable)}`);
    }
    lines.push('');

    if (es.factors && es.factors.length) {
      lines.push('### Failure Factors');
      lines.push('');
      const factorRows = [['Factor', 'Count', 'Description']];
      for (const f of es.factors) {
        factorRows.push([f.key, fmt(f.count), f.label || '']);
      }
      lines.push(mdTable(factorRows));
      lines.push('');
    }

    const td = es.typeDistribution;
    if (td && Object.keys(td).length) {
      lines.push('### Type Distribution');
      lines.push('');
      const typeRows = [['Type', 'Count']];
      for (const [k, v] of Object.entries(td)) {
        typeRows.push([k, fmt(v)]);
      }
      lines.push(mdTable(typeRows));
      lines.push('');
    }
  }

  // MySQL details
  if (sql) {
    lines.push('## MySQL Details');
    lines.push('');
    lines.push(`- **Total ads:** ${fmt(sql.total)}`);
    lines.push(`- **Healthy:** ${fmt(sql.healthy)} (${pct(sql.healthy, sql.total)})`);
    lines.push(`- **Unhealthy:** ${fmt(sql.unhealthy)} (${pct(sql.unhealthy, sql.total)})`);
    if (sql.mediaRequiredTypes && sql.mediaRequiredTypes.length) {
      lines.push(`- **Media required for types:** ${sql.mediaRequiredTypes.join(', ')}`);
    }
    lines.push('');

    if (sql.factors && sql.factors.length) {
      lines.push('### Failure Factors');
      lines.push('');
      const factorRows = [['Factor', 'Count', 'Description']];
      for (const f of sql.factors) {
        factorRows.push([f.key, fmt(f.count), f.label || '']);
      }
      lines.push(mdTable(factorRows));
      lines.push('');
    }

    if (sql.byType && Object.keys(sql.byType).length) {
      lines.push('### Per-Type Breakdown');
      lines.push('');
      const typeRows = [['Type', 'Total', 'Unhealthy', 'Missing Row', 'Empty Content']];
      for (const [t, b] of Object.entries(sql.byType)) {
        typeRows.push([t, fmt(b.total), fmt(b.unhealthy), fmt(b.missing_row), fmt(b.empty_content)]);
      }
      lines.push(mdTable(typeRows));
      lines.push('');
    }
  }

  // Conclusions
  lines.push('## Conclusions');
  lines.push('');
  if (es && sql) {
    const gap = es.displayable - sql.healthy;
    if (gap > 0) {
      lines.push(`1. **ES has ${fmt(gap)} more displayable ads than SQL has healthy ads.** This is the critical gap: media exists in ES/NAS but SQL does not know about it.`);
    } else if (gap < 0) {
      lines.push(`1. **SQL has ${fmt(Math.abs(gap))} more healthy ads than ES has displayable ads.** These ads have media in SQL but failed to index displayably in ES.`);
    } else {
      lines.push('1. **ES displayable count matches SQL healthy count.** The two stores are aligned on media health.');
    }
    lines.push('2. **The live grid works because it reads from ES.** Users currently see the displayable ads correctly, even when SQL rows are missing.');
    lines.push('3. **SQL is the long-term source of truth.** Before any ES rebuild or SQL-to-ES reindex, backfill or reconcile the missing SQL media rows.');
  } else if (es) {
    lines.push('1. **ES-only audit.** SQL audit was not run for this network.');
    lines.push('2. Non-displayable ES docs and duplicate copies are the primary cleanup targets.');
  } else if (sql) {
    lines.push('1. **SQL-only audit.** ES audit was not run for this network.');
    lines.push('2. Ads with missing or empty media rows are the primary cleanup targets.');
  }
  if (es && es.duplicates && es.duplicates.extraDocs) {
    lines.push(`4. **Duplicate ES documents inflate the displayed count.** ${fmt(es.duplicates.extraDocs)} redundant copies exist; removing them will make the UI count match the number of unique ads.`);
  }
  lines.push('');

  return lines.join('\n');
}

function buildCentralLogEntry(rep) {
  const es = rep.elasticsearch;
  const sql = rep.mysql;
  const network = rep.network || 'unknown';
  const generated = rep.generatedAt ? fmtDate(rep.generatedAt) : '—';

  const lines = [];
  lines.push(`## ${generated} — ${network.toUpperCase()}`);
  lines.push('');

  const summaryRows = [
    ['Store', 'Total', 'Healthy / Displayable', 'Unhealthy / Non-displayable', 'Unhealthy %'],
  ];
  if (es) {
    summaryRows.push(['Elasticsearch', fmt(es.total), fmt(es.displayable), fmt(es.unhealthy), pct(es.unhealthy, es.total)]);
  }
  if (sql) {
    summaryRows.push(['MySQL', fmt(sql.total), fmt(sql.healthy), fmt(sql.unhealthy), pct(sql.unhealthy, sql.total)]);
  }
  lines.push(mdTable(summaryRows));
  lines.push('');

  if (es && sql && typeof es.displayable === 'number' && typeof sql.healthy === 'number') {
    const gap = es.displayable - sql.healthy;
    const direction = gap >= 0
      ? `ES displayable exceeds SQL healthy by ${fmt(Math.abs(gap))}`
      : `SQL healthy exceeds ES displayable by ${fmt(Math.abs(gap))}`;
    lines.push(`**Gap:** ${direction}. ${gap >= 0 ? 'Media exists in ES/NAS but SQL media rows are missing/empty.' : 'SQL has media that did not index displayably in ES.'}`);
    lines.push('');
  }

  if (es && es.duplicates && es.duplicates.extraDocs) {
    lines.push(`**Duplicates:** ${fmt(es.duplicates.extraDocs)} redundant ES copies across ${fmt(es.duplicates.duplicatedIds)} duplicated ad ids.`);
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  return lines.join('\n');
}

/**
 * Write markdown artifacts for an audit report.
 *
 * @param {string} runBase  — full file path base (e.g. .../audit-reports/facebook-audit-2026-06-29T13-04-58-598Z)
 * @param {Object} report   — the same report object written to JSON/XLSX
 * @returns {string|null}   — the .md file path, or null on error
 */
function writeMarkdown(runBase, report) {
  if (!runBase || !report) return null;
  try {
    fs.mkdirSync(REPORT_DIR, { recursive: true });

    // Per-run markdown report
    const mdPath = `${runBase}.md`;
    const mdContent = buildPerNetworkMarkdown(report);
    fs.writeFileSync(mdPath, mdContent, 'utf8');

    // Central running log — append (create with header if missing)
    const entry = buildCentralLogEntry(report);
    if (!fs.existsSync(CENTRAL_LOG)) {
      const header = '# Central Unhealthy-Ads Audit Log\n\n' +
        'This file is appended to by every per-network audit run. Each entry summarizes the ES and SQL counts and the cross-store gap conclusion.\n\n';
      fs.writeFileSync(CENTRAL_LOG, header + entry, 'utf8');
    } else {
      fs.appendFileSync(CENTRAL_LOG, entry, 'utf8');
    }

    return mdPath;
  } catch (e) {
    console.error('Failed to write markdown report:', e.message);
    return null;
  }
}

module.exports = { writeMarkdown, buildPerNetworkMarkdown, buildCentralLogEntry, CENTRAL_LOG };
