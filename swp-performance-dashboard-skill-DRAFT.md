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

| Bump Name (exact) | Parent Product | Price |
|---|---|---|
| `Your First 30 Days: Member Practice Guide` | `Basic Membership — 7 Day $1 Trial` | $17 |
| `Beginner Practice Plan - for 4 Songs` | `Master Beginner Fundamentals in 4 Days` | $12 |
| `Play Like Them: MIDI File Bundle 🎹🔥` | `Basic Membership` | varies |
| `Travis Sayles Organ Runs – Custom MIDI Transcription` | `27 Musicians Pro Musicians Bundle Pack` | $14 |
| `27 Musicians Guided Study Session` | `27 Musicians Pro Musicians Bundle Pack` | $9 |
| `Dan's Signature Sounds - Logic Sessions Pack` | `Dan's Signature Sounds` | varies |
| `Play Like Them: MIDI File Bundle 🎹🔥` | `Annual Standard Membership` | $22 |

Bump data source: SureCart Reports → Bumps page only — do not parse line items.

---

## Changelog

- **2026-06-17 — v7.0 (DRAFT).** Full rewrite replacing
  `swp-performance-dashboard-cowork-skill.md` (deleted) and the stale
  `swp-performance-dashboard.skill` zip bundle (deleted — was out of sync
  with the maintained `.md` since at least v6.2, plausibly the actual cause
  of "fixes never reaching the scheduled run"). Folds the old v6.5
  Steps 4.5/4.6/4.7 checks into one Section 6 checklist. Status set to
  PAUSED pending several days of manually-supervised runs.
