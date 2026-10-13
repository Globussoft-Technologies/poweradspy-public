# AI Recreate — Image Credits by Plan

**Decided:** 13 Oct 2026 · **Applies to:** 2026 plans and legacy plans · **1 credit = 1 generated image**

Every number below was produced by the live code (`src/services/imageGen/helpers/creditPlan.js`)
with the current `config.json` → `imageGen.credits`. If a config value changes, this
table must be recalculated.

---

## 1. The rule

> **10% of what the user pays for their plan becomes image credits, at $0.132 per credit.**

```
Credits = Plan price × 10% ÷ $0.132          → rounded to the nearest 10
```

| Setting | Value | Config key |
|---|---|---|
| Share of plan price for images | 10% | `credits.formula.budgetPercent` |
| Cost of one credit | $0.132 | `credits.formula.costPerCreditUsd` |
| Rounding | nearest 10 | `credits.formula.roundTo` |
| Trial minimum | 10 credits | `credits.trial.minCredits` |
| Yearly delivery | whole year upfront, from the **undiscounted** yearly price | `credits.yearly.upfront` |

**Worked example — Palladium monthly ($399):**
$399 × 10% = $39.90 → $39.90 ÷ $0.132 = 302.27 → rounded = **300 credits / month**

---

## 2. Monthly plans

Price = what the user pays per month (read from their aMember invoice). The table
uses the list price; a user on a different (held/discounted) price gets credits for
their own price.

| Plan | Plan IDs (monthly) | Monthly price | 10% budget | ÷ $0.132 | **Credits / month** |
|---|---|---|---|---|---|
| **2026 Basic** | 72 | $69 | $6.90 | 52.27 | **50** |
| **2026 Standard** | 73 | $99 | $9.90 | 75.00 | **80** |
| **2026 Platinum** | 74 | $279 | $27.90 | 211.36 | **210** |
| **2026 Palladium** | 75 | $399 | $39.90 | 302.27 | **300** |
| Legacy Basic | 59 (+ old IDs 2,5,9,14,15,40) | $69 | $6.90 | 52.27 | **50** |
| Legacy Standard | 58 (+ 3,6,10,13,16,41) | $129 | $12.90 | 97.73 | **100** |
| Legacy Premium | 60 (+ 4,7,11,12,17,19,42) | $179 | $17.90 | 135.61 | **140** |
| Legacy Platinum | 61 (+ 22,34,23,24,37,43) | $279 | $27.90 | 211.36 | **210** |
| Legacy Titanium | 62 (+ 29,35,44,31) | $349 | $34.90 | 264.39 | **260** |
| Legacy Palladium | 63 (+ 32,36,30,39,45) | $399 | $39.90 | 302.27 | **300** |

Refreshed every month on the day the plan started. Unused plan credits do not
carry over.

---

## 3. Yearly plans

All of the year's credits are given **upfront** and refreshed once a year on the
purchase anniversary. They are calculated from the **undiscounted** yearly price
(monthly price × 12), not the discounted amount the user is charged — so yearly
buyers aren't penalised for taking the yearly discount.

| Plan | Plan IDs (yearly) | User pays / year | Undiscounted yearly price (used) | 10% budget | ÷ $0.132 | **Credits / year** | ≈ per month |
|---|---|---|---|---|---|---|---|
| **2026 Basic** | 76 | $331.20 | $828 | $82.80 | 627.27 | **630** | 52 |
| **2026 Standard** | 77 | $475.20 | $1,188 | $118.80 | 900.00 | **900** | 75 |
| **2026 Platinum** | 78 | $1,004.40 | $3,348 | $334.80 | 2,536.36 | **2,540** | 212 |
| **2026 Palladium** | 79 | $1,436.40 | $4,788 | $478.80 | 3,627.27 | **3,630** | 302 |
| Legacy Basic | 64, 25 | (held price) | $828 | $82.80 | 627.27 | **630** | 52 |
| Legacy Standard | 65, 26 | (held price) | $1,548 | $154.80 | 1,172.73 | **1,170** | 97 |
| Legacy Premium | 66, 27 | (held price) | $2,148 | $214.80 | 1,627.27 | **1,630** | 136 |
| Legacy Platinum | 67, 28 | (held price) | $3,348 | $334.80 | 2,536.36 | **2,540** | 212 |
| Legacy Titanium | 68 | (held price) | $4,188 | $418.80 | 3,172.73 | **3,170** | 264 |
| Legacy Palladium | 69 | (held price) | $4,788 | $478.80 | 3,627.27 | **3,630** | 302 |

