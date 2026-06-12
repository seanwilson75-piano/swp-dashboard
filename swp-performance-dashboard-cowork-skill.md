---
name: swp-performance-dashboard
description: "Use this skill when Dispatch triggers the daily performance dashboard refresh, or when Sean says 'refresh the dashboard', 'update performance data', or 'run dashboard'. This skill pulls live Fathom + SureCart data, writes to Airtable, and injects into the performance dashboard HTML file on disk."
---

# SWP Performance Dashboard — Cowork Skill v6

Refreshes the Sean Wilson Piano performance dashboard with live Fathom Analytics and SureCart data. Runs daily at 7:30 AM ET. Writes to Airtable. Pushes to Vercel via launchd at 8:00 AM ET.

**Output file:** `~/Documents/Claude/Artifacts/swp-performance-dashboard/index.html`
**Snapshot file:** `~/Documents/Claude/swp-dashboard-snapshot-[YYYY-MM-DD].html`
**Live URL:** https://swp-dashboard-five.vercel.app/
**Airtable Base:** SWP Performance Data (`appGGzkWDtvCU3wGk`)

---

## Overview of Daily Run Sequence

1. Pull Fathom traffic data (5 calls)
2. Pull SureCart orders, revenue, and bumps data
3. Pull SureCart new signups (Sundays only)
4. **Write all data to Airtable** (every run)
5. Build SC_DATA.byProductPeriod from Airtable records
6. Inject everything into index.html
7. Save files

---

## Step 1A — Fathom Analytics (Site BCWEGICN)

Call `fathom-analytics:get-aggregation` five times simultaneously.

