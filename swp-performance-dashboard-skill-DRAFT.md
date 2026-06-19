---
name: swp-performance-dashboard-refresh
description: "DRAFT — NOT ACTIVE. Daily SWP performance dashboard refresh: pulls Fathom + SureCart data, writes to Airtable, updates the dashboard HTML. Do not register this with Cowork or any scheduler until the STATUS section below says ACTIVE."
---

# SWP Performance Dashboard — Refresh Spec & Instructions (DRAFT v7.0)

## STATUS: 🔴 PAUSED — manual runs only, Cowork eliminated

This replaces the old `swp-performance-dashboard-cowork-skill.md` (deleted) and
the stale `swp-performance-dashboard.skill` zip bundle (deleted). Both are gone
from this repo. **There is now exactly one instructions document, and it is
not wired up to any automation.**

**Why:** On 2026-06-17 a run pushed fabricated data straight to `main`,
overwriting a legitimate refresh. Investigating it surfaced two compounding
problems:
1. The skill had been patched reactively six times (v6.0 → v6.5), each patch
   bolted on after a different failure mode was caught in production.
2. A **frozen `.skill` zip bundle** existed alongside the maintained `.md`,
   completely out of sync — missing the Airtable writes and every sanity
   check added since v6.2. If Cowork's scheduler was reading from that bundle
   instead of the `.md`, every fix made to the `.md` was silently never
   applied to the actual scheduled run. This is the likely explanation for
   the "fixes didn't reach the actual scheduled run for days" note in the old
   v6.4 changelog.

Rather than patch a seventh time, this is a clean rewrite, and it stays in
**DRAFT / PAUSED** status until Sean runs it manually for several days and
the checklist in Section 6 has been exercised against real data and real
failure cases.

**Promotion checklist (all must be true before flipping to ACTIVE):**
- [ ] At least 2-3 consecutive manual runs completed via this doc, each
      reviewed by Sean before push
