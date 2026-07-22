// Direct Airtable REST API calls (https://api.airtable.com/v0/{baseId}/{tableId}),
// replacing the Airtable MCP tools. Airtable stays the canonical data store —
// this script's only Airtable writes are the same daily per-product upsert the
// agent-driven skill already did, so any future second dashboard can read this
// table directly without depending on this script at all.

import {
  AIRTABLE_BASE_ID,
  AIRTABLE_DAILY_PRODUCT_STATS_TABLE,
  AIRTABLE_SUBSCRIPTION_SNAPSHOTS_TABLE,
  DAILY_PRODUCT_STATS_FIELDS as F,
  SUBSCRIPTION_SNAPSHOT_FIELDS as SF,
} from "./config.mjs";

const API_BASE = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}`;

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

// Writes one Daily Product Stats record per product for `date` (YYYY-MM-DD).
// Upserts via Airtable's native performUpsert on the Record ID field, so this
// is safe to re-run for the same date without creating duplicates.
export async function upsertDailyProductStats(token, date, productRows) {
  const records = productRows.map((row) => ({
    fields: {
      [F.recordId]: `${date}|${row.productName}`,
      [F.date]: date,
      [F.productName]: row.productName,
      [F.productType]: row.productType,
      ...(row.parentProduct ? { [F.parentProduct]: row.parentProduct } : {}),
      [F.checkoutPageViews]: row.checkoutPageViews ?? 0,
      [F.checkoutUniques]: row.checkoutUniques ?? 0,
      [F.orders]: row.orders ?? 0,
      [F.revenue]: row.revenue ?? 0,
      ...(row.newSignups !== undefined ? { [F.newSignups]: row.newSignups } : {}),
      ...(row.renewals !== undefined ? { [F.renewals]: row.renewals } : {}),
      ...(row.parentOrders !== undefined ? { [F.parentOrders]: row.parentOrders } : {}),
    },
  }));

  // Airtable allows max 50 records per request.
  for (let i = 0; i < records.length; i += 50) {
    const batch = records.slice(i, i + 50);
    await airtableFetch(token, `/${AIRTABLE_DAILY_PRODUCT_STATS_TABLE}`, {
      method: "PATCH",
      body: {
        performUpsert: { fieldsToMergeOn: [F.recordId] },
        records: batch,
        typecast: true,
      },
    });
  }
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

function sumByProduct(records) {
  const totals = {}; // productName -> { count, revenue } (revenue in dollars)
  for (const rec of records) {
    const name = rec.fields[F.productName];
    if (!name) continue;
    if (!totals[name]) totals[name] = { count: 0, revenue: 0 };
    totals[name].count += Number(rec.fields[F.orders] ?? 0);
    totals[name].revenue += Number(rec.fields[F.revenue] ?? 0);
  }
  return totals;
}

function toCentsTuples(totals) {
  return Object.entries(totals)
    .filter(([, v]) => v.count > 0 || v.revenue > 0)
    .map(([name, v]) => [name, { count: v.count, revenue: Math.round(v.revenue * 100) }]);
}

// Builds SC_DATA.byProductPeriod (daily/weekly/monthly/ytd) and SC_PREV_30
// (prior full calendar month — the variable the LIVE dashboard JS actually
// reads as of 2026-06-22; see task_1223089d for the SC_PREV_WEEK doc/code
// drift this intentionally does NOT follow until that's resolved).
export async function buildPeriodRollups(token, { yesterday, sevenDaysAgo, monthStart, ytdStart, priorMonthStart, priorMonthEnd }) {
  const dateField = F.date;

  const [dailyRecs, weeklyRecs, monthlyRecs, ytdRecs, priorMonthRecs] = await Promise.all([
    // Plain `{field} = 'date'` does NOT match Airtable date-type fields
    // reliably (confirmed live on 2026-06-22 — returned 0 rows against a
    // known-good date) — IS_SAME(...,'day') is the correct comparison.
    listAllRecords(token, `IS_SAME({${dateField}}, '${yesterday}', 'day')`),
    listAllRecords(token, `AND(IS_AFTER({${dateField}}, '${addDays(sevenDaysAgo, -1)}'), IS_BEFORE({${dateField}}, '${addDays(yesterday, 1)}'))`),
    listAllRecords(token, `AND(IS_AFTER({${dateField}}, '${addDays(monthStart, -1)}'), IS_BEFORE({${dateField}}, '${addDays(yesterday, 1)}'))`),
    listAllRecords(token, `AND(IS_AFTER({${dateField}}, '${addDays(ytdStart, -1)}'), IS_BEFORE({${dateField}}, '${addDays(yesterday, 1)}'))`),
    listAllRecords(token, `AND(IS_AFTER({${dateField}}, '${addDays(priorMonthStart, -1)}'), IS_BEFORE({${dateField}}, '${addDays(priorMonthEnd, 1)}'))`),
  ]);

  return {
    byProductPeriod: {
      daily: toCentsTuples(sumByProduct(dailyRecs)),
      weekly: toCentsTuples(sumByProduct(weeklyRecs)),
      monthly: toCentsTuples(sumByProduct(monthlyRecs)),
      ytd: toCentsTuples(sumByProduct(ytdRecs)),
    },
    SC_PREV_30: priorMonthRecs.length ? Object.fromEntries(toCentsTuples(sumByProduct(priorMonthRecs))) : {},
  };
}

function addDays(isoDate, n) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