**Tracked pathnames:**
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
/break
/drop-2-exercise-download-page/
/hear-any-chord/
/gospel-embell
/scales-charts/
/our-roadmap-offer/
/major-vs-minor-quiz/
/available-to-you/
/new-1trial-registration-page/
/27-bundle-waitlist/
/9sus4-to-dominant-release/
```

**Call 1 — Daily (yesterday's completed day):**
```
entity: pageview, entity_id: BCWEGICN
aggregates: pageviews,uniques,visits,avg_duration,bounce_rate
date_from: [YESTERDAY], date_to: [YESTERDAY]
field_grouping: pathname, sort_by: pageviews:desc, limit: 100
timezone: America/New_York
```

**Call 2 — Weekly (last 7 completed days):**
Same params, date_from: 7 days ago, date_to: yesterday

**Call 3 — YTD:**
Same params, date_from: 2026-01-01, date_to: yesterday

**Call 4 — Monthly trend:**
```
entity: pageview, entity_id: BCWEGICN
aggregates: pageviews,uniques,visits
date_from: 2026-01-01, date_to: yesterday
date_grouping: month
timezone: America/New_York
```

**Call 5 — Site-wide totals (no field_grouping), same 3 windows.**

**Call 6 — Prior week (for spike detection):**
Same as weekly but date_from: 14 days ago, date_to: 8 days ago

**Call 7 — Spike source attribution (conditional, run AFTER Calls 2 & 6):**
For each TRACKED page whose weekly pageviews (Call 2) are >= 2x its prior-week
pageviews (Call 6) — same threshold the dashboard uses for its spike alert —
run one extra Fathom call to find what drove it:
```
entity: pageview, entity_id: BCWEGICN
aggregates: pageviews
date_from: 7 days ago, date_to: yesterday
field_grouping: pathname,referrer_hostname,utm_source,utm_campaign
filters: [{ property: "pathname", operator: "is", value: "[SPIKING SLUG]" }]
sort_by: pageviews:desc, limit: 5
timezone: America/New_York
```
Take the top 1-2 rows (by pageviews) and turn each into a short human-readable
source label, e.g.:
- if `utm_source`/`utm_campaign` present → `"youtube: [utm_campaign]"` or `"manychat: [utm_campaign]"`
- else if `referrer_hostname` present → that hostname (e.g. `"youtube.com"`)
- else → `"direct/unknown"`

Store as `{ source: "...", views: N }` per spiking page — written into
`SPIKE_REFERRERS` in Step 3. If no pages spiked, `SPIKE_REFERRERS = {}`.

---

## Step 1B — SureCart Orders & Revenue

Use SureCart Abilities (natural language MCP). Pull for yesterday's completed date.

**Prompt 1 — Items Purchased report:**
```
Show me the Items Purchased report for [YESTERDAY DATE].
List each product name, number of orders, and total sales.
```

**Prompt 2 — Bumps report:**
```
Show me the Bumps report for [YESTERDAY DATE].
List each bump name, offers shown, accepted count, acceptance rate, and total sales.
```

**Prompt 3 — Revenue summary:**
```
Show me total revenue and order count for yesterday, the last 7 days,
last 30 days, and YTD 2026.
```

**Prompt 4 — Recent orders:**
```
Show me the 8 most recent paid orders.
Include order number, date, status, and amount for each.
```

Store results in memory for Airtable write (Step 1D) and dashboard inject (Step 2).

---

## Step 1C — SureCart New Signups (Sundays only)

Run only on Sundays. On all other days, carry forward the previous growth block unchanged.

```
List all subscriptions created in the last 7 days. Give me count and total amount.
Do the same for last 30 days and YTD 2026 (since Jan 1 2026).
Also give me a monthly breakdown of new subscriptions created each month in 2026.
```

Renewal count = total subscription orders in window − new signups.

---

## Step 1D — Write to Airtable Daily Product Stats

**⚠️ This step runs on EVERY refresh — daily, on-demand, and scheduled.**

**Base ID:** `appGGzkWDtvCU3wGk`
**Table:** Daily Product Stats (`tblzeTGmTQJ6UOEJl`)
**Date to write:** YESTERDAY (the completed day being reported)

### Field IDs

| Field Name | Field ID | Type | Notes |
|---|---|---|---|
| Record ID | `fldq5e23DGa8BpJFU` | singleLineText | Upsert key: `YYYY-MM-DD\|Product Name` |
| Date | `fldpXLQ7f7YArQ2WS` | date | ISO: `2026-06-07` |
| Product Name | `fldElt29AlVrqt8kW` | singleLineText | Exact SureCart name |
| Product Type | `fldaDSMZxj0MH1L4v` | singleSelect | Subscription / Product / Bump / Upsell / Lead Magnet / Coaching |
| Parent Product | `fldSiyrezf8Lafj2v` | singleLineText | Bumps/upsells only |
| Checkout Page Views | `fldNXDrSKfS0OHDEw` | number | Fathom daily pageviews |
| Checkout Uniques | `fldsb51VFNGWgdTIl` | number | Fathom daily uniques |
| Orders | `fld484kz8strCDJoY` | number | SureCart paid orders |
| Revenue | `fld73O4I32t6EizEU` | currency | **Dollars** (not cents) e.g. 29.00 |
| New Signups | `fldJDfygpRc6dKjy4` | number | Subscriptions only |
| Renewals | `fldQoPfOyrhXFAT2B` | number | Subscriptions only: orders minus new signups |
| Parent Orders | `fldDZmOLIgOm6H6tY` | number | Bumps: accepted count from Bumps Report |
| ManyChat Clicks | `fldccyzSz9rcoMPF3` | number | Fathom pageviews with utm_source=manychat |
| ManyChat Keyword | `fldlx2D6TU9wiJMFu` | singleLineText | utm_campaign value |
| Traffic Source | `fldcP97eyH8Pam5NH` | singleSelect | Organic / ManyChat / Email / YouTube / Paid Ads / Mixed |
| Notes | `fldYmd2ow7dzhxTB7` | singleLineText | Optional |

### Upsert Logic

Merge key: `Record ID` field (`fldq5e23DGa8BpJFU`)
Format: `2026-06-07|Basic Membership — 7 Day $1 Trial`

If record exists → update it. If not → create it. Safe to re-run.

### Verified Product & Bump Names

**⚠️ These names are verified against live SureCart order data. Use exactly as written.**

**Main products — write one record each:**

| Product Name (exact) | Type | Fathom Slug |
|---|---|---|
| `Basic Membership — 7 Day $1 Trial` | Subscription | `/join-for-1-today/` |
| `Basic Membership` | Subscription | `/standard-checkout-page/` |
| `Premium Membership` | Subscription | `/premium-checkout-page/` |
| `Annual Standard Membership` | Subscription | `/annual-standard-checkout-page/` |
| `Annual Premium Membership` | Subscription | `/annual-premium-checkout-page/` |
| `Master Beginner Fundamentals in 4 Days` | Product | `/4-week-beginner-sales-page/` |
| `27 Musicians Pro Musicians Bundle Pack` | Product | `/27musicians/` |
| `April Focus Guide` | Product | `/april-focus-bundle-2026/` |
| `Dan's Signature Sounds` | Product | `/dans-signature-sounds/` |
| `Piano Blueprint Session` | Coaching | `/break` |
| `Mediant Drop 2 Exercise` | Product | `/drop-2-exercise-download-page/` |
| `Hear Any Chord — Free Ear Training Chart` | Lead Magnet | `/hear-any-chord/` |
| `Roadmap Lead` | Lead Magnet | `/our-roadmap-offer/` |
| `Major vs Minor Quiz` | Lead Magnet | `/major-vs-minor-quiz/` |
| `Scales Charts` | Lead Magnet | `/scales-charts/` |