- [ ] Section 6's checklist has been run for real at least once and caught
      nothing it shouldn't have (no false positives) and would have caught
      the 2026-06-17 incident if re-run against that bad data (verify this
      explicitly — replay the bad commit's data through the checklist)
- [ ] Sean has confirmed, on his end, exactly what triggers this skill in
      Cowork (Dispatch config, any cron/launchd job, any cached/packaged
      `.skill` bundle outside this repo) and removed/repointed all of them
      at this single file — **this step happens outside this repo and I
      (Claude, in this sandbox) cannot verify or perform it**
- [ ] No second copy of this file exists anywhere (no symlink target outside
      this repo, no packaged zip) — single source of truth, full stop

---

## 1. Goals

- Keep `index.html` (the live dashboard at https://swp-dashboard-five.vercel.app/)
  accurate, current, and never showing fabricated or stale-and-unlabeled data.
- Keep Airtable base **SWP Performance Data** (`appGGzkWDtvCU3wGk`) as the
  durable system of record for daily product/bump stats — `index.html` is a
  rendering of this data, not an independent source.
- A bad or uncertain data pull should result in **no push** and a clear
  written reason, never a guess that looks plausible.
- Whoever/whatever runs this (Sean manually, or Cowork later) should be able
  to follow it without needing the history of why each check exists — but
  the "why" is kept in Section 6 anyway, because removing context is how the
  old skill rotted.

**Out of scope for this rewrite:** the HTML structure and Airtable schema
already work and are not being redesigned. This document is only about the
*process and instructions* for the daily pull/inject/check/publish cycle.

---

## 2. Architecture (already built — reference only)

```
Fathom Analytics  ──┐
                     ├──→  Airtable (Daily Product Stats)  ──→  index.html  ──→  Vercel (auto-deploy on push to main)
SureCart          ──┘
```

- **Output file:** `index.html` (this repo, `main` branch)
- **Airtable base:** SWP Performance Data (`appGGzkWDtvCU3wGk`)
  - Daily Product Stats: `tblzeTGmTQJ6UOEJl`
  - Weekly Rollups: `tblqGNVbsJAnJOpYn`
  - Funnel Chains: `tbl7QFUxVZHuSy6e4`
- **Live URL:** https://swp-dashboard-five.vercel.app/
- Data is written to Airtable for **YESTERDAY** (the last fully-completed
  day), never today (today is incomplete).

---

## 3. Daily Data Flow (high level)

1. Pull Fathom traffic data (yesterday, last 7 days, YTD, monthly trend, prior
   week, site totals).
2. Pull SureCart orders/revenue/bumps for yesterday, and recent orders.
3. Sundays only: pull new-signup growth data.
4. Write yesterday's per-product stats to Airtable (every run — safe to
   re-run, upsert keyed).
5. Query Airtable to build period-matched (`daily`/`weekly`/`ytd`) revenue
   per product.
6. Inject everything into `index.html` between the `[DASHBOARD-DATA-START]` /
   `[DASHBOARD-DATA-END]` markers. Never touch `[FUNNEL-CHAINS-START]` /
   `[FUNNEL-CHAINS-END]` on a daily run.
7. Run the full checklist in Section 6. Any failure → stop, do not push,
   write a status note explaining exactly what failed.
8. Commit and push to `main` only if Section 6 passed completely.

---

## 4. Data Sources — pull instructions

### 4.1 Fathom Analytics (Site `BCWEGICN`)

Tracked pathnames:
```
/join-for-1-today/
/join-membership-today/
/standard-checkout-page/
/premium-checkout-page/
/annual-standard-checkout-page/
/annual-premium-checkout-page/
/4-week-beginner-sales-page/
/4-day-beginner-checkout/
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

Pulls needed, all for `timezone: America/New_York`:
| # | Window | Grouping | Notes |
|---|---|---|---|
| 1 | Yesterday only | by pathname | `aggregates: pageviews,uniques,visits,avg_duration,bounce_rate`, `limit:25` |
| 2 | Last 7 completed days | by pathname | same aggregates |
| 3 | YTD (2026-01-01 → yesterday) | by pathname | same aggregates |
| 4 | YTD | by month | `aggregates: pageviews,uniques,visits` — monthly trend |
| 5 | Yesterday / last 7 days / YTD | **no grouping** | site-wide totals |
| 6 | 14 days ago → 8 days ago | by pathname | prior week, for spike detection |
| 7 (conditional) | Last 7 days | by pathname + referrer_hostname + utm_source + utm_campaign, filtered to one spiking pathname | only for pages where weekly (call 2) ≥ 2× prior-week (call 6) — identifies what drove the spike |

If Fathom returns no data for a pathname: `{pageviews:0, uniques:0, avg_duration:0, bounce_rate:0}` — never omit a tracked pathname.

If a call errors from response size: split by pathname group, don't drop pathnames, don't skip the rest of the run.

### 4.2 SureCart Orders & Revenue

Pull for yesterday's completed date:
1. Items Purchased report (yesterday) — product name, order count, total sales
2. Bumps report (yesterday) — bump name, offers shown, accepted, acceptance rate, total sales
3. Revenue summary — count + revenue for yesterday, last 7 days, last 30 days, YTD
4. 8 most recent paid orders — **must include the real order number, real UUID-style `id`, real ISO-8601 `created_at`, status, amount.** If the source data doesn't have a real ID/timestamp, do not invent one — see Section 6, check 1.

Sundays only — new signups:
```
List all subscriptions created in the last 7 days. Count and total amount.
Same for last 30 days and YTD. Monthly breakdown of new subscriptions in 2026.
```
Renewals = total subscription orders in window − new signups.

**If SureCart/Airtable is unavailable mid-run:** carry forward the entire
previous run's values for `SC_DATA`, `PREV_PERIOD`, `SC_PREV_30`, and
`byProductPeriod` unchanged. Never null or zero them out — the dashboard
renders `null`/`[]`/`{}` as visibly broken. Still update the Fathom-derived
fields and `LAST_UPDATED`, and say explicitly in the run summary which
sections are stale.

#### 4.2.1 Quick-pull instructions (hand this to Cowork, or paste into chat)

Only ONE day of SureCart source data is ever needed per run — yesterday.
Every earlier day is already in Airtable's Daily Product Stats table and is
not re-pulled or re-derived from SureCart; Claude rolls weekly/30-day/YTD
totals up from Airtable plus this one new day. Note: Airtable's Daily
Product Stats table only goes back to **2026-05-02** — it is not a full-year
history, so true YTD count/revenue still comes from SureCart's own Revenue
Summary report (a single native running total, not a reconstruction).

```
Pull SureCart data for [YESTERDAY'S DATE] only:

1. Revenue Summary report (no date filter — it shows running totals).
   Report: count + revenue for yesterday, trailing 7 days, trailing 30
   days, and year-to-date.
2. Items Purchased report, filtered to [YESTERDAY'S DATE] only (single
   day, not a range). Report: product name, order count, total sales —
   for every product with ≥1 order that day.
3. Bumps report, filtered to [YESTERDAY'S DATE] only. Report: bump name,
   offers shown, offers accepted, acceptance rate, total sales.
4. Recent Orders — most recent 8 paid orders regardless of date. Report:
   order number, UUID id, ISO-8601 created_at, status, dollar amount —
   for each.

Do NOT pull multi-day, 30-day, or YTD breakdowns by product — that history
already exists, validated, in Airtable. Use the exact product names from
this doc's reference table; never invent a new product name for an A/B
test's second entry page (e.g. /4-day-beginner-checkout/ and
/4-week-beginner-sales-page/ are both "Master Beginner Fundamentals in 4
Days" — not a separate product).
```

### 4.2.2 Known Cowork bugs

Found 2026-06-19 by reconciling several weeks of Cowork-pulled SureCart data
against a full SureCart order export (CSV, all orders, not date-filtered).
None of these produce nulls, zeros, or structurally-broken output — they all
look like plausible, well-formed data, which is exactly why they survived
in `index.html`/Airtable for weeks without tripping Section 6. Treat a full
CSV export as ground truth when it disagrees with a Cowork natural-language
pull.

1. **Bumps report can undercount combo checkouts by exactly one order.**
   2026-06-18: Bumps report said "Your First 30 Days: Member Practice Guide"
   had 1 accepted offer / $17. Items Purchased and the full CSV export both
   showed 2 orders / $34 that day. The missing order was a checkout where the
   bump was bundled with the Trial in a single combo purchase — the Bumps
   report's offer-acceptance view didn't surface it as a separate accepted
   offer. A prior run hit this exact discrepancy and *trusted the Bumps
   report over Items Purchased*, reasoning it would avoid double-counting —
   that reasoning was wrong here. **When Bumps and Items Purchased disagree
   on a bump's count, don't default to either one — flag it and, if
   possible, check the actual orders for that product/date.**

2. **An A/B-test checkout pathname can get logged as a phantom second
   product.** `/4-day-beginner-checkout/` (one of the two entry points for
   `Master Beginner Fundamentals in 4 Days`, see reference table) was being
   written to Airtable under a new, never-defined product name, **"4-Day
   Beginner Course,"** starting 2026-05-02. This silently fragmented the
   product's order history under two names for ~7 weeks. Fixed 2026-06-19:
   renamed all 15 affected rows (not the ~24 first estimated — confirmed by
   exact-match filter; actual revenue was $612, not the $648 first
   estimated) to the canonical product name. Two dates (Jun 10, Jun 15)
   already had a legitimate same-day row under the canonical name, so the
   rename created two upsert-key collisions; both duplicate rows had
   0 orders/$0 revenue, so they were deleted outright after confirming nothing
   else needed to be merged from them (one also had Fathom Checkout Page
   Views/Uniques worth recovering — see Reference Table A/B-test note for
   the canonical product name; the surviving row absorbed those numbers
   before the duplicate was deleted). **Never write a product name to
   Airtable that isn't in the Reference Table above — if SureCart/Cowork
   surfaces an unfamiliar name, treat it as a likely duplicate or rename of
   an existing product (see point 3) and confirm before writing, don't
   invent a new row.**

3. **SureCart's dashboard can cosmetically rename a product/bump without
   changing the underlying item.** See the bump footnote in the reference
   table above (`Your First 30 Days: Member Practice Guide` → "30 Day
   Guided Practice Plan for Every Level" in SureCart's own UI). If a pull
   surfaces a name that isn't in the reference table, check whether it
   matches an existing item's price + parent product before assuming it's
   new — this is the same root cause as point 2, just cosmetic rather than
   a tracking bug.

4. **Aggregate "YTD" totals and the per-product breakdown can silently stop
   agreeing with each other, and nothing in Section 6 catches it.** Before
   the 2026-06-19 CSV rebuild, `SC_DATA.stats.ytd.count` was 2890 while
   `SC_DATA.byProduct` (supposedly the same YTD window, per Section 5) summed
   to only ~210 — a >13x gap, hidden by the fact that both numbers
   individually looked plausible. The per-product pull was effectively only
   covering a much shorter window than the revenue-summary pull, mislabeled
   as YTD. Section 6 now has check **E** for this (below) — run it every
   time.

### 4.3 Airtable write (every run)

**Table:** Daily Product Stats (`tblzeTGmTQJ6UOEJl`), upsert key = `Record ID`
field (`fldq5e23DGa8BpJFU`), format `YYYY-MM-DD|Exact Product Name`.

| Field | Field ID | Notes |
|---|---|---|
| Record ID | `fldq5e23DGa8BpJFU` | upsert key |
| Date | `fldpXLQ7f7YArQ2WS` | ISO date, yesterday |
| Product Name | `fldElt29AlVrqt8kW` | exact SureCart name — see reference table |
| Product Type | `fldaDSMZxj0MH1L4v` | Subscription / Product / Bump / Upsell / Lead Magnet / Coaching |
| Parent Product | `fldSiyrezf8Lafj2v` | bumps/upsells only |
| Checkout Page Views | `fldNXDrSKfS0OHDEw` | Fathom daily pageviews |
| Checkout Uniques | `fldsb51VFNGWgdTIl` | Fathom daily uniques |
| Orders | `fld484kz8strCDJoY` | SureCart paid orders |
| Revenue | `fld73O4I32t6EizEU` | **dollars**, e.g. `29.00` |
| New Signups | `fldJDfygpRc6dKjy4` | subscriptions only |
| Renewals | `fldQoPfOyrhXFAT2B` | subscriptions only |
| Parent Orders | `fldDZmOLIgOm6H6tY` | bumps: accepted count |
| ManyChat Clicks | `fldccyzSz9rcoMPF3` | Fathom pageviews, utm_source=manychat |
| ManyChat Keyword | `fldlx2D6TU9wiJMFu` | utm_campaign |
| Traffic Source | `fldcP97eyH8Pam5NH` | Organic / ManyChat / Email / YouTube / Paid Ads / Mixed |
| Notes | `fldYmd2ow7dzhxTB7` | optional |

⚠️ "Master Beginner Fundamentals in 4 Days" is sold both as a standalone
product and a $0 bump on Annual checkout pages — write it as a main-product
record only, never a second bump record (would collide on the upsert key).

---

## 5. Inject into `index.html`

Replace everything between `// [DASHBOARD-DATA-START]` and
`// [DASHBOARD-DATA-END]` with: `FATHOM_DAILY`, `FATHOM_WEEKLY`, `FATHOM_YTD`,
`SITE_TOTALS`, `MONTHLY`, `PREV_PERIOD`, `SPIKE_REFERRERS`, `SC_PREV_30`,
`SC_DATA` (with `stats`, `byProduct`, `byProductPeriod`, `recentOrders`,
`lastFetched`, `growth`), `LAST_UPDATED`.

- All `SC_DATA` revenue is in **cents**. Airtable stores dollars — ×100 when
  building `SC_DATA`.
- `byProduct` = same data as `byProductPeriod.ytd` (Airtable cumulative,
  not a rolling 30-day window).
- Non-Sunday runs: carry `SC_DATA.growth` forward unchanged.
- **Never touch `[FUNNEL-CHAINS-START]` / `[FUNNEL-CHAINS-END]`** on a daily
  run — that block only changes on the Sunday Funnel Chains sync, deliberately.

---

## 6. Mandatory Pre-Publish Checklist

Run ALL of these before every push. Any failure → **do not push**, discard
the bad write (`git checkout -- index.html`), and write a one-paragraph
status note naming the exact field and value that failed. It is always
better to leave the dashboard a day stale than to publish something wrong.

**A — Structure.** All required `const`s present (`FATHOM_DAILY`,
`FATHOM_WEEKLY`, `FATHOM_YTD`, `SITE_TOTALS`, `MONTHLY`, `PREV_PERIOD`,
`SPIKE_REFERRERS`, `SC_PREV_30`, `SC_DATA`, `LAST_UPDATED`), `byProductPeriod`,
`recentOrders`, `lastFetched`, `growth:`, `monthlyNewSignups` all present,
data block parses as valid JS, `FUNNEL_CHAINS` block unchanged in
shape/size from before this run.

**B — No silent degradation.** Compare every new value against the
currently-live (`origin/main`) value for: `SC_DATA.stats.*`, `byProduct`
length, `byProductPeriod.ytd` length, `recentOrders` non-null-amount count,
`growth.*`, `PREV_PERIOD` non-zero-pageview count, `SC_PREV_30` key count.
If live was real and new is `null`/`0`/`[]`/`{}` for the same field → fail,
unless this is a deliberate, logged carry-forward for a known source outage
(in which case new should equal live, not be emptied).

**C — Data provenance / plausibility.** (Added after the 2026-06-17
incident — data can look structurally fine and non-degraded while still
being fabricated.)
1. Every `recentOrders[].id` matches a UUID:
   `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`.
2. Every `created_at` is ISO 8601 and on or before yesterday's date — never
   after the run date.
3. Sum of `recentOrders` amounts dated exactly yesterday reconciles with
   `SC_DATA.stats.today.revenue` (exact match, or a subset that is `<=` it
   if more than 8 orders happened).
4. `SITE_TOTALS.weekly`/`.ytd` and `SC_DATA.stats.*.revenue` are not exact
   multiples of 100 or 1000 while also differing from the live value by
   more than 25% — real traffic/revenue numbers aren't that round.
5. `SC_DATA.byProduct` is not `[]` while `SC_DATA.stats.ytd.count > 0`.

**D — Sanity-test this checklist itself, once.** Before relying on it,
replay the actual 2026-06-17 bad commit's data block through checks C1-C5
and confirm it would have been rejected (it should fail C1, C2, and C4 at
minimum). This is part of the promotion checklist in the STATUS section.

**E — Per-product totals reconcile with aggregate totals.** (Added after the
2026-06-19 reconciliation — see Section 4.2.2 #4. Aggregate and per-product
numbers can each look individually plausible while silently disagreeing.)
1. Sum of `SC_DATA.byProductPeriod.ytd[].count` equals `SC_DATA.stats.ytd.count`
   exactly. Same for `byProductPeriod.daily`/`.weekly`/`.monthly` against
   `stats.today`/`.week`/`.month`. If they don't match, the per-product pull
   covered a different window than the aggregate pull — stop and fix the
   window, don't push a mismatched pair.
2. `SC_DATA.byProduct` is identical to `SC_DATA.byProductPeriod.ytd` (per
   Section 5) — same entries, same counts, same revenue.
3. No product name appears in `byProduct`/`byProductPeriod.*` that isn't in
   this doc's Reference Table. An unfamiliar name is far more likely a
   duplicate/rename of an existing product (Section 4.2.2 #2-3) than a real
   new product — confirm against Sean before writing it as new. As of
   2026-06-19 the table has several entries marked "unconfirmed"/"new,
   not independently verified" (footnotes ²,³,⁶) — a name matching one of
   those is a known gap, not a fresh failure; still flag it to Sean to get
   confirmed and de-flagged, but it isn't grounds to block a push by itself
   the way a truly unrecognized name is.

---

## 7. Publish

Only if Section 6 passed completely:
```bash
git add index.html
git commit -m "Dashboard refresh: [date]"
git push origin main
```
If `git push` fails or there's a conflict: stop, report the exact error —
don't force-push, don't discard either side.

---

## 8. Manual Run Procedure (current phase)

Until promoted to ACTIVE (see STATUS):

1. Sean pastes or screenshots the Fathom and SureCart report output for
   yesterday into a chat with Claude (no Fathom/SureCart MCP tools are
   connected in this sandbox session — this is the same screenshot-based
   pattern as the existing backfill guide).
2. Claude builds the data block, writes to Airtable, runs Section 6 in full,
   and shows Sean the diff and checklist results **before pushing**.
3. Sean approves or flags issues; Claude pushes only after explicit go-ahead.
4. Repeat daily for several days. Note anything Section 6 missed or
   incorrectly flagged — fold it into Section 6 immediately.

---

## 9. Reintroducing Cowork

Do not do this until the STATUS promotion checklist is fully checked off.
When ready:
1. Point Cowork at this single file — no separate packaged `.skill` bundle.
   If Cowork's platform requires a packaged bundle, regenerate it fresh from
   this file immediately before registering, and re-verify the version
   string inside the bundle matches this file's version before trusting it
   ever again.
2. Confirm there is exactly one trigger (Dispatch config or scheduler) and
   it points at this file's path, not a cached copy.
3. Flip the STATUS line at the top of this file to `ACTIVE` only after (1)
   and (2) are verified.

---

## Reference: Verified Product, Bump & Pathname Names

**⚠️ Verified against live SureCart order data, June 7 2026. Use exactly as written.**

| Product Name (exact) | Type | Fathom Slug |
|---|---|---|
| `Basic Membership — 7 Day $1 Trial` | Subscription | `/join-for-1-today/` |
| `Basic Membership` | Subscription | `/standard-checkout-page/` |
| `Premium Membership` | Subscription | `/premium-checkout-page/` |
| `Annual Standard Membership` | Subscription | `/annual-standard-checkout-page/` |
| `Annual Premium Membership` | Subscription | `/annual-premium-checkout-page/` |
| `Master Beginner Fundamentals in 4 Days` | Product | `/4-week-beginner-sales-page/` and `/4-day-beginner-checkout/` (A/B test, same product — see note below) |
| `27 Musicians Pro Musicians Bundle Pack` | Product | `/27musicians/` |
| `April Focus Guide`² | Product | `/april-focus-bundle-2026/` |
| `Dan's Signature Sounds`³ | Product | `/dans-signature-sounds/` |
| `Piano Blueprint Session` | Coaching | `/break` |
| `Mediant Drop 2 Exercise`⁴ | Product | `/drop-2-exercise-download-page/` |
| `Hear Any Chord — Free Ear Training Chart` | Lead Magnet | `/hear-any-chord/` |
| `Roadmap Lead` | Lead Magnet | `/our-roadmap-offer/` |
| `Major vs Minor Quiz` | Lead Magnet | `/major-vs-minor-quiz/` |
| `Scales Charts` | Lead Magnet | `/scales-charts/` |
| `I Will Bless The Lord (Gb) — Lucas Version`⁵ | Product | not yet mapped |
| `Bundled / multi-item orders`⁶ | — (not a product) | n/a |
| `Tutorial for Take 6 Song - Let the Words of My Mouth`⁶ | Lead Magnet (assumed, $0) | not yet mapped |
| `Jesus Loves Me by Joy Bloom Piano Sheet and Midi File`⁶ | Lead Magnet (assumed, $0) | not yet mapped |

² **Unconfirmed 2026-06-19:** the full SureCart CSV export shows
`April 2026 Monthly Focus Bundle` instead of this name. This looks like a
**month-named recurring bundle** — i.e. expect `May 2026 Monthly Focus
Bundle`, `June 2026 Monthly Focus Bundle`, etc. in future exports, not a
fixed product name. If so, match this product by the pattern `<Month
Name> 2026 Monthly Focus Bundle`, not an exact string, and don't treat next
month's name as a brand-new product (Section 4.2.2 #2-3 pattern). Needs
Sean's confirmation before relying on this in an automated run.

³ **Unconfirmed 2026-06-19:** the CSV export shows a separate line,
`Single Course - Dan's Signature Sounds` (21 orders, ~$40.71 avg in the
2026-06-19 export), at a different price point than this row and than the
existing bump `Dan's Signature Sounds - Logic Sessions Pack` ($8.32 avg).
Relationship between these three names is unconfirmed — do not merge or
rename anything here without Sean's input.

⁴ **Renamed 2026-06-19** in SureCart's UI to **"Get the Drop 2 Practice
Files and Charts!"** — confirmed via matching $100/unit price in the CSV
export. Same convention as footnote ¹: keep writing to Airtable under this
original canonical name for upsert-key continuity.

⁵ **Renamed 2026-06-19** in SureCart's UI to **"Learn Lucas's Chords: I
Will Bless the Lord [Tutorial + Download]"** — confirmed via matching
$25/unit price in the CSV export. Same convention as footnote ¹: keep
writing to Airtable under this original canonical name.

⁶ **New 2026-06-19, added straight from the CSV export, not independently
verified.** `Bundled / multi-item orders` is SureCart's own catch-all
bucket for checkouts containing more than one item — it is not a real
product and should not be written to Airtable as one; if it shows up in a
future pull, it needs to be unbundled into its real component products
before writing (not yet solved — flag to Sean if it recurs). The two
"Tutorial for Take 6 Song" / "Jesus Loves Me" lead-magnet-style rows are
real but have no Fathom pathname mapped yet here — flag to Sean to confirm
their checkout/opt-in pages before the next run needs to track their
traffic.

| Bump Name (exact) | Parent Product | Price |
|---|---|---|
| `Your First 30 Days: Member Practice Guide`¹ | `Basic Membership — 7 Day $1 Trial` | $17 |
| `Beginner Practice Plan - for 4 Songs` | `Master Beginner Fundamentals in 4 Days` | $12 |
| `Play Like Them: MIDI File Bundle 🎹🔥` | `Basic Membership` | varies |
| `Travis Sayles Organ Runs – Custom MIDI Transcription` | `27 Musicians Pro Musicians Bundle Pack` | $14 |
| `27 Musicians Guided Study Session` | `27 Musicians Pro Musicians Bundle Pack` | $9 |
| `Dan's Signature Sounds - Logic Sessions Pack` | `Dan's Signature Sounds` | varies |
| `Play Like Them: MIDI File Bundle 🎹🔥` | `Annual Standard Membership` | $22 |

¹ SureCart's UI now displays this bump as **"30 Day Guided Practice Plan for
Every Level"** (cosmetic rename noticed 2026-06-19; same underlying bump, same
$17 price, same parent product). Keep writing it to Airtable under the
original canonical name above for upsert-key continuity with all prior rows
— do not start a new product name just because SureCart's dashboard label
changed. See Section 4.2.2 for the general pattern this is an instance of.

Bump data source: SureCart Reports → Bumps page only — do not parse line items.

⚠️ **A/B test note (added 2026-06-19):** `/4-week-beginner-sales-page/` and
`/4-day-beginner-checkout/` are two entry points in an A/B test for the same
product, `Master Beginner Fundamentals in 4 Days`. Track Fathom pageviews for
both pathnames separately (that's the point of the test), but every order
still belongs to the single `Master Beginner Fundamentals in 4 Days` product
row in Airtable — never create a second product record (e.g. a "4-Day
Beginner Course" line) for the second entry point. A prior run did exactly
that, creating a duplicate product line that silently fragmented this
product's historical revenue/count from 2026-05-02 onward — see Changelog.

---

## Changelog

- **2026-06-19 — addendum.** Added `/4-day-beginner-checkout/` as a tracked
  pathname (A/B test vs. `/4-week-beginner-sales-page/`, same product —
  see reference table note). Documented that Airtable's Daily Product
  Stats table starts 2026-05-02 (not a full YTD history), so YTD
  count/revenue should come from SureCart's native Revenue Summary total,
  while weekly/30-day rollups can be safely built from Airtable. Added
  Section 4.2.1 single-day Cowork pull instructions. **Found a live data
  bug:** a "4-Day Beginner Course" product line exists in Airtable
  (2026-05-02 through 2026-06-15, ~24 orders / $648, all in $27
  increments matching `Master Beginner Fundamentals in 4 Days`'s exact
  price) that fragmented this product's real history under a second name
  — needs a manual merge/cleanup pass, flagged to Sean, not yet fixed.
  **Fixed later the same day — see next entry.**
- **2026-06-19 — Airtable cleanup + CSV reconciliation + Section 4.2.2/E.**
  Resolved the "4-Day Beginner Course" bug above: exact-match filter found
  15 affected rows (not ~24), totaling $612 (not $648); renamed all 15 to
  the canonical `Master Beginner Fundamentals in 4 Days`. Two dates
  (Jun 10, Jun 15) already had a legitimate row under the canonical name,
  so the rename produced two upsert-key collisions — both duplicates had
  0 orders/$0 revenue and were deleted after recovering the Jun 10 row's
  Fathom Checkout Page Views/Uniques (45/15) into the surviving row, which
  was also reclassified from a mistaken Product Type=Bump back to Product.
  Separately corrected the 2026-06-18 bump row for "Your First 30 Days:
  Member Practice Guide" from 1 order/$17 (SureCart Bumps report) to the
  verified 2 orders/$34 (confirmed against Items Purchased and a full
  SureCart order CSV export) — see Section 4.2.2 #1. Rebuilt the live
  `SC_DATA`/`SC_PREV_30` blocks in `index.html` directly from that same
  full CSV export rather than a Cowork natural-language pull, after
  finding `SC_DATA.stats.ytd.count` (2890) and the sum of
  `SC_DATA.byProduct[].count` (~210) had silently diverged by >13x — see
  Section 4.2.2 #4. Added Section 4.2.2 ("Known Cowork bugs") documenting
  all of the above as recurring failure patterns, and Section 6 check E
  (per-product/aggregate reconciliation) to catch #4 automatically on
  every future run. Added the SureCart cosmetic-rename footnote to the
  bump reference table (Section 4.2.2 #3).
- **2026-06-17 — v7.0 (DRAFT).** Full rewrite replacing
  `swp-performance-dashboard-cowork-skill.md` (deleted) and the stale
  `swp-performance-dashboard.skill` zip bundle (deleted — was out of sync
  with the maintained `.md` since at least v6.2, plausibly the actual cause
  of "fixes never reaching the scheduled run"). Folds the old v6.5
  Steps 4.5/4.6/4.7 checks into one Section 6 checklist. Status set to
  PAUSED pending several days of manually-supervised runs.
