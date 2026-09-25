// Direct Airtable REST API calls (https://api.airtable.com/v0/{baseId}/{tableId}),
// replacing the Airtable MCP tools. Airtable stays the canonical data store —
// this script's only Airtable writes are the daily per-product upsert (plus
// corrections to recent days) and the subscription snapshot, so any future
// second dashboard can read these tables directly without depending on this
// script at all.

import {
  AIRTABLE_BASE_ID,
  AIRTABLE_DAILY_PRODUCT_STATS_TABLE,
  AIRTABLE_SUBSCRIPTION_SNAPSHOTS_TABLE,
  DAILY_PRODUCT_STATS_FIELDS as F,
  SUBSCRIPTION_SNAPSHOT_FIELDS as SF,
  PRODUCTS,
  BUMPS,
  UNTRACKED_PRODUCT_TYPES,
} from "./config.mjs";

const API_BASE = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}`;
const WRITE_PACE_MS = 250; // Airtable allows 5 requests/second per base
// Airtable allows max 25 records per write request (422 INVALID_RECORDS above
// that, confirmed 2026-09-14) — a day plus lookback corrections can exceed it.
const MAX_RECORDS_PER_WRITE = 25;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function airtableFetch(token, path, { method = "GET", body } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Airtable API ${res.status} on ${method} ${path}: ${text}`);
  }
  return res.json();
}

async function listAllRecords(token, formula) {
  const records = [];
  let offset;
  do {
    // returnFieldsByFieldId=true: WITHOUT this, Airtable's List Records API
    // returns `fields` keyed by FIELD NAME ("Product Name", "Orders", ...),
    // not by field ID — confirmed live on 2026-06-22 after this caused every
    // record to be silently skipped (sumByProduct looked up F.productName,
    // a field ID, against name-keyed fields and got `undefined` every time).
    const params = new URLSearchParams({ pageSize: "100", returnFieldsByFieldId: "true" });
    if (formula) params.set("filterByFormula", formula);
    if (offset) params.set("offset", offset);
    const result = await airtableFetch(token, `/${AIRTABLE_DAILY_PRODUCT_STATS_TABLE}?${params}`);
    records.push(...result.records);
    offset = result.offset;
  } while (offset);
  return records;
}

async function patchInBatches(token, body, records) {
  for (let i = 0; i < records.length; i += MAX_RECORDS_PER_WRITE) {
    await airtableFetch(token, `/${AIRTABLE_DAILY_PRODUCT_STATS_TABLE}`, {
      method: "PATCH",
      body: { ...body, records: records.slice(i, i + MAX_RECORDS_PER_WRITE) },
    });
    await sleep(WRITE_PACE_MS);
  }
}

const toCents = (dollars) => Math.round(Number(dollars ?? 0) * 100);

function withoutUndefined(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined));
}

// Reads Daily Product Stats rows dated from..to (inclusive, YYYY-MM-DD) into a
// flat shape with money in cents. Missing numeric fields read as 0; page views
// stay undefined when never written, so callers can tell "unset" from 0.
//
// `keyed` is false for rows whose Record ID isn't "Date|Product Name". The
// upsert can't reach those, so a rebuilt day would count them twice — 30 June
// 2026 rows written by the old agent-driven skill have no Record ID at all.
// Callers compare against keyed rows only; backfill.mjs zeroes the rest.
export async function fetchDailyProductStats(token, from, to) {
  // Plain `{field} = 'date'` does NOT match Airtable date-type fields
  // reliably (confirmed live on 2026-06-22 — returned 0 rows against a
  // known-good date) — IS_AFTER/IS_BEFORE on the neighboring days is.
  const records = await listAllRecords(token, `AND(IS_AFTER({${F.date}}, '${addDays(from, -1)}'), IS_BEFORE({${F.date}}, '${addDays(to, 1)}'))`);
  return records
    .filter((rec) => rec.fields[F.productName] && rec.fields[F.date])
    .map((rec) => {
      const f = rec.fields;
      return {
        airtableId: rec.id,
        keyed: f[F.recordId] === `${f[F.date]}|${f[F.productName]}`,
        day: f[F.date],
        name: f[F.productName],
        productType: f[F.productType],
        parentProduct: f[F.parentProduct],
        orders: Number(f[F.orders] ?? 0),
        revenueCents: toCents(f[F.revenue]),
        newSignups: Number(f[F.newSignups] ?? 0),
        renewals: Number(f[F.renewals] ?? 0),
        newSignupRevenueCents: toCents(f[F.newSignupRevenue]),
        renewalRevenueCents: toCents(f[F.renewalRevenue]),
        checkoutPageViews: f[F.checkoutPageViews],
        checkoutUniques: f[F.checkoutUniques],
        notes: f[F.notes],
      };
    });
}

