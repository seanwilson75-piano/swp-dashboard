---
name: swp-dashboard-backfill
description: "Use this when Sean wants to backfill historical days into the SWP Performance Dashboard's Airtable data using screenshots (Fathom analytics, SureCart orders/reports). Run in a normal Claude Chat session — NOT the daily Cowork skill."
---

# SWP Dashboard — Historical Backfill Guide

Backfills past days into the **Daily Product Stats** table (Airtable base
`appGGzkWDtvCU3wGk`, table `tblzeTGmTQJ6UOEJl`) from screenshots Sean provides.

**Why this is safe to run anytime:**
- Every record is keyed by `Record ID = "YYYY-MM-DD|Product Name"` (upsert key).
- Backfill always targets dates **before yesterday** — the daily Cowork run only
  ever writes/upserts "yesterday's" date. As long as the backfill date range
  doesn't overlap yesterday's date, there's zero collision risk.
- This guide does NOT touch `index.html`, `FUNNEL_CHAINS`, or any markers —
  it only writes rows to Airtable. The dashboard's `byProductPeriod` (weekly/YTD)
  will automatically reflect the backfilled data the next time Cowork runs,
  since those are built by querying Airtable across a date range.

---

## Recommended scope

**~30 days** is the sweet spot (see rationale: gives a full prior-30-day
baseline for spike detection, 4+ weeks of weekly comparisons, and enough
points for the monthly trend chart). Going further (60-90 days) is fine if
Sean has the screenshots, but isn't required.

Confirm the date range with Sean before starting — typically
"last 30 days, ending the day before the dashboard's first tracked day."

---

## What to ask Sean for (per day, or per week if that's how his screenshots are organized)

For each tracked page (see list below), from **Fathom Analytics**:
- Page Views
- Unique Visitors

For each product (see list below), from **SureCart** (Orders report / Reports → Bumps page):
- Order count
- Revenue (dollars)
- For Subscriptions: New Signups vs Renewals if visible (otherwise leave blank —
  do NOT guess)
