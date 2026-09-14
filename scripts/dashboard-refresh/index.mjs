// Orchestrator for the deterministic daily SWP dashboard refresh.
// Replaces the agent-driven Cowork skill (see SKILL.md) for the daily
// 7:30am path. SKILL.md remains the human-readable explanation of the
// logic and the manual fallback if this script ever needs to be re-derived.
//
// ORDERS ARE RE-DERIVED FOR A TRAILING WINDOW, NOT JUST YESTERDAY: a failed
// renewal charge is retried on the original order and flips to paid up to 14
// days later (see surecart.mjs). Each run re-reads the last LOOKBACK_DAYS of
// paid orders and corrects any stored day whose sales changed. Approved by
// Sean on 2026-09-14 after an audit (audit.mjs) found $1,105 of August renewals
// missing from the dashboard. Fathom and every period rollup still follow the
// single-window convention: rollups come from Airtable, never the live source.
//
// KNOWN GAPS (intentionally deferred, not silently dropped):
//  - Step 3B (weekly Funnel Chains analysis sync) is NOT implemented — still
//    a manual/agent task if needed.

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchFathomData } from "./fathom.mjs";
import { fetchSureCartDailyBreakdowns, fetchRecentPaidOrders } from "./surecart.mjs";
import { fetchSubscriptionLifecycleData } from "./subscriptions.mjs";
import {
  fetchDailyProductStats,
  buildDayWrites,
  applyWrites,
  upsertDailyProductStats,
  buildPeriodRollups,
  buildGrowth,
  upsertSubscriptionSnapshot,
} from "./airtable.mjs";
import { injectDashboardData, runAnomalyCheck } from "./inject.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.resolve(__dirname, "..", "..");
const HTML_PATH = path.join(REPO_DIR, "index.html");

// All late payments Jan–Sep 2026 landed within 14 days; 21 leaves margin.
const LOOKBACK_DAYS = 21;

