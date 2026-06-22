---
name: swp-performance-dashboard-refresh
description: "Daily SWP performance dashboard refresh — pulls Fathom + SureCart data and updates the dashboard HTML. Use this skill when Dispatch triggers the daily performance dashboard refresh, or when Sean says 'refresh the dashboard', 'update performance data', or 'run dashboard'."
---

# SWP Performance Dashboard — Cowork Skill v6.4

Refreshes the Sean Wilson Piano performance dashboard with live Fathom Analytics and SureCart data. Runs daily at 7:30 AM ET. Writes to Airtable.

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
8. Pre-publish sanity check — structure + values (MANDATORY)
9. Publish (git commit + push), or hold + flag if Step 8 found issues

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
field_grouping: pathname, sort_by: pageviews:desc, limit: 25
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

## Step 2 — Build SC_DATA.byProductPeriod and SC_PREV_WEEK from Airtable

After writing to Airtable, query Daily Product Stats to build period-matched revenue and the prior-week comparison baseline.

### 2A — byProductPeriod (3 queries)

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

### 2B — SC_PREV_WEEK (1 query, Airtable-only)

Query Daily Product Stats for the **prior 7-day window** (8 days ago to 14 days ago inclusive). Sum Orders per Product Name.

Build:
```js
const SC_PREV_WEEK = {
  "Basic Membership — 7 Day $1 Trial": { count: N, revenue: N },  // revenue in CENTS
  "Basic Membership": { count: N, revenue: N },
  // ... one key per product that had orders in that prior window
};
```

This is used by the dashboard alert engine to detect week-over-week sales spikes — it compares `byProductPeriod.weekly` (current week) against `SC_PREV_WEEK` (prior week). Both windows come from Airtable, so the comparison is apples-to-apples.