2026 undiscounted yearly prices come from `pricing.planPrices` (yearly `amount`,
before `discountPercent`); legacy ones are `credits.listPrices` monthly × 12.

---

## 4. Trials (3 days)

Calculated with the same formula on the trial amount actually charged, but never
below the **10-credit minimum**. Given once for the trial.

| Plan | Trial price | 10% budget | ÷ $0.132 | Formula result | **Trial credits** |
|---|---|---|---|---|---|
| 2026 Basic | $1 | $0.10 | 0.76 | 0 | **10** (minimum) |
| 2026 Standard | $7 | $0.70 | 5.30 | 10 | **10** |
| 2026 Platinum | $7 | $0.70 | 5.30 | 10 | **10** |
| 2026 Palladium | $7 | $0.70 | 5.30 | 10 | **10** |
| Legacy trial plans (52–57) | the trial amount charged | — | — | — | **10** (minimum) |

What happens after the trial:
- **Trial converts to a paid plan** (recurring invoice) → on the payment date the
  credits switch to that plan's monthly or yearly amount from the tables above.
- **Trial doesn't convert** → the Credits tab shows the trial end date; no more
  plan credits after it.

---

## 5. Quick reference (what the user sees)

| Plan | Trial | Monthly | Yearly (upfront) |
|---|---|---|---|
| 2026 Basic | 10 | 50 / month | 630 / year |
| 2026 Standard | 10 | 80 / month | 900 / year |
| 2026 Platinum | 10 | 210 / month | 2,540 / year |
| 2026 Palladium | 10 | 300 / month | 3,630 / year |
| Legacy Basic | 10 | 50 / month | 630 / year |
| Legacy Standard | 10 | 100 / month | 1,170 / year |
| Legacy Premium | 10 | 140 / month | 1,630 / year |
| Legacy Platinum | 10 | 210 / month | 2,540 / year |
| Legacy Titanium | 10 | 260 / month | 3,170 / year |
| Legacy Palladium | 10 | 300 / month | 3,630 / year |

---

## 6. Special cases

| Case | Credits |
|---|---|
| Legacy user on a held / discounted monthly price | Formula on what they actually pay (e.g. Palladium held at $199/mo → 150) |
| Admin-granted access (no invoice in aMember) | Formula on the list price above, by the plan's billing cycle (yearly variant → yearly upfront) |
| Custom plans (33, 46, 70) / Enterprise (71) | Formula on their invoice amount; admin-granted ones get 0 unless an override is set |
| Free plan (20) | 0 |
| Plan expired / cancelled | 0 plan credits; bought top-up credits still usable |
| Non-USD invoice | Falls back to the list price |

---

## 7. Top-up credits (separate from plan credits)

Sold through aMember at **$0.132 per credit**, no discount for now:

| Pack | Price |
|---|---|
| 100 credits | $13.20 |
| 500 credits | $66.00 |
| 1000 credits | $132.00 |

A pack is credited **only after aMember records the payment** (a pending, failed or
abandoned checkout gives nothing). If the purchase is **refunded or charged back**
in aMember, the credits are removed again: all of them for a full refund, the same
share for a partial refund. Only credits the user hasn't spent yet can be removed,
and the history shows how many were already used (details: `MANIFEST.md` §14.6).

Top-up credits never expire and are never reset by a plan refresh. Plan credits
are always used first, top-up credits after. (`imageGen.topup` in config; a pack
discount, when added, is applied to the displayed price automatically — the
aMember product price must be changed to match.)

---

## 8. Changing these numbers

All in `config.json` → `imageGen.credits` (restart the backend; users get the new
amount from their next refresh):

| To change | Edit |
|---|---|
| Credit cost (e.g. model price changes) | `formula.costPerCreditUsd` |
| Share of price (10%) | `formula.budgetPercent` |
| Rounding | `formula.roundTo` (1 = no rounding) |
| Yearly given monthly instead of upfront | `yearly.upfront = false` |
| Legacy list prices | `listPrices["<family>"].monthly` |
| Trial minimum | `trial.minCredits` |
| A custom number for one plan (ignores the formula) | `byFamily["basic-2026"] = 75` or `byPlanId["72"] = 75` |
| A custom trial number for one plan | `trial.byFamily["basic-2026"] = 15` or `trial.byPlanId["72"] = 15` |

Full technical reference: `MANIFEST.md` §14.
