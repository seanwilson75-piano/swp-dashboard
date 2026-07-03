// Orchestrator for the deterministic daily SWP dashboard refresh.
// Replaces the agent-driven Cowork skill (see SKILL.md) for the daily
// 7:30am path. SKILL.md remains the human-readable explanation of the
// logic and the manual fallback if this script ever needs to be re-derived.
//
// KNOWN GAPS (intentionally deferred from this v1, not silently dropped):
//  - Step 1C (Sunday new-signups/renewals growth refresh) is NOT implemented.
//    SC_DATA.growth is carried forward unchanged from the live dashboard on
//    every run, every day, until a follow-up adds it.
//  - Per-product New Signups / Renewals split in the Daily Product Stats
//    Airtable write is NOT implemented (requires per-order subscription
//    status, out of scope for this pass) — those two fields are left unset.
//  - Step 3B (weekly Funnel Chains analysis sync) is NOT implemented — still
//    a manual/agent task if needed.
// None of these affect the traffic+orders+revenue numbers that make up the
// bulk of the daily refresh cost this script exists to eliminate.

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchFathomData } from "./fathom.mjs";
import { fetchSureCartDailyBreakdown, fetchRecentPaidOrders } from "./surecart.mjs";
import { upsertDailyProductStats, buildPeriodRollups } from "./airtable.mjs";
import { injectDashboardData, runAnomalyCheck } from "./inject.mjs";
import { PRODUCTS, BUMPS } from "./config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.resolve(__dirname, "..", "..");
const HTML_PATH = path.join(REPO_DIR, "index.html");

function pad(n) {
  return String(n).padStart(2, "0");
}

// Finds the UTC instant matching a given America/New_York wall-clock time,
// correctly handling DST via iterative correction against Intl formatting.
function etWallClockToUTC(dateStr, hh, mm, ss) {
  let guessMs = Date.parse(`${dateStr}T${pad(hh)}:${pad(mm)}:${pad(ss)}.000-05:00`);
  const want = `${dateStr}T${pad(hh)}:${pad(mm)}:${pad(ss)}`;
  for (let i = 0; i < 3; i++) {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    });
    const parts = Object.fromEntries(fmt.formatToParts(new Date(guessMs)).map((p) => [p.type, p.value]));
    const got = `${parts.year}-${parts.month}-${parts.day}T${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}:${parts.second}`;
    if (got === want) break;
    guessMs += Date.parse(want + "Z") - Date.parse(got + "Z");
  }
  return Math.floor(guessMs / 1000);
}

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

function extractLiveBlock(repoDir) {
  const liveHtml = execSync("git show origin/main:index.html", { cwd: repoDir, encoding: "utf8" });
  const block = liveHtml.split("// [DASHBOARD-DATA-START]")[1]?.split("// [DASHBOARD-DATA-END]")[0];
  const sandbox = {};
  new Function("exports", block.replace(/^const /gm, "exports."))(sandbox);
  return sandbox;
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
    ytdStart: `${year}-01-01`,
    monthStart: `${yesterday.slice(0, 7)}-01`,
  };
  const priorMonthEnd = addDaysISO(dates.monthStart, -1);
  const priorMonthStart = `${priorMonthEnd.slice(0, 7)}-01`;

  console.log(`[refresh] Running for "yesterday" = ${yesterday}${dryRun ? "  [DRY RUN — no Airtable writes, no git commit/push]" : ""}`);

  const FATHOM_API_TOKEN = requireEnv("FATHOM_API_TOKEN");
  const SURECART_API_KEY = requireEnv("SURECART_API_KEY");
  const AIRTABLE_API_KEY = requireEnv("AIRTABLE_API_KEY");

  console.log("[refresh] Step 1A — Fathom...");
  const fathom = await fetchFathomData({ token: FATHOM_API_TOKEN, ...dates });

  console.log("[refresh] Step 1B — SureCart...");
  const yesterdayStartUnix = etWallClockToUTC(yesterday, 0, 0, 0);
  const yesterdayEndUnix = etWallClockToUTC(yesterday, 23, 59, 59);
  const { breakdown, orderCount } = await fetchSureCartDailyBreakdown({
    apiKey: SURECART_API_KEY,
    yesterdayStartUnix,
    yesterdayEndUnix,
  });
  const recentOrders = await fetchRecentPaidOrders({ apiKey: SURECART_API_KEY, limit: 8 });
  console.log(`[refresh] SureCart: ${orderCount} paid orders on ${yesterday}`);

  console.log("[refresh] Step 1D — Airtable upsert...");
  const productRows = Object.entries(PRODUCTS).map(([name, meta]) => {
    const sc = breakdown[name] ?? { count: 0, revenue: 0 };
    const fathomEntry = fathom.FATHOM_DAILY[meta.slug] ?? { pageviews: 0, uniques: 0 };
    return {
      productName: name,
      productType: meta.type,
      checkoutPageViews: fathomEntry.pageviews,
      checkoutUniques: fathomEntry.uniques,
      orders: sc.count,
      revenue: sc.revenue,
    };
  });
  // Bump rows: anything in `breakdown` not already covered by a main product name above.
  const bumpRows = Object.entries(breakdown)
    .filter(([name]) => !PRODUCTS[name])
    .map(([name, sc]) => ({
      productName: name,
      productType: "Bump",
      orders: sc.count,
      revenue: sc.revenue,
      parentOrders: sc.count,
      ...(BUMPS[name] ? { parentProduct: BUMPS[name] } : {}),
    }));
  if (dryRun) {
    console.log("[refresh] DRY RUN — would upsert these Daily Product Stats rows (not written):");
    console.log(JSON.stringify([...productRows, ...bumpRows], null, 2));
  } else {
    await upsertDailyProductStats(AIRTABLE_API_KEY, yesterday, [...productRows, ...bumpRows]);
  }

  console.log("[refresh] Step 2 — Building byProductPeriod + SC_PREV_30 from Airtable...");
  const { byProductPeriod, SC_PREV_30 } = await buildPeriodRollups(AIRTABLE_API_KEY, { ...dates, priorMonthStart, priorMonthEnd });
  if (dryRun) {
    // Airtable doesn't have yesterday's row yet (we didn't write it above), so
    // byProductPeriod.daily/weekly/monthly/ytd here are STALE BY ONE DAY —
    // they reflect Airtable's state before this run. Swap in the freshly
    // fetched SureCart breakdown for "daily" so the dry-run preview still
    // shows what yesterday's numbers actually are.
    byProductPeriod.daily = Object.entries(breakdown)
      .filter(([, v]) => v.count > 0 || v.revenue > 0)
      .map(([name, v]) => [name, { count: v.count, revenue: Math.round(v.revenue * 100) }]);
    console.log("[refresh] DRY RUN note: weekly/monthly/ytd/SC_PREV_30 below are from Airtable's CURRENT state (yesterday's row not written yet), only 'daily' reflects the fresh SureCart pull.");
  }

  console.log("[refresh] Carrying forward SC_DATA.growth from live dashboard (Step 1C not yet automated)...");
  const live = extractLiveBlock(REPO_DIR);
  const growth = live.SC_DATA?.growth ?? { week: {}, month: {}, ytd: {}, monthlyNewSignups: [] };
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