**If the prior-week window returns no records** (e.g., Airtable data starts later than 14 days ago), write `SC_PREV_WEEK = {}`. The alert engine checks `Object.keys(SC_PREV_WEEK).length > 0` before firing any sales alerts — an empty object silently suppresses them, which is correct.

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
const SC_PREV_WEEK   = { /* prior 7-day per product from Airtable (Step 2B) — for week-over-week spike detection */ };
const SC_DATA = {
  stats: {
    today:  { count: N, revenue: N },   // revenue in CENTS
    week:   { count: N, revenue: N },
    month:  { count: N, revenue: N },
    ytd:    { count: N, revenue: N },
  },
  byProduct: [ ["Product Name", {count:N, revenue:N}], ... ],  // same as byProductPeriod.ytd below (Airtable cumulative-to-date), CENTS
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

Overwrite: `~/Documents/Claude/Artifacts/swp-performance-dashboard/index.html`

(Snapshots, versioned copies, and the git commit are all handled by the push
script in Step 5 — don't duplicate them here.)

---

## Step 4.5 — Pre-Publish Sanity Check (MANDATORY — do not skip)

**This check exists because a previous run silently committed a data block that
was missing several required structures, breaking the live dashboard's 7-Day,
YTD, Growth, Funnel, and Monthly views for hours before it was caught. Do not
let this happen again.**

Before running Step 5, run:

```bash
grep -c -E "^const (FATHOM_DAILY|FATHOM_WEEKLY|FATHOM_YTD|SITE_TOTALS|MONTHLY|PREV_PERIOD|SPIKE_REFERRERS|SC_PREV_WEEK|SC_DATA|LAST_UPDATED)\b" ~/Documents/Claude/Artifacts/swp-performance-dashboard/index.html
```

This should report **10** (one per required `const`). Also confirm each of
these substrings is present in the new data block: `byProductPeriod`,
`recentOrders`, `lastFetched`, `growth:`, `monthlyNewSignups`, and that
`[FUNNEL-CHAINS-START]` / `FUNNEL_CHAINS = [` / `[FUNNEL-CHAINS-END]` are still
present and unchanged in size/shape from before this run's edit.

**If anything is missing:**
- Do NOT proceed to Step 5 (no commit, no push).
- Run `git -C ~/Documents/Claude/Artifacts/swp-performance-dashboard checkout -- index.html`
  to discard the broken edit and restore the last-good committed version.
- Report to Sean exactly which structure(s) were missing and that the dashboard
  file was reverted to the last good commit (so the live site is unaffected).
- It is far better to leave the dashboard one day stale than to push a file
  that's missing required data structures.

Optionally, also do a quick syntax check:
```bash
node -e "const fs=require('fs'); const html=fs.readFileSync(process.env.HOME+'/Documents/Claude/Artifacts/swp-performance-dashboard/index.html','utf8'); const block=html.split('// [DASHBOARD-DATA-START]')[1].split('// [DASHBOARD-DATA-END]')[0]; new Function(block)(); console.log('OK - data block parses');"
```
If this errors, treat it the same as a missing-structure failure above.

---

## Step 4.6 — Run-to-Run Anomaly Check (MANDATORY — do not skip)

**This check exists because the 2026-06-15 run hit a transient SureCart outage
and wrote a data block that PASSED Step 4.5 (all required `const`s present,
file parses) but had `SC_DATA.stats`, `byProduct`, `byProductPeriod`,
`recentOrders` amounts, `growth`, `PREV_PERIOD`, and `SC_PREV_WEEK` all nulled
out or emptied. Step 4.5 catches missing structures; this step catches
degraded *values* inside structures that are present.**

Before running Step 5, compare your new data block against the CURRENTLY LIVE
version:

```bash
git -C ~/Documents/Claude/Artifacts/swp-performance-dashboard show origin/main:index.html > /tmp/live-index.html
```

For each of the following, compare the LIVE (origin/main) value to the NEW
value you just wrote:

- `SC_DATA.stats.{today,week,month,ytd}.{count,revenue}`
- `SC_DATA.byProduct` (array length)
- `SC_DATA.byProductPeriod.ytd` (array length — `daily`/`weekly` MAY
  legitimately be empty on a no-order day, don't flag those)
- `SC_DATA.recentOrders` — count of entries with non-null `amount`
- `SC_DATA.growth.{week,month,ytd}.*`
- `PREV_PERIOD` — count of pathnames with non-zero `pageviews`
- `SC_PREV_WEEK` (object key count — may be `{}` early in the dataset when <14 days of Airtable data exist; only flag if it was previously non-empty and is now empty)

**Flag as DEGRADED** if the LIVE value was real (non-null, non-zero,
non-empty) and the NEW value is `null`, `0`, `[]`, or `{}` for the SAME field.

If you correctly applied the carry-forward rule above for a SureCart/Airtable
outage, NEW should equal (or closely match) LIVE for these fields — a
correctly-applied carry-forward passes this check. This step exists to catch
the case where carry-forward was skipped and fields were nulled instead.

**If DEGRADED:**
1. `git -C ~/Documents/Claude/Artifacts/swp-performance-dashboard checkout -- index.html`
   — discard the bad write; origin/main stays live and unaffected.
2. Do NOT proceed to Step 5.
3. Write/overwrite `~/Documents/Claude/Scheduled/swp-performance-dashboard-refresh/LAST_RUN_STATUS.md`:
```markdown
# Dashboard Refresh — [date/time]
**Status:** DEGRADED — not published
**Reason:** [which field(s) went from a real value to null/0/empty, old -> new]
**Action needed:** Sean (or a follow-up Cowork session) should re-pull the
affected source(s) and publish manually.
```
4. Stop. Report this clearly in your run summary.

**If OK (nothing degraded):**
1. Proceed to Step 5 (Publish).
2. After a successful push, write/overwrite the same status file:
```markdown
# Dashboard Refresh — [date/time]
**Status:** OK — published
**Commit:** [commit hash]
**Summary:** [one line, e.g. "14 orders, $412 revenue, traffic flat vs last week"]
```

---

## Step 5 — Publish (Cowork runs this directly — do NOT skip)

**⚠️ Historical note:** publishing used to be handled by a separate launchd job
(`com.seanwilson.swp-dashboard-push`). That job has been disabled — it ran a bare
`/bin/bash` script that macOS's Files & Folders privacy protection (TCC) blocked
from touching anything under `~/Documents` (`cp: index.html: Operation not
permitted`), so it silently failed every morning since ~June 8 and never reached
`git push`. Cowork's own process already has Documents access (it just wrote
`index.html` in Step 4), so Cowork now does the publish itself.

**Only proceed past this point if Step 4.5 AND Step 4.6 passed.** After Step 4
(and passing Steps 4.5 and 4.6), run:

```bash
git -C ~/Documents/Claude/Artifacts/swp-performance-dashboard pull --rebase origin main
~/swp-dashboard-push.sh
```

`~/swp-dashboard-push.sh` already exists and does the right thing: copies
`index.html` into `versions/[timestamp].html` and
`~/Documents/Claude/swp-dashboard-snapshot-[date].html`, commits (skipping if
nothing changed), and pushes to `origin main`.

- The `git pull --rebase` first picks up any same-day manual commits cleanly.
  If it reports a conflict, STOP and report it to Sean — do not force-push or
  discard either side. This should be rare since the daily replace only
  touches the `[DASHBOARD-DATA-START]`/`[DASHBOARD-DATA-END]` block.
- If `swp-dashboard-push.sh` exits non-zero for any reason, report the exact
  error/output in the run summary — don't silently retry or swallow it.
- On success, confirm in the run summary: "Pushed to GitHub → Vercel will
  auto-deploy. Live: https://swp-dashboard-five.vercel.app/"

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
| Fathom `get-aggregation` response too large / call errors out | `limit:25` (already set in Calls 1-3,6) should keep responses well under the ~21 tracked pathnames. If a call still fails, split it into two calls covering different pathname groups (e.g. checkout pages vs. content/lead-magnet pages) using `filters: [{property:"pathname", operator:"is", value:"..."}]` per group — do NOT drop tracked pathnames or fall back to manual/Python workarounds, and do NOT skip Step 5 because of this. |
| SureCart (or Airtable Daily Product Stats) unavailable mid-run | Do NOT null out or empty `SC_DATA` fields, `PREV_PERIOD`, `SC_PREV_WEEK`, or `byProductPeriod`. Carry forward the ENTIRE previous run's values for these structures unchanged (1-day-stale is fine and far better than nulls — the dashboard has no "pending" state and renders `null`/`[]`/`{}` as broken/empty). Still inject the Fathom-derived fields normally and update `LAST_UPDATED`. Note in the run summary which sections are stale so Sean can re-run later when the source is back up. |
| Airtable write fails | Log error, report to Sean, do not block dashboard inject |
| Growth query fails (non-Sunday) | Carry forward previous growth block unchanged |
| Revenue from SureCart in dollars | Multiply × 100 before storing in SC_DATA |
| Airtable revenue in dollars | Multiply × 100 when building byProductPeriod |
| Product not found in Airtable | Omit from byProductPeriod — dashboard shows N/A |
| Bump not in Bumps Report today | Write 0 for Orders, Revenue, Parent Orders |
| `git pull --rebase` conflict (Step 5) | Stop, do not force-resolve — report to Sean |
| `git push` fails (Step 5) | Report exact error to Sean — dashboard file is still saved locally, just not live |

---

## Schedule

| Task | When | Who |
|---|---|---|
| Full data refresh + Airtable write + inject | 7:30 AM ET daily | Cowork |
| New signups growth query | Sundays only | Cowork |
| Pre-publish sanity check (Step 4.5) | Immediately after inject, same run | Cowork |
| Run-to-run anomaly check (Step 4.6) | Immediately after Step 4.5, same run | Cowork |
| Write LAST_RUN_STATUS.md (OK or DEGRADED) | End of Step 4.6/5, every run | Cowork |
| Git commit + push → Vercel deploy (Step 5) | Immediately after passing Steps 4.5 and 4.6, same run | Cowork |
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

*Version: 6.5*
*Last updated: 2026-06-21 — Replaced SC_PREV_30 with SC_PREV_WEEK (Step 2B): prior-week comparison data now sourced from Airtable (8–14 days ago), not SureCart. Alert logic updated to compare `byProductPeriod.weekly` vs `SC_PREV_WEEK` (week-over-week, both from Airtable) instead of `byProduct` vs `SC_PREV_30` (which was YTD cumulative vs an often-empty or stale SureCart baseline — root cause of false 1029/1045 spike alerts). SC_PREV_WEEK = {} silently suppresses sales alerts rather than firing false positives. Dashboard HTML updated: Sales Detail KPI grid no longer duplicates Pageviews/Unique Visitors already shown in the global strip; "New Signups" renamed to "New Members" throughout; recurring subscription rows with 0 views and real sales now show an auto-renew explanatory note.*
*Last updated: 2026-06-15 — Unified the two skill copies: `Scheduled/swp-performance-dashboard-refresh/SKILL.md` is now a symlink to this file, so there is only ONE copy to edit going forward (previously, fixes made here didn't reach the actual scheduled run for days — see Jun 14 note below). Added mandatory Step 4.6 run-to-run anomaly check: the 2026-06-15 run nulled out SC_DATA/PREV_PERIOD/SC_PREV_30/byProductPeriod/growth/recentOrders after a transient SureCart outage — it passed Step 4.5 (structure intact) but was full of nulls. Step 4.6 compares new values against the live dashboard and holds the publish (writing LAST_RUN_STATUS.md instead) if real data would be replaced with null/0/empty. Also changed the Error Handling row for "SureCart unavailable" from "set SC_DATA = null" to "carry forward the previous run's values unchanged" — nulling was itself the bug. Clarified that `byProduct` is computed identically to `byProductPeriod.ytd` (both are Airtable cumulative-to-date, not a rolling 30-day window — Airtable's Daily Product Stats table only has data from 2026-06-01 onward).*
*Last updated: 2026-06-14 — Synced this scheduled copy with the maintained Artifacts copy (this file was 7 days stale, still listing old product names like "4-Day Beginner Course" / "$1 Trial Membership" instead of the current verified names). Added mandatory Step 4.5 pre-publish sanity check: a 2026-06-13 run silently dropped FATHOM_WEEKLY/FATHOM_YTD/MONTHLY/SC_DATA.growth/byProductPeriod/PREV_PERIOD/SPIKE_REFERRERS/SC_PREV_30 and pushed the broken file to production. Cowork must now verify all required `const` declarations are present (and the data block parses) before committing/pushing — if not, revert index.html and report to Sean instead of publishing.*
*v6.2: Cowork now publishes directly (Step 5): git commit + push every run, no more reliance on the broken `com.seanwilson.swp-dashboard-push` launchd job (disabled — TCC blocked it from `~/Documents`)*
*v6.1: added Premium/Annual Membership tracking, FUNNEL_CHAINS marker block (preserved across daily runs), and weekly Funnel Chains analysis sync (Step 3B)*
*Base: SWP Performance Data (`appGGzkWDtvCU3wGk`)*
*Dashboard: ~/Documents/Claude/Artifacts/swp-performance-dashboard/index.html*