// Sales numbers compared when deciding whether a stored row needs rewriting.
const SALES_KEYS = ["orders", "revenueCents", "newSignups", "renewals", "newSignupRevenueCents", "renewalRevenueCents"];

// Decides which Daily Product Stats rows to write for one day, given what
// SureCart says now (`breakdown`, from surecart.mjs) and the keyed rows
// Airtable already holds for that day (`existing`). Returns only rows that
// would change:
//   - products whose sales differ from what's stored (late payments landing),
//   - stored rows SureCart no longer has sales for (refunds, renamed
//     products) — zeroed rather than deleted,
//   - rows whose Product Type / Parent Product no longer match config,
//   - when `pageViews` is given ({ "/slug/": {pageviews, uniques} } — yesterday
//     in the daily run, every day in a backfill): one row per configured
//     product carrying its page views, even with zero sales.
// With `pageViews` null, page-view fields are left off, so correcting an older
// day's sales never overwrites the page views captured for it.
export function buildDayWrites({ day, breakdown, existing, pageViews }) {
  const storedByName = new Map(existing.map((row) => [row.name, row]));
  const names = new Set([...Object.keys(breakdown), ...storedByName.keys(), ...(pageViews ? Object.keys(PRODUCTS) : [])]);
  const writes = [];

  for (const name of names) {
    const sales = breakdown[name];
    const stored = storedByName.get(name);
    const meta = PRODUCTS[name];
    const row = {
      day,
      name,
      productType:
        meta?.type ??
        UNTRACKED_PRODUCT_TYPES[name] ??
        (sales ? (sales.isBump ? "Bump" : sales.isRecurring ? "Subscription" : "Product") : undefined),
      parentProduct: BUMPS[name],
      orders: sales?.count ?? 0,
      revenueCents: sales?.revenueCents ?? 0,
      newSignups: sales?.newSignups ?? 0,
      renewals: sales?.renewals ?? 0,
      newSignupRevenueCents: sales?.newSignupRevenueCents ?? 0,
      renewalRevenueCents: sales?.renewalRevenueCents ?? 0,
      parentOrders: sales?.isBump ? sales.count : undefined,
    };

    let viewsChanged = false;
    if (pageViews && meta) {
      const views = pageViews[meta.slug] ?? { pageviews: 0, uniques: 0 };
      row.checkoutPageViews = views.pageviews;
      row.checkoutUniques = views.uniques;
      viewsChanged = stored?.checkoutPageViews !== views.pageviews || stored?.checkoutUniques !== views.uniques;
    }
    const salesChanged = SALES_KEYS.some((key) => (stored?.[key] ?? 0) !== row[key]);
    // Rows written before a product was configured can carry a stale type or
    // parent (e.g. a free download typed "Bump"); rewrite them when known.
    const labelsChanged =
      (row.productType !== undefined && stored?.productType !== row.productType) ||
      (row.parentProduct !== undefined && stored?.parentProduct !== row.parentProduct);
    if (salesChanged || viewsChanged || labelsChanged) writes.push(row);
  }
  return writes;
}