**Bumps — write one record each, data from SureCart Reports → Bumps:**

| Bump Name (exact) | Parent Product | Price |
|---|---|---|
| `Your First 30 Days: Member Practice Guide` | `Basic Membership — 7 Day $1 Trial` | $17 |
| `Beginner Practice Plan - for 4 Songs` | `Master Beginner Fundamentals in 4 Days` | $12 |
| `Play Like Them: MIDI File Bundle 🎹🔥` | `Basic Membership` | varies |
| `Travis Sayles Organ Runs – Custom MIDI Transcription` | `27 Musicians Pro Musicians Bundle Pack` | $14 |
| `27 Musicians Guided Study Session` | `27 Musicians Pro Musicians Bundle Pack` | $9 |
| `Dan's Signature Sounds - Logic Sessions Pack` | `Dan's Signature Sounds` | varies |
| `Play Like Them: MIDI File Bundle 🎹🔥` | `Annual Standard Membership` | $22 |

**Bump data source:** SureCart Reports → Bumps page only.
Do NOT parse line items. The Bumps report gives you: name, offers shown, accepted, acceptance rate, total sales — use this directly.

**⚠️ Naming collision — "Master Beginner Fundamentals in 4 Days":** this product is sold both as a
standalone main product AND as a $0 bump on the Annual Standard / Annual Premium checkout pages.
Because the Record ID upsert key is `YYYY-MM-DD|Product Name`, do NOT write a second "bump" record
for it — that would overwrite the main product record. Leave it as a main-product record only.
The dashboard's Annual Standard/Premium funnel cards reference it for take-rate display, but the
take rate will reflect *total* sales of that product (not Annual-plan-only), which is a known
limitation until Airtable tracks bump-attached sales separately.

For bump records:
- `Orders` = Accepted count from Bumps Report
- `Parent Orders` = Accepted count (same — offers accepted = orders)
- `Revenue` = Total Sales from Bumps Report (in dollars)

---

## Step 1E — Weekly Rollup Write (Sundays only)

**Table:** Weekly Rollups (`tblqGNVbsJAnJOpYn`)

Query last 7 days of Daily Product Stats and sum by product. Write one record per product.

**Record ID format:** `2026-W23|Basic Membership — 7 Day $1 Trial`

| Field Name | Field ID |
|---|---|
| Record ID | `fldXdEPxocEfHpOcB` |
| Week Start | `fldTysat2kwRKQu9o` |
| Week End | `fldm8YCI8sDE4zhVw` |
| Product Name | `fldFfgRtyDVVYPjrT` |
| Product Type | `fldnhp0TMXLXsI96n` |
| Parent Product | `fldtmrwLw2gBg7C5R` |
| Total Views | `fldrUIbKPtaNtHvYP` |
| Total Uniques | `fld1CAakmclja5wEQ` |
| Total Orders | `fldw46EN58mnZMsvF` |
| Total Revenue | `fldTKcXGNmxIsahbf` |
| New Signups | `fldGL6miNxlzqK1js` |
| Renewals | `fldldlE4bysp4laX5` |
| Parent Orders | `fldPGvtUuq4an6ZIm` |
| ManyChat Clicks | `fldsVPIQfpzieAP0S` |
| Prior Week Orders | `fld90eJX2jdiWGvB9` |
| Prior Week Revenue | `fldyYu9x2XgvFIA5c` |

Prior Week fields: copy from previous week's rollup record for same product.

---

## Step 2 — Build SC_DATA.byProductPeriod from Airtable

After writing to Airtable, query Daily Product Stats to build period-matched revenue.

Query for each window using yesterday as the end date:
- **daily:** Date = yesterday
- **weekly:** Date >= 7 days ago AND <= yesterday
- **ytd:** Date >= 2026-01-01 AND <= yesterday

Sum Orders and Revenue per Product Name for each window.

Build:
```js
SC_DATA.byProductPeriod = {
  daily: [
    ["Basic Membership — 7 Day $1 Trial", { count: N, revenue: N }],  // revenue in CENTS
    ...
  ],
  weekly: [ ... ],
  ytd: [ ... ],
};
```

**Revenue conversion:** Airtable stores dollars → multiply × 100 for dashboard (dashboard uses cents).

If a product has no Airtable records for a period → omit it. Dashboard shows "N/A".

