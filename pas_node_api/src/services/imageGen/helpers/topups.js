'use strict';

/**
 * Credit top-ups, sold as aMember products (config.json → imageGen.topup).
 *
 * Buying: the frontend sends the user to the pack's aMember checkout link, so
 * aMember owns payment, invoice and receipt — this app never charges anyone.
 * Crediting: a pack is credited once aMember shows both an access record for
 * its product AND a payment record for its invoice; refunds/chargebacks take the
 * credits back (see syncTopups). Exactly-once on both sides (keyed by access_id
 * in imagegen_topup_grants). No webhook needed, and a restart can't lose or
 * double-count anything.
 */

const imageGenConfig = require('../config');
const repo = require('../repository');
const { fetchAmemberPaymentsAndRefunds } = require('../../../auth/amemberAuth');
const logger = require('../../../logger');

const log = logger.createChild('imagegen-topups');

function topupConfig() {
  return imageGenConfig.topup || {};
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function configuredPacks() {
  const packs = Array.isArray(topupConfig().packs) ? topupConfig().packs : [];
  return packs
    .map((p) => ({
      credits: Math.max(0, Math.floor(Number(p.credits) || 0)),
      productId: Number(p.amemberProductId) || null,
      // aMember's product radio value is "<product_id>-<billing_plan_id>"; the
      // billing plan ID is usually the product ID, override per pack if not.
      billingPlanId: Number(p.amemberBillingPlanId) || Number(p.amemberProductId) || null,
      discountPercent: Math.min(100, Math.max(0, Number(p.discountPercent) || 0)),
      checkoutUrl: p.checkoutUrl || null,
    }))
    .filter((p) => p.credits > 0);
}

function topupProductIds() {
  return new Set(configuredPacks().map((p) => p.productId).filter(Boolean));
}

/** Packs as shown to the user, priced from pricePerCredit. */
function listPacks() {
  const cfg = topupConfig();
  const pricePerCredit = Math.max(0, Number(cfg.pricePerCredit) || 0);
  const enabled = cfg.enabled !== false;
  return configuredPacks().map((p) => {
    const originalPrice = round2(p.credits * pricePerCredit);
    const price = round2(originalPrice * (1 - p.discountPercent / 100));
    // A pack's own checkoutUrl (e.g. a dedicated aMember signup form per pack)
    // wins over the shared template.
    const urlTemplate = p.checkoutUrl || cfg.checkoutUrl;
    const available = enabled && !!p.productId && !!urlTemplate;
    return {
      credits: p.credits,
      price,
      original_price: originalPrice,
      discount_percent: p.discountPercent,
      currency: cfg.currency || 'USD',
      currency_symbol: cfg.currencySymbol || '',
      available,
      checkout_url: available
        ? String(urlTemplate)
          .replace(/\{productId\}/g, String(p.productId))
          .replace(/\{billingPlanId\}/g, String(p.billingPlanId))
        : null,
    };
  });
}

// Payments/refunds per user, reused for the same TTL as the subscription lookup
// (config imageGen.credits.amemberCacheSeconds); `force` bypasses it.
const moneyCache = new Map(); // userId → { at, data }

async function getPaymentsAndRefunds(userId, force) {
  const ttlMs = Math.max(0, Number(imageGenConfig.credits?.amemberCacheSeconds ?? 300)) * 1000;
  const cached = moneyCache.get(String(userId));
  if (!force && cached && Date.now() - cached.at < ttlMs) return cached.data;
  const data = await fetchAmemberPaymentsAndRefunds(userId);
  if (data) moneyCache.set(String(userId), { at: Date.now(), data });
  return data; // null on failure → caller does nothing this time
}

function sumForInvoice(rows, invoiceId) {
  return rows
    .filter((r) => String(r.invoice_id) === String(invoiceId))
    .reduce((sum, r) => sum + Math.abs(Number(r.amount) || 0), 0);
}

/**
 * Bring this user's top-up credits in line with aMember:
 *
 *  1. CREDIT a purchase only once aMember has a PAYMENT record for its invoice
 *     (pending / failed / unpaid invoices are skipped and re-checked next sync).
 *     A top-up access added by an admin by hand (no invoice) is treated as a
 *     deliberate gift and credited.
 *  2. REVERSE on refund / chargeback: when aMember has REFUND records for a
 *     credited invoice, the same share of that pack's credits is taken back
 *     (half refunded → half the credits). Only credits still unspent can be
 *     removed — spent ones can't be clawed back; the shortfall is recorded in the
 *     ledger. A hand-added gift whose access record is removed is reversed fully.
 *
 * If aMember's payment data can't be fetched, nothing is credited or reversed
 * (never act on partial data); the next sync retries. Exactly-once on both
 * sides: grants are keyed by aMember access_id, reversals by the grant's
 * reversed_credits counter.
 */
async function syncTopups(db, userId, sub, { force = false } = {}) {
  const packsByProduct = new Map(configuredPacks().filter((p) => p.productId).map((p) => [p.productId, p]));
  if (!packsByProduct.size) return 0;

  const topupRows = (sub.access || []).filter((r) => r.access_id && packsByProduct.has(Number(r.product_id)));
  const openGrants = await repo.listOpenTopupGrants(db, userId);
  if (!topupRows.length && !openGrants.length) return 0; // no top-ups → no extra aMember calls

  const money = await getPaymentsAndRefunds(userId, force);
  if (!money) return 0;

  let granted = 0;
  for (const row of topupRows) {
    const pack = packsByProduct.get(Number(row.product_id));
    let paidAmount = null;
    if (row.invoice_id) {
      const paid = sumForInvoice(money.payments, row.invoice_id);
      const refunded = sumForInvoice(money.refunds, row.invoice_id);
      if (!(paid > 0) || refunded >= paid) continue; // not paid (yet), or refunded before we ever credited it
      paidAmount = paid;
    }
    const credits = pack.credits * Math.max(1, Number(row.qty) || 1);
    try {
      const balance = await repo.grantTopup(db, userId, {
        grantKey: `access:${row.access_id}`,
        credits,
        accessId: row.access_id,
        invoiceId: row.invoice_id || null,
        productId: pack.productId,
        paidAmount,
      });
      if (balance === null) continue; // already credited
      granted += credits;
      await repo.appendLedger(db, {
        userId, delta: credits, reason: 'topup', balanceAfter: balance,
        meta: { credits, invoice_id: row.invoice_id || null, access_id: row.access_id, paid_amount: paidAmount },
      });
      log.info('Top-up credited', { userId, credits, accessId: row.access_id, invoiceId: row.invoice_id, paidAmount });
    } catch (err) {
      log.error('Top-up credit failed', { userId, accessId: row.access_id, error: err.message });
    }
  }

  for (const grant of await repo.listOpenTopupGrants(db, userId)) {
    let target = 0;
    if (grant.invoice_id) {
      const paid = sumForInvoice(money.payments, grant.invoice_id) || Number(grant.paid_amount) || 0;
      const refunded = sumForInvoice(money.refunds, grant.invoice_id);
      if (refunded > 0 && paid > 0) target = Math.ceil(grant.credits * Math.min(1, refunded / paid));
    } else if (!(sub.access || []).some((r) => String(r.access_id) === String(grant.access_id))) {
      target = grant.credits; // hand-added gift removed by an admin
    }
    if (target <= 0) continue;
    try {
      const result = await repo.reverseTopupGrant(db, userId, grant, target);
      if (!result) continue;
      const doc = await repo.getCreditsDoc(db, userId);
      await repo.appendLedger(db, {
        userId, delta: -result.removed, reason: 'topup_reversed', balanceAfter: doc?.balance ?? null,
        meta: {
          reversed: result.reversed, removed: result.removed, unrecovered: result.reversed - result.removed,
          invoice_id: grant.invoice_id || null, access_id: grant.access_id,
        },
      });
      log.warn('Top-up reversed (refund/chargeback)', { userId, invoiceId: grant.invoice_id, ...result });
    } catch (err) {
      log.error('Top-up reversal failed', { userId, grant: grant._id, error: err.message });
    }
  }
  return granted;
}

module.exports = { listPacks, syncTopups, topupProductIds };
