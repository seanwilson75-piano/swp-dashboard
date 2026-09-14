// Rebuilds Daily Product Stats for a date range from live SureCart orders and
// Fathom page views, using the same row logic as the daily refresh
// (airtable.mjs buildDayWrites), so it's safe to re-run. Dry run by default —
// prints what would change per month; pass --write to upsert.
//
//   node --env-file=.env backfill.mjs --from=2026-01-01 --to=2026-09-13 [--write]
//
// Legacy rows without a Record ID can't be reached by the upsert, so on a
// rebuilt day they'd double-count next to the keyed rows. They're zeroed (not
// deleted) after the keyed rows are written, with their old numbers in Notes.
//
// First run 2026-09-14: filled Jan 1–May 1 and Jul 24 2026 (never written),
// corrected May–Sep (late-paid renewals the daily run missed, page views cut
// off at Fathom's top 25 pages), populated the new-signup/renewal split, and
// zeroed 30 unkeyed June rows from the old agent-driven skill.
// Verify afterwards with audit.mjs over the same range.

import { fetchSureCartDailyBreakdowns } from "./surecart.mjs";
import { fetchTrackedPageviewsByDay } from "./fathom.mjs";
import { fetchDailyProductStats, buildDayWrites, applyWrites, upsertDailyProductStats, zeroOutUnkeyedRows } from "./airtable.mjs";

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const FROM = arg("from");
const TO = arg("to");
const WRITE = process.argv.includes("--write");

function requireEnv(name) {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var ${name}`);
  return val;
}

function addDays(isoDate, n) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function monthSummary(rows) {
  const byMonth = {};
  for (const row of rows) {
    const m = (byMonth[row.day.slice(0, 7)] ??= { orders: 0, revenueCents: 0, pageViews: 0, newSignups: 0, renewals: 0 });
    m.orders += row.orders;
    m.revenueCents += row.revenueCents;
    m.pageViews += Number(row.checkoutPageViews ?? 0);
    m.newSignups += row.newSignups;
    m.renewals += row.renewals;
  }
  return byMonth;
}

async function main() {
  if (!FROM || !TO) throw new Error("usage: backfill.mjs --from=YYYY-MM-DD --to=YYYY-MM-DD [--write]");
  const SURECART_API_KEY = requireEnv("SURECART_API_KEY");
  const FATHOM_API_TOKEN = requireEnv("FATHOM_API_TOKEN");
  const AIRTABLE_API_KEY = requireEnv("AIRTABLE_API_KEY");

  console.log(`[backfill] SureCart paid orders ${FROM}..${TO}...`);
  const salesByDay = await fetchSureCartDailyBreakdowns({ apiKey: SURECART_API_KEY, fromDay: FROM, toDay: TO });
  console.log("[backfill] Fathom daily page views per tracked page...");
  const viewsByDay = await fetchTrackedPageviewsByDay({ token: FATHOM_API_TOKEN, from: FROM, to: TO });
  console.log("[backfill] Airtable rows currently stored...");
  const stored = await fetchDailyProductStats(AIRTABLE_API_KEY, FROM, TO);
  const unkeyedToZero = stored.filter((row) => !row.keyed && (row.orders || row.revenueCents || row.checkoutPageViews));

  const writesByMonth = {};
  const allWrites = [];
  for (let day = FROM; day <= TO; day = addDays(day, 1)) {
    const dayWrites = buildDayWrites({
      day,
      breakdown: salesByDay[day]?.breakdown ?? {},
      existing: stored.filter((row) => row.day === day && row.keyed),
      pageViews: viewsByDay[day] ?? {},
    });
    (writesByMonth[day.slice(0, 7)] ??= []).push(...dayWrites);
    allWrites.push(...dayWrites);
  }

  const before = monthSummary(stored);
  const after = monthSummary(applyWrites(stored.filter((row) => !unkeyedToZero.includes(row)), allWrites));
  const usd = (cents) => `$${(cents / 100).toFixed(2)}`;
  console.log("\nmonth    rows to write | stored: orders   revenue  page views | rebuilt: orders   revenue  page views  new  renewals");
  for (const month of Object.keys(after).sort()) {
    const b = before[month] ?? { orders: 0, revenueCents: 0, pageViews: 0 };
    const a = after[month];
    console.log(
      `${month} ${String(writesByMonth[month]?.length ?? 0).padStart(13)} | ${String(b.orders).padStart(14)} ${usd(b.revenueCents).padStart(10)} ${String(b.pageViews).padStart(11)} | ` +
        `${String(a.orders).padStart(15)} ${usd(a.revenueCents).padStart(10)} ${String(a.pageViews).padStart(11)} ${String(a.newSignups).padStart(4)} ${String(a.renewals).padStart(9)}`
    );
  }
  console.log(`\n[backfill] ${unkeyedToZero.length} unkeyed legacy rows to zero out${unkeyedToZero.length ? ` (days: ${[...new Set(unkeyedToZero.map((row) => row.day))].sort().join(", ")})` : ""}`);

  if (!WRITE) {
    console.log(`[backfill] DRY RUN — ${allWrites.length} rows would be written. Nothing sent to Airtable; re-run with --write to apply.`);
    return;
  }
  for (const [month, monthWrites] of Object.entries(writesByMonth)) {
    await upsertDailyProductStats(AIRTABLE_API_KEY, monthWrites);
    console.log(`[backfill] wrote ${monthWrites.length} rows for ${month}`);
  }
  if (unkeyedToZero.length) {
    await zeroOutUnkeyedRows(AIRTABLE_API_KEY, unkeyedToZero, new Date().toISOString().slice(0, 10));
    console.log(`[backfill] zeroed ${unkeyedToZero.length} unkeyed legacy rows`);
  }
  console.log(`[backfill] Done — ${allWrites.length} rows written.`);
}

main().catch((err) => {
  console.error(`[backfill] FAILED: ${err.message}`);
  process.exit(1);
});