**Product names to include when present:** alongside the existing products, also check for and include `Premium Membership`, `Annual Standard Membership`, and `Annual Premium Membership` in `byProductPeriod` — these are now tracked on the dashboard (Recurring Subscriptions section + Funnel tab) and will show "N/A" if missing for periods where they had no orders.

---

## Step 3 — Inject Data into Dashboard File

Read: `~/Documents/Claude/Artifacts/swp-performance-dashboard/index.html`

Find and replace between markers:
```js
// [DASHBOARD-DATA-START]
...
// [DASHBOARD-DATA-END]
```

Replace with fresh data block containing:
```js
const FATHOM_DAILY   = { /* yesterday per pathname */ };
const FATHOM_WEEKLY  = { /* last 7 days per pathname */ };
const FATHOM_YTD     = { /* YTD per pathname */ };
const SITE_TOTALS    = { daily:{...}, weekly:{...}, ytd:{...} };
const MONTHLY        = [ {month:"Jan", pageviews:N, uniques:N}, ... ];
const PREV_PERIOD    = { /* prior 7-day per pathname for spike detection */ };
const SPIKE_REFERRERS = { /* from Step 1A Call 7 — only for pages that spiked this week */
  // "/dans-signature-sounds/": [{ source:"youtube: video-title-utm", views:45 }],
};
const SC_PREV_30     = { /* prior 30-day per product for spike detection */ };
const SC_DATA = {
  stats: {
    today:  { count: N, revenue: N },   // revenue in CENTS
    week:   { count: N, revenue: N },
    month:  { count: N, revenue: N },
    ytd:    { count: N, revenue: N },
  },
  byProduct: [ ["Product Name", {count:N, revenue:N}], ... ],  // 30-day, CENTS
  byProductPeriod: {
    daily:  [ ["Product Name", {count:N, revenue:N}], ... ],   // CENTS
    weekly: [ ... ],
    ytd:    [ ... ],
  },
  recentOrders: [ {id, number, created_at, status, amount}, ... ],  // amount CENTS
  lastFetched: "Jun 8, 7:32 AM",
  growth: {
    week:  { newSignups:N, newRevenue:N, renewals:N, renewalRevenue:N, totalRevenue:N },
    month: { newSignups:N, newRevenue:N, renewals:N, renewalRevenue:N, totalRevenue:N },
    ytd:   { newSignups:N, newRevenue:N, renewals:N, renewalRevenue:N, totalRevenue:N },
    monthlyNewSignups: [ {month:"Jan", count:N}, ... {month:"Jun", count:N, partial:true} ],
  },
};
const LAST_UPDATED = "Jun 8, 7:32 AM";
// [DASHBOARD-DATA-END]
```

**CRITICAL:** Never touch anything outside the `[DASHBOARD-DATA-START]` / `[DASHBOARD-DATA-END]` marker comments.

**⚠️ FUNNEL-CHAINS block — DO NOT TOUCH on daily runs:** Immediately after `[DASHBOARD-DATA-END]`, the file contains a separate block:
```js
// [FUNNEL-CHAINS-START]
const FUNNEL_CHAINS = [ ... ];
// [FUNNEL-CHAINS-END]
```
This block is OUTSIDE the daily-replaced region and drives the Funnel tab (parent products, bumps, upsells, take rates, analysis notes). The daily find/replace must only target the content between `[DASHBOARD-DATA-START]` and `[DASHBOARD-DATA-END]` — never delete, overwrite, or shift the `[FUNNEL-CHAINS-START]`/`[FUNNEL-CHAINS-END]` block. If your replace logic does a broad "replace everything from X to Y" match, double-check the FUNNEL_CHAINS block still exists in the file after saving.

**Revenue units throughout:** ALL revenue in SC_DATA is in CENTS. Airtable stores dollars — multiply × 100 when building SC_DATA. Dashboard divides by 100 for display.

**On non-Sunday runs:** carry the existing `SC_DATA.growth` block forward unchanged.

---

## Step 3B — Weekly Funnel Chains Sync (Sundays only)

On Sunday runs, after completing Steps 1–6, sync the `FUNNEL_CHAINS[].analysis` text in `index.html` with the Airtable "Funnel Chains" table:

1. Query the **Funnel Chains** table (`tbl7QFUxVZHuSy6e4`) in base `appGGzkWDtvCU3wGk`.
2. For each record, read the **Analysis Notes** field (`fldesqnvleEWUqeOO`).
3. In `index.html`, find the matching entry in `FUNNEL_CHAINS` (matched by `parent` product name) and update its `analysis` field to the current Analysis Notes text.
4. If a record's Analysis Notes is empty, leave the existing `analysis` value in `index.html` unchanged (don't blank it out).
5. If bumps/upsells have changed (new bump added, price changed), update the corresponding `bumps`/`upsells` entries in `FUNNEL_CHAINS` to match.
6. This edit happens INSIDE the `[FUNNEL-CHAINS-START]`/`[FUNNEL-CHAINS-END]` block — it's the one block the daily run must never touch, but the weekly run is allowed to edit it deliberately.

