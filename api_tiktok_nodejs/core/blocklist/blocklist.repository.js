// The only file that runs SQL for the blocklist. The tables are created by
// pas_node_api/scripts/apply-copyright-schema.js. All values go through
// replacements; the only inlined value is a validated integer page size.
// Timestamps are UTC DATETIMEs supplied here (the tables have no DB defaults).
import db from "../../Sequelize_cli/models/index.js";
import { NETWORK } from "./blocklist.constants.js";

const BLOCKLIST_TABLE = "copyright_blocklist";
const ATTEMPTS_TABLE = "copyright_blocked_attempts";

const run = (sql, replacements, type) => db.sequelize.query(sql, { replacements, type });

function utcNow() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function cut(value, max) {
  if (value === undefined || value === null) return null;
  return String(value).slice(0, max);
}

// The ASCII columns (network, ids, type and source codes) reject any other
// character in strict mode, which would fail a whole multi-row INSERT. Keep the
// row and replace such characters instead.
function ascii(value, max) {
  if (value === undefined || value === null) return null;
  return String(value).replace(/[^\x20-\x7e]/g, "?").slice(0, max);
}

// Every active, unexpired entry for TikTok: its own rows, then the rows marked
// 'all'. Keyset pagination on the primary key: no OFFSET, constant cost per
// page, only the columns needed to match.
//
// One query per scope, with equality on `network` and `status`, so MySQL reads
// the (network, status) index in `id` order: no filesort, and `id > ?` is a
// plain range seek. (A single `network IN (?, 'all')` would force a sort of the
// whole filtered set on every page.)
export async function loadActive({ pageSize = 5000 } = {}) {
  const limit = Math.max(1, parseInt(pageSize, 10) || 5000);
  const rows = [];
  for (const scope of [NETWORK, "all"]) {
    let lastId = 0;
    for (;;) {
      const page = await run(
        `SELECT id, entry_type, value, identifier_namespace
           FROM ${BLOCKLIST_TABLE}
          WHERE network = ?
            AND status = 'active'
            AND id > ?
            AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP())
          ORDER BY id
          LIMIT ${limit}`,
        [scope, lastId],
        db.Sequelize.QueryTypes.SELECT
      );
      if (!page.length) break;
      rows.push(...page);
      lastId = page[page.length - 1].id;
      if (page.length < limit) break;
    }
  }
  return rows;
}

// Insert rejected-attempt rows in one multi-row statement. Identifiers only.
export async function insertAttempts(rows) {
  if (!rows.length) return { inserted: 0 };
  const placeholders = rows.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
  const params = [];
  for (const r of rows) {
    params.push(
      ascii(r.network, 32), ascii(r.platform_ad_id, 255), cut(r.advertiser, 255), cut(r.image_url, 2048),
      r.blocklist_id, ascii(r.match_type, 32), r.distance ?? null, ascii(r.source, 64),
      r.created_at || utcNow()
    );
  }
  await run(
    `INSERT INTO ${ATTEMPTS_TABLE}
       (network, platform_ad_id, advertiser, image_url, blocklist_id,
        match_type, distance, source, created_at)
     VALUES ${placeholders}`,
    params,
    db.Sequelize.QueryTypes.INSERT
  );
  return { inserted: rows.length };
}