function addDaysISO(isoDate, n) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function todayET() {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function main() {
  const cliDate = process.argv.find((a) => a.startsWith("--date="))?.split("=")[1];
  const dryRun = process.argv.includes("--dry-run");
  const yesterday = cliDate ?? addDaysISO(todayET(), -1);
  const year = yesterday.slice(0, 4);

  const dates = {
    yesterday,
    sevenDaysAgo: addDaysISO(yesterday, -6),
    fourteenDaysAgo: addDaysISO(yesterday, -13),
    eightDaysAgo: addDaysISO(yesterday, -7),
    thirtyDaysAgo: addDaysISO(yesterday, -29),
    ytdStart: `${year}-01-01`,
    monthStart: `${yesterday.slice(0, 7)}-01`,
  };
  const priorMonthEnd = addDaysISO(dates.monthStart, -1);
  const priorMonthStart = `${priorMonthEnd.slice(0, 7)}-01`;
  const lookbackStart = addDaysISO(yesterday, -(LOOKBACK_DAYS - 1));

  console.log(`[refresh] Running for "yesterday" = ${yesterday}${dryRun ? "  [DRY RUN — no Airtable writes, no git commit/push]" : ""}`);

  const FATHOM_API_TOKEN = requireEnv("FATHOM_API_TOKEN");
  const SURECART_API_KEY = requireEnv("SURECART_API_KEY");
  const AIRTABLE_API_KEY = requireEnv("AIRTABLE_API_KEY");

  console.log("[refresh] Step 1A — Fathom...");
  const fathom = await fetchFathomData({ token: FATHOM_API_TOKEN, ...dates });

  console.log(`[refresh] Step 1B — SureCart paid orders ${lookbackStart}..${yesterday}...`);
  const salesByDay = await fetchSureCartDailyBreakdowns({ apiKey: SURECART_API_KEY, fromDay: lookbackStart, toDay: yesterday });
  const recentOrders = await fetchRecentPaidOrders({ apiKey: SURECART_API_KEY, limit: 8 });
  console.log(`[refresh] SureCart: ${salesByDay[yesterday]?.orderCount ?? 0} paid orders on ${yesterday}`);

  console.log("[refresh] Step 1E — SureCart subscription lifecycle (retention/churn/MRR)...");
  // Full subscription re-pull each run: subscription STATUS is mutable, so
  // capturing churn of older cohorts requires re-reading the whole list — a
  // deliberate exception to the single-day-pull convention that applies to
  // immutable orders. See subscriptions.mjs header.
  const RETENTION_DATA = await fetchSubscriptionLifecycleData({ apiKey: SURECART_API_KEY });
  console.log(`[refresh] Subscriptions: ${RETENTION_DATA.snapshot.active} active, MRR $${Math.round(RETENTION_DATA.snapshot.activeMrrCents / 100)}, ${RETENTION_DATA.trailing6.avgChurnPct}% avg monthly churn`);
  if (dryRun) {
    console.log("[refresh] DRY RUN — would upsert this subscription snapshot (not written):");
    console.log(JSON.stringify(RETENTION_DATA.snapshot, null, 2));
  } else {
    await upsertSubscriptionSnapshot(AIRTABLE_API_KEY, yesterday, RETENTION_DATA.snapshot, RETENTION_DATA.trailing6);
  }

  console.log(`[refresh] Step 1D — Airtable upsert (yesterday, plus corrections back to ${lookbackStart})...`);
  const storedRows = await fetchDailyProductStats(AIRTABLE_API_KEY, lookbackStart, yesterday);
  const writes = [];
  for (let day = lookbackStart; day <= yesterday; day = addDaysISO(day, 1)) {
    const dayWrites = buildDayWrites({
      day,
      breakdown: salesByDay[day]?.breakdown ?? {},
      existing: storedRows.filter((row) => row.day === day && row.keyed),
      pageViews: day === yesterday ? fathom.FATHOM_DAILY : null,
    });
    if (day !== yesterday && dayWrites.length) {
      console.log(`[refresh]   correcting ${day}: ${dayWrites.map((w) => `${w.name} → ${w.orders} / $${(w.revenueCents / 100).toFixed(2)}`).join("; ")}`);
    }
    writes.push(...dayWrites);
  }
  if (dryRun) {
    console.log(`[refresh] DRY RUN — would upsert these ${writes.length} Daily Product Stats rows (not written):`);
    console.log(JSON.stringify(writes, null, 2));
  } else {
    await upsertDailyProductStats(AIRTABLE_API_KEY, writes);
  }

  console.log("[refresh] Step 2 — Building byProductPeriod, SC_PREV_30 and growth from Airtable...");
  const rollupStart = [dates.ytdStart, priorMonthStart, dates.thirtyDaysAgo].sort()[0];
  const fetchedRows = await fetchDailyProductStats(AIRTABLE_API_KEY, rollupStart, yesterday);
  // A dry run didn't write, so layer the pending writes over what's stored.
  const rows = dryRun ? applyWrites(fetchedRows, writes) : fetchedRows;
  const { byProductPeriod, SC_PREV_30 } = buildPeriodRollups(rows, { ...dates, priorMonthStart, priorMonthEnd });
  const growth = buildGrowth(rows, dates);
  console.log(`[refresh] Growth: 7d ${growth.week.newSignups} new / ${growth.week.renewals} renewals · 30d ${growth.month.newSignups} new / ${growth.month.renewals} renewals · YTD ${growth.ytd.newSignups} new`);
  const byProduct = byProductPeriod.ytd; // same definition as today: Airtable cumulative-to-date

  const todayTotals = sumPeriod(byProductPeriod.daily);
  const weekTotals = sumPeriod(byProductPeriod.weekly);
  const monthTotals = sumPeriod(byProductPeriod.monthly);
  const ytdTotals = sumPeriod(byProductPeriod.ytd);

  const SC_DATA = {
    stats: { today: todayTotals, week: weekTotals, month: monthTotals, ytd: ytdTotals },
    byProduct,
    byProductPeriod,
    recentOrders,
    lastFetched: formatLastUpdated(new Date()),
    growth,
  };

  console.log("[refresh] Step 3 — Injecting into index.html...");
  const data = {
    FATHOM_DAILY: fathom.FATHOM_DAILY,
    FATHOM_WEEKLY: fathom.FATHOM_WEEKLY,
    FATHOM_YTD: fathom.FATHOM_YTD,
    SITE_TOTALS: fathom.SITE_TOTALS,
    MONTHLY: fathom.MONTHLY,
    PREV_PERIOD: fathom.PREV_PERIOD,
    SPIKE_REFERRERS: fathom.SPIKE_REFERRERS,
    DAILY_SOURCES: fathom.DAILY_SOURCES,
    WEEKLY_SOURCES: fathom.WEEKLY_SOURCES,
    SC_PREV_30,
    SC_DATA,
    RETENTION_DATA,
    LAST_UPDATED: formatLastUpdated(new Date()),
  };
  const previewPath = path.join(REPO_DIR, "index.html.dryrun-preview.html");
  const newHtml = injectDashboardData(HTML_PATH, data, dryRun ? { outputPath: previewPath, write: true } : {}); // throws on Step 4.5 failure

  console.log("[refresh] Step 4.6 — Anomaly check against origin/main...");
  runAnomalyCheck(REPO_DIR, newHtml); // throws on DEGRADED

  // Step 4.7 — compact summary consumed by the morning briefing dashboard
  // (fetched cross-origin via raw.githubusercontent.com). Revenue is cents.
  const topProducts = [...byProductPeriod.daily]
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 3)
    .map(([name, v]) => ({ name, orders: v.count, revenueCents: v.revenue }));
  const briefingSummary = {
    generatedAt: new Date().toISOString(),
    date: yesterday,
    yesterday: { orders: todayTotals.count, revenueCents: todayTotals.revenue, topProducts },
    week: { orders: weekTotals.count, revenueCents: weekTotals.revenue },
    month: { orders: monthTotals.count, revenueCents: monthTotals.revenue },
    ytd: { orders: ytdTotals.count, revenueCents: ytdTotals.revenue },
  };
  if (!dryRun) {
    fs.writeFileSync(path.join(REPO_DIR, "data.json"), JSON.stringify(briefingSummary, null, 2) + "\n");
  }

  if (dryRun) {
    console.log(`[refresh] DRY RUN — wrote preview to ${previewPath}. Real index.html untouched, nothing committed/pushed, nothing written to Airtable.`);
    console.log(`[refresh] DRY RUN summary: ${JSON.stringify({ yesterday: briefingSummary.yesterday, week: briefingSummary.week, month: briefingSummary.month, ytd: briefingSummary.ytd })}`);
    console.log(`[refresh] DRY RUN growth: ${JSON.stringify(growth)}`);
  } else {
    console.log("[refresh] Step 5 — Publish...");
    publish(yesterday);
  }

  console.log("[refresh] Done.");
}

function sumPeriod(tuples) {
  return tuples.reduce((acc, [, v]) => ({ count: acc.count + v.count, revenue: acc.revenue + v.revenue }), { count: 0, revenue: 0 });
}

function formatLastUpdated(date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(date);
}

function publish(yesterday) {
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
  execSync(`mkdir -p versions && cp index.html "versions/${stamp}.html"`, { cwd: REPO_DIR });
  execSync("git add index.html versions/ data.json", { cwd: REPO_DIR });
  const hasChanges = execSync("git diff --cached --quiet; echo $?", { cwd: REPO_DIR, encoding: "utf8" }).trim() !== "0";
  if (hasChanges) {
    execSync(`git commit -m "Dashboard refresh ${yesterday} (automated)"`, { cwd: REPO_DIR });
    execSync("git push origin main", { cwd: REPO_DIR });
    console.log("[refresh] Pushed. Live: https://swp-dashboard-five.vercel.app/");
  } else {
    console.log("[refresh] No changes to commit.");
  }
}

function requireEnv(name) {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var ${name}`);
  return val;
}

main().catch((err) => {
  console.error(`[refresh] FAILED: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