// Applies rows from buildDayWrites to an in-memory copy of fetched rows, so a
// dry run can preview rollups exactly as they'd look after writing. Unkeyed
// rows stay separate entries — writes can't reach them, so neither can this.
export function applyWrites(rows, writes) {
  const keyOf = (row) => (row.keyed === false ? `id:${row.airtableId}` : `${row.day}|${row.name}`);
  const byKey = new Map(rows.map((row) => [keyOf(row), row]));
  for (const write of writes) {
    const key = `${write.day}|${write.name}`;
    byKey.set(key, { ...byKey.get(key), ...withoutUndefined(write), keyed: true });
  }
  return [...byKey.values()];
}

// Upserts rows from buildDayWrites via Airtable's native performUpsert on the
// Record ID field (`YYYY-MM-DD|Product Name`), so re-running a day never
// creates duplicates. Undefined fields aren't sent, and PATCH leaves unsent
// fields untouched on existing records.
export async function upsertDailyProductStats(token, rows) {
  const records = rows.map((row) => ({
    fields: withoutUndefined({
      [F.recordId]: `${row.day}|${row.name}`,
      [F.date]: row.day,
      [F.productName]: row.name,
      [F.productType]: row.productType,
      [F.parentProduct]: row.parentProduct,
      [F.checkoutPageViews]: row.checkoutPageViews,
      [F.checkoutUniques]: row.checkoutUniques,
      [F.orders]: row.orders,
      [F.revenue]: row.revenueCents / 100,
      [F.newSignups]: row.newSignups,
      [F.renewals]: row.renewals,
      [F.newSignupRevenue]: row.newSignupRevenueCents / 100,
      [F.renewalRevenue]: row.renewalRevenueCents / 100,
      [F.parentOrders]: row.parentOrders,
    }),
  }));
  await patchInBatches(token, { performUpsert: { fieldsToMergeOn: [F.recordId] }, typecast: true }, records);
}

// Zeroes the sales and page-view fields of unkeyed rows (see
// fetchDailyProductStats) on days that have been rebuilt as keyed rows, so they
// stop double-counting. Records are kept and their original numbers recorded
// in Notes rather than deleted.
export async function zeroOutUnkeyedRows(token, rows, today) {
  const records = rows.map((row) => {
    const note = `Legacy row without Record ID, superseded by the keyed row for this day and zeroed ${today} (was ${row.orders} orders / $${(row.revenueCents / 100).toFixed(2)} / ${row.checkoutPageViews ?? 0} page views)`;
    return {
      id: row.airtableId,
      fields: {
        [F.orders]: 0,
        [F.revenue]: 0,
        [F.newSignups]: 0,
        [F.renewals]: 0,
        [F.newSignupRevenue]: 0,
        [F.renewalRevenue]: 0,
        [F.checkoutPageViews]: 0,
        [F.checkoutUniques]: 0,
        [F.notes]: row.notes ? `${row.notes} · ${note}` : note,
      },
    };
  });
  await patchInBatches(token, {}, records);
}

// Writes one daily snapshot row (active/churn/MRR) for `date` (YYYY-MM-DD).
// Upserts on the Snapshot Date field, so re-running for the same date updates
// the row in place rather than creating a duplicate — same pattern as
// upsertDailyProductStats. `snapshot` is subscriptions.mjs's `snapshot` object
// plus the two trailing-6 averages.
export async function upsertSubscriptionSnapshot(token, date, snapshot, trailing6) {
  await airtableFetch(token, `/${AIRTABLE_SUBSCRIPTION_SNAPSHOTS_TABLE}`, {
    method: "PATCH",
    body: {
      performUpsert: { fieldsToMergeOn: [SF.snapshotDate] },
      records: [
        {
          fields: {
            [SF.snapshotDate]: date,
            [SF.date]: date,
            [SF.active]: snapshot.active,
            [SF.pastDue]: snapshot.pastDue,
            [SF.trialing]: snapshot.trialing,
            [SF.canceled]: snapshot.canceled,
            [SF.total]: snapshot.total,
            [SF.activeMrr]: Math.round(snapshot.activeMrrCents / 100),
            [SF.medianTenureDays]: snapshot.medianTenureDays,
            [SF.avgNewSignupsT6]: trailing6.avgNewSignups,
            [SF.avgChurnPctT6]: trailing6.avgChurnPct,
          },
        },
      ],
      typecast: true,
    },
  });
}