- For Bumps/Upsells: Parent Orders (the parent product's order count for that day)

If Sean only has weekly-aggregate screenshots (not daily), it's fine to write
one record per product per **week** using the Monday date of that week as the
`Date` — note this in the record's `Notes` field (e.g. "Weekly aggregate, screenshot dated...").
Daily granularity is preferred but not required for older history.

---

## Tracked pathnames (Fathom)

```
/join-for-1-today/
/join-membership-today/
/standard-checkout-page/
/premium-checkout-page/
/annual-standard-checkout-page/
/annual-premium-checkout-page/
/4-week-beginner-sales-page/
/27musicians/
/april-focus-bundle-2026/
/dans-signature-sounds/
/drop-2-exercise-download-page/
/hear-any-chord/
/gospel-embell
/scales-charts/
/our-roadmap-offer/
```

## Tracked products / bumps / upsells (SureCart — exact names required)

| Product Name (exact) | Product Type | Parent Product (if Bump/Upsell) |
|---|---|---|
| `Basic Membership — 7 Day $1 Trial` | Subscription | — |
| `Basic Membership` | Subscription | — |
| `Premium Membership` | Subscription | — |
| `Annual Standard Membership` | Subscription | — |
| `Annual Premium Membership` | Subscription | — |
| `Master Beginner Fundamentals in 4 Days` | Product | — |
| `Beginner Practice Plan - for 4 Songs` | Bump | 4-Day Beginner Course |
| `27 Musicians Pro Musicians Bundle Pack` | Product | — |
| `Travis Sayles Organ Runs – Custom MIDI Transcription` | Bump | 27 Musicians Pro Musicians Bundle Pack |
| `27 Musicians Guided Study Session` | Bump | 27 Musicians Pro Musicians Bundle Pack |
| `April Focus Guide` | Product | — |
| `Dan's Signature Sounds` | Product | — |
| `Dan's Signature Sounds - Logic Sessions Pack` | Bump | Dan's Signature Sounds |
| `Mediant Drop 2 Exercise` | Product | — |
| `Piano Blueprint Session` | Coaching | — (sold via $1 Trial upsell AND a direct homepage CTA — note which in `Notes` if Sean can tell from the screenshot) |
| `Your First 30 Days: Member Practice Guide` | Bump | $1 Trial Membership |
| `Play Like Them: MIDI File Bundle 🎹🔥` | Bump | Basic Membership (or Annual Standard Membership — check which checkout page the screenshot is from) |
| `Master Beginner Fundamentals in 4 Days` (as a bump) | Bump | Annual Standard Membership / Annual Premium Membership — **see naming-collision warning below** |
| `Premium Membership` (as an upsell) | Upsell | 4-Day Beginner Course — only added Jun 11, 2026; don't backfill before that date |

**⚠️ Naming collision:** "Master Beginner Fundamentals in 4 Days" is sold both
as a standalone main product AND as a $0 bump on the Annual Standard/Premium
checkout pages. Since the Record ID is `YYYY-MM-DD|Product Name`, do NOT create
a second record with that exact name+date — it will overwrite the main product
record. If a screenshot shows it as a bump, just skip writing a separate row
for it (the take-rate limitation is already documented in the Cowork skill).

---

## Field mapping (Daily Product Stats table)

| Field | Field ID | Notes |
|---|---|---|
| Record ID | `fldq5e23DGa8BpJFU` | `YYYY-MM-DD\|Product Name` — exact match required for upsert |
| Date | `fldpXLQ7f7YArQ2WS` | YYYY-MM-DD |
| Product Name | `fldElt29AlVrqt8kW` | Exact name from table above |
| Product Type | `fldaDSMZxj0MH1L4v` | One of: Subscription, Product, Bump, Upsell, Lead Magnet, Coaching |
| Parent Product | `fldSiyrezf8Lafj2v` | Only for Bump/Upsell rows |
| Checkout Page Views | `fldNXDrSKfS0OHDEw` | From Fathom |
| Checkout Uniques | `fldsb51VFNGWgdTIl` | From Fathom |
| Orders | `fld484kz8strCDJoY` | From SureCart |
| Revenue | `fld73O4I32t6EizEU` | Dollars (currency field — do NOT multiply by 100, that conversion only happens in `SC_DATA` for the dashboard) |
| New Signups | `fldJDfygpRc6dKjy4` | Subscriptions only, leave blank if unknown |
| Renewals | `fldQoPfOyrhXFAT2B` | Subscriptions only, leave blank if unknown |
| Parent Orders | `fldDZmOLIgOm6H6tY` | Bumps/Upsells only — denominator for take rate |
| ManyChat Clicks | `fldccyzSz9rcoMPF3` | Leave blank if not in screenshot |
| ManyChat Keyword | `fldlx2D6TU9wiJMFu` | Leave blank if not in screenshot |
| Traffic Source | `fldcP97eyH8Pam5NH` | One of: Organic, ManyChat, Email, YouTube, Paid Ads, Mixed — use "Mixed" if unsure |
| Notes | `fldYmd2ow7dzhxTB7` | e.g. "Backfilled from screenshot, [date sourced]" |

---

## Write process

1. Confirm date range and gather screenshots from Sean (one message per
   day or week is fine — work through them incrementally).
2. For each (date, product/page) pair, build a record with `Record ID =
   "YYYY-MM-DD|Product Name"`.
3. Write using `update_records_for_table` with `performUpsert: true` and
   `fieldIdsToMergeOn: ["fldq5e23DGa8BpJFU"]` — this safely creates new
   records or updates existing ones without duplicates if the same day
   gets backfilled twice.
4. Use `typecast: true` if writing Product Type / Traffic Source as plain
   strings.
5. After each batch, briefly summarize what was written (date range,
   products, any gaps where data wasn't available) so Sean can sanity-check.
6. **Never guess numbers.** If a screenshot doesn't show a metric (e.g. no
   New Signups breakdown), leave the field blank — don't estimate.

---

## After backfilling

No dashboard file changes needed. The next daily Cowork run will pull
`byProductPeriod` (weekly/YTD) from Airtable across the full date range
including the new backfilled rows, and the dashboard's weekly/YTD views,
spike detection, and trend chart will reflect the extra history automatically.