---

## Step 4 — Save Files

1. Overwrite: `~/Documents/Claude/Artifacts/swp-performance-dashboard/index.html`
2. Save snapshot: `~/Documents/Claude/swp-dashboard-snapshot-[YESTERDAY-DATE].html`

---

## Step 5 — Publish (launchd handles this separately)

Cowork does NOT run the push script. Publishing is handled by a separate launchd job:
- **Job:** `com.seanwilson.swp-dashboard-push`
- **Fires:** daily at 8:00 AM ET automatically
- **Does:** git commit + push → GitHub → Vercel auto-deploys
- **Live URL:** https://swp-dashboard-five.vercel.app/
- **Logs:** `~/Library/Logs/swp-dashboard-push.log`

⚠️ Timing: this task runs at ~7:30 AM. The push fires at 8:00 AM — 30 min buffer. Do not change either schedule without adjusting both.

---

## Step 6 — Morning Briefing Snippet

Inject into morning briefing HTML (slot: `dashboard-summary`):

```html
<div class="project-card" style="border-left:3px solid #E8472A">
  <div style="font-weight:700;margin-bottom:6px">📊 Performance Snapshot — [YESTERDAY DATE]</div>
  <div>Trial page: <strong>[daily views] views</strong> · Beginner Course: <strong>[daily views]</strong></div>
  <div>Revenue yesterday: <strong>$[yesterday total]</strong> · This week: $[week total]</div>
  <div>New signups this week: <strong>[newSignups]</strong> · Renewals: [renewals]</div>
  <a href="file:///Users/jameswilson/Documents/Claude/Artifacts/swp-performance-dashboard/index.html"
     style="display:inline-block;margin-top:8px;padding:4px 12px;background:#E8472A;color:#fff;border-radius:5px;font-size:12px;text-decoration:none">
    Open Full Dashboard →
  </a>
</div>
```

---

## Error Handling

| Failure | Action |
|---|---|
| Fathom returns no data for a pathname | Set entry to `{pageviews:0, uniques:0, avg_duration:0, bounce_rate:0}` |
| SureCart Abilities unavailable | Set `SC_DATA = null` — Sales tab shows "pending" |
| Airtable write fails | Log error, report to Sean, do not block dashboard inject |
| Growth query fails (non-Sunday) | Carry forward previous growth block unchanged |
| Revenue from SureCart in dollars | Multiply × 100 before storing in SC_DATA |
| Airtable revenue in dollars | Multiply × 100 when building byProductPeriod |
| Product not found in Airtable | Omit from byProductPeriod — dashboard shows N/A |
| Bump not in Bumps Report today | Write 0 for Orders, Revenue, Parent Orders |

---

## Schedule

| Task | When | Who |
|---|---|---|
| Full data refresh + Airtable write + inject | 7:30 AM ET daily | Cowork |
| New signups growth query | Sundays only | Cowork |
| Git push → Vercel deploy | 8:00 AM ET daily | launchd |
| On demand | "refresh dashboard" | Cowork |

---

## MCP Tools Required

| Tool | Purpose |
|---|---|
| `fathom-analytics:get-aggregation` | Traffic per page and site-wide |
| SureCart Abilities (WordPress MCP) | Orders, revenue, bumps |
| Airtable MCP | Write Daily Product Stats + Weekly Rollups; read back for byProductPeriod |
| File write | Inject into index.html |

All tools already connected on Mac Studio. No API keys needed.

---

## Key Facts

- **Date written to Airtable:** always YESTERDAY (completed day), not today
- **Airtable revenue:** dollars (e.g. 29.00)
- **SC_DATA revenue:** cents (e.g. 2900)
- **Upsert key format:** `YYYY-MM-DD|Exact Product Name`
- **Bump data source:** SureCart Reports → Bumps page ONLY — do not parse line items
- **Product names:** verified against live SureCart order data June 7, 2026

---

*Version: 6.1*
*Last updated: 2026-06-11 — added Premium/Annual Membership tracking, FUNNEL_CHAINS marker block (preserved across daily runs), and weekly Funnel Chains analysis sync (Step 3B)*
*Base: SWP Performance Data (`appGGzkWDtvCU3wGk`)*
*Dashboard: ~/Documents/Claude/Artifacts/swp-performance-dashboard/index.html*