function sumByProduct(rows) {
  const totals = {}; // productName -> { count, revenue } (revenue in cents)
  for (const row of rows) {
    const total = (totals[row.name] ??= { count: 0, revenue: 0 });
    total.count += row.orders;
    total.revenue += row.revenueCents;
  }
  return totals;
}

function toTuples(totals) {
  return Object.entries(totals).filter(([, v]) => v.count > 0 || v.revenue > 0);
}

// Builds SC_DATA.byProductPeriod (daily/weekly/monthly/ytd) and SC_PREV_30
// (prior full calendar month — the variable the LIVE dashboard JS actually
// reads as of 2026-06-22; see task_1223089d for the SC_PREV_WEEK doc/code
// drift this intentionally does NOT follow until that's resolved) from rows
// returned by fetchDailyProductStats covering all of those windows.
export function buildPeriodRollups(rows, { yesterday, sevenDaysAgo, monthStart, ytdStart, priorMonthStart, priorMonthEnd }) {
  const between = (from, to) => rows.filter((row) => row.day >= from && row.day <= to);
  const priorMonthRows = between(priorMonthStart, priorMonthEnd);
  return {
    byProductPeriod: {
      daily: toTuples(sumByProduct(between(yesterday, yesterday))),
      weekly: toTuples(sumByProduct(between(sevenDaysAgo, yesterday))),
      monthly: toTuples(sumByProduct(between(monthStart, yesterday))),
      ytd: toTuples(sumByProduct(between(ytdStart, yesterday))),
    },
    SC_PREV_30: priorMonthRows.length ? Object.fromEntries(toTuples(sumByProduct(priorMonthRows))) : {},
  };
}

// Builds SC_DATA.growth for the Sales tab's "New Signups vs Renewals" card:
// rolling 7-day / 30-day / YTD totals (money in cents) plus new signups per
// calendar month this year, the current month flagged partial.
export function buildGrowth(rows, { yesterday, sevenDaysAgo, thirtyDaysAgo, ytdStart }) {
  const windowTotals = (from) => {
    const totals = { newSignups: 0, newRevenue: 0, renewals: 0, renewalRevenue: 0 };
    for (const row of rows) {
      if (row.day < from || row.day > yesterday) continue;
      totals.newSignups += row.newSignups;
      totals.newRevenue += row.newSignupRevenueCents;
      totals.renewals += row.renewals;
      totals.renewalRevenue += row.renewalRevenueCents;
    }
    return { ...totals, totalRevenue: totals.newRevenue + totals.renewalRevenue };
  };

  const monthlyNewSignups = [];
  for (let month = ytdStart.slice(0, 7); month <= yesterday.slice(0, 7); month = addMonths(month, 1)) {
    const count = rows
      .filter((row) => row.day.startsWith(month) && row.day <= yesterday)
      .reduce((sum, row) => sum + row.newSignups, 0);
    const label = new Date(`${month}-01T00:00:00Z`).toLocaleString("en-US", { month: "short", timeZone: "UTC" });
    monthlyNewSignups.push({ month: label, count });
  }
  if (monthlyNewSignups.length) monthlyNewSignups[monthlyNewSignups.length - 1].partial = true;

  return {
    week: windowTotals(sevenDaysAgo),
    month: windowTotals(thirtyDaysAgo),
    ytd: windowTotals(ytdStart),
    monthlyNewSignups,
  };
}

function addDays(isoDate, n) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function addMonths(yearMonth, n) {
  const d = new Date(`${yearMonth}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
}
