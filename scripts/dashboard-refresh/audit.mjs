// Read-only reconciliation: compares what the dashboard's Airtable store
// (Daily Product Stats) holds for a date range against live SureCart orders and
// live Fathom pageviews for the same days. Writes nothing to any service — only
// optional local files (JSON report, SureCart order cache).
//
//   node --env-file=.env audit.mjs --from=2026-08-01 --to=2026-09-13 [--json=report.json] [--cache=orders-cache.json]
//
// SureCart days are bucketed by order created_at in America/New_York — the same
// attribution SureCart's own order statistics use — so the "SureCart" columns
// are what SureCart's admin reports show for those days.
//
// SureCart sits behind Cloudflare, which temporarily bans an IP (error 1015)
// for bursty traffic — 5 concurrent requests was enough to trip it. Requests
// here are strictly sequential and paced; --cache lets an interrupted run
// resume without re-fetching orders it already has.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  PRODUCTS,
  BUMPS,
  TRACKED_PATHNAMES,
  FATHOM_SITE_ID,
  AIRTABLE_BASE_ID,
  AIRTABLE_DAILY_PRODUCT_STATS_TABLE,
  DAILY_PRODUCT_STATS_FIELDS as F,
} from "./config.mjs";

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const FROM = arg("from");
const TO = arg("to");
const JSON_OUT = arg("json");
const CACHE = arg("cache");
if (!FROM || !TO) throw new Error("usage: audit.mjs --from=YYYY-MM-DD --to=YYYY-MM-DD [--json=path] [--cache=path]");

const SURECART_API_KEY = process.env.SURECART_API_KEY;
const FATHOM_API_TOKEN = process.env.FATHOM_API_TOKEN;
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;

const LINE_ITEM_EXPAND = "expand[]=checkout&expand[]=checkout.line_items&expand[]=line_item.price&expand[]=price.product";
const SURECART_PACE_MS = 400;
const SURECART_BAN_WAIT_MS = 65_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const etFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const etDay = (unixSeconds) => etFormatter.format(new Date(unixSeconds * 1000));

function addDays(isoDate, n) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dateRange(from, to) {
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
}

// ---------- SureCart ----------

async function scFetch(path) {
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(`https://api.surecart.com/v1${path}`, {
        headers: { Authorization: `Bearer ${SURECART_API_KEY}` },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      if (attempt >= 4) throw err;
      await sleep(2000 * attempt);
      continue;
    }
    if (res.ok) {
      await sleep(SURECART_PACE_MS);
      return res.json();
    }
    const text = (await res.text()).slice(0, 200).replace(/\s+/g, " ");
    if (res.status === 429 && attempt <= 10) {
      console.error(`[audit] SureCart 429 (Cloudflare rate limit) — waiting ${SURECART_BAN_WAIT_MS / 1000}s (attempt ${attempt})`);
      await sleep(SURECART_BAN_WAIT_MS);
      continue;
    }
    if (res.status >= 500 && attempt < 4) {
      await sleep(2000 * attempt);
      continue;
    }
    throw new Error(`SureCart API ${res.status} on GET ${path.split("?")[0]}: ${text}`);
  }
}

function summarizeOrder(order, checkout) {
  return {
    id: order.id,
    number: order.number,
    orderType: order.order_type,
    createdDay: etDay(order.created_at),
    paidDay: checkout.paid_at ? etDay(checkout.paid_at) : null,
    lagHours: checkout.paid_at ? Math.round((checkout.paid_at - order.created_at) / 3600) : null,
    totalCents: checkout.total_amount ?? 0,
    refundedCents: checkout.refunded_amount ?? 0,
    lines: (checkout.line_items?.data ?? []).map((li) => ({
      name: li.price?.product?.name?.trim() || null,
      cents: li.total_amount ?? 0,
      bump: li.bump != null,
      recurring: li.price?.recurring_interval != null,
    })),
  };
}

// Paid orders are listed newest-first by created_at; walk pages until the
// oldest order on a page is before FROM (in ET). Line items are requested on
// the list call itself — if SureCart honors that, no per-order calls are needed.
async function listPaidOrdersInRange() {
  const orders = [];
  for (let page = 1; ; page++) {
    const result = await scFetch(`/orders?status[]=paid&limit=100&page=${page}&${LINE_ITEM_EXPAND}`);
    const rows = result.data ?? [];
    for (const order of rows) {
      const day = etDay(order.created_at);
      if (day >= FROM && day <= TO) orders.push(order);
    }
    if (rows.length < 100 || etDay(rows[rows.length - 1].created_at) < FROM) break;
  }
  return orders;
}

async function fetchSureCartOrders() {
  const listed = await listPaidOrdersInRange();
  const expandedInList = listed.every((o) => Array.isArray(o.checkout?.line_items?.data));
  console.error(`[audit] SureCart: ${listed.length} paid orders created ${FROM}..${TO}; line items ${expandedInList ? "included in list response" : "need per-order fetches"}`);
  if (expandedInList) return listed.map((order) => summarizeOrder(order, order.checkout));

  const cache = CACHE && existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
  const out = [];
  for (const [i, order] of listed.entries()) {
    if (!cache[order.id]) {
      const full = await scFetch(`/orders/${order.id}?${LINE_ITEM_EXPAND}`);
      cache[order.id] = summarizeOrder(order, full.checkout ?? {});
      if (CACHE && i % 25 === 0) writeFileSync(CACHE, JSON.stringify(cache));
      if (i % 100 === 0) console.error(`[audit]   expanded ${i}/${listed.length}`);
    }
    out.push(cache[order.id]);
  }
  if (CACHE) writeFileSync(CACHE, JSON.stringify(cache));
  return out;
}

// ---------- Airtable ----------

async function fetchAirtableRows() {
  const records = [];
  let offset;
  const formula = `AND(IS_AFTER({${F.date}}, '${addDays(FROM, -1)}'), IS_BEFORE({${F.date}}, '${addDays(TO, 1)}'))`;
  do {
    const params = new URLSearchParams({ pageSize: "100", returnFieldsByFieldId: "true", filterByFormula: formula });
    if (offset) params.set("offset", offset);
    const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_DAILY_PRODUCT_STATS_TABLE}?${params}`, {
      headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
    });
    if (!res.ok) throw new Error(`Airtable API ${res.status}: ${await res.text()}`);
    const result = await res.json();
    records.push(...result.records);
    offset = result.offset;
  } while (offset);
  return records.map((rec) => ({
    day: rec.fields[F.date],
    name: rec.fields[F.productName],
    type: rec.fields[F.productType],
    orders: Number(rec.fields[F.orders] ?? 0),
    cents: Math.round(Number(rec.fields[F.revenue] ?? 0) * 100),
    pageviews: rec.fields[F.checkoutPageViews],
  }));
}

// ---------- Fathom ----------

async function callFathom(params, attempt = 1) {
  const url = new URL("https://api.usefathom.com/v1/aggregations");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${FATHOM_API_TOKEN}` } });
  if (res.status === 429 && attempt <= 6) {
    const retryAfter = Number(res.headers.get("retry-after"));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : attempt * 2000);
    return callFathom(params, attempt + 1);
  }
  if (!res.ok) throw new Error(`Fathom API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function fetchFathomDailyByPath() {
  const byPath = {};
  for (const path of new Set(TRACKED_PATHNAMES)) {
    const rows = await callFathom({
      entity: "pageview",
      entity_id: FATHOM_SITE_ID,
      aggregates: "pageviews,uniques",
      date_from: FROM,
      date_to: TO,
      date_grouping: "day",
      filters: JSON.stringify([{ property: "pathname", operator: "is", value: path }]),
      timezone: "America/New_York",
    });
    byPath[path] = Object.fromEntries(rows.map((row) => [String(row.date).slice(0, 10), Number(row.pageviews ?? 0)]));
    await sleep(250);
  }
  return byPath;
}

// ---------- Compare ----------

const usd = (cents) => `$${(cents / 100).toFixed(2)}`;
const pad = (v, n) => String(v).padStart(n);

async function main() {
  const airtableRows = await fetchAirtableRows();
  console.error(`[audit] Airtable: ${airtableRows.length} rows; querying Fathom per tracked page...`);
  const fathomByPath = await fetchFathomDailyByPath();
  const orders = await fetchSureCartOrders();

  const days = dateRange(FROM, TO);
  const blankDay = () => ({ orders: 0, items: 0, cents: 0, lateOrders: 0, lateCents: 0, unnamed: 0, byProduct: {} });
  const sc = Object.fromEntries(days.map((d) => [d, blankDay()]));
  const at = Object.fromEntries(days.map((d) => [d, { items: 0, cents: 0, byProduct: {} }]));
  const orderTypes = {};
  const unknownProducts = {};
  const growthByMonth = {};
  const lateOrders = [];

  for (const order of orders) {
    const day = sc[order.createdDay];
    if (!day) continue;
    orderTypes[order.orderType] = (orderTypes[order.orderType] ?? 0) + 1;
    day.orders += 1;
    const orderCents = order.lines.reduce((s, l) => s + l.cents, 0);
    if (order.paidDay && order.paidDay > order.createdDay) {
      day.lateOrders += 1;
      day.lateCents += orderCents;
      lateOrders.push({ number: order.number, orderType: order.orderType, createdDay: order.createdDay, paidDay: order.paidDay, lagHours: order.lagHours, cents: orderCents, products: order.lines.map((l) => l.name) });
    }
    const month = order.createdDay.slice(0, 7);
    const g = (growthByMonth[month] ??= { newSignups: 0, newCents: 0, renewals: 0, renewalCents: 0, otherItems: 0, otherCents: 0 });
    for (const line of order.lines) {
      if (!line.name) {
        day.unnamed += 1;
        continue;
      }
      day.items += 1;
      day.cents += line.cents;
      const p = (day.byProduct[line.name] ??= { count: 0, cents: 0 });
      p.count += 1;
      p.cents += line.cents;
      if (!PRODUCTS[line.name] && !BUMPS[line.name]) {
        const u = (unknownProducts[line.name] ??= { count: 0, cents: 0, bump: line.bump });
        u.count += 1;
        u.cents += line.cents;
      }
      if (line.recurring && order.orderType === "checkout") {
        g.newSignups += 1;
        g.newCents += line.cents;
      } else if (line.recurring && order.orderType === "subscription") {
        g.renewals += 1;
        g.renewalCents += line.cents;
      } else {
        g.otherItems += 1;
        g.otherCents += line.cents;
      }
    }
  }

  for (const row of airtableRows) {
    const day = at[row.day];
    if (!day || !row.name) continue;
    day.items += row.orders;
    day.cents += row.cents;
    const p = (day.byProduct[row.name] ??= { count: 0, cents: 0, pageviews: 0 });
    p.count += row.orders;
    p.cents += row.cents;
    p.pageviews += Number(row.pageviews ?? 0);
  }

  // --- Daily totals ---
  console.log("\n=== DAILY: SureCart (live, by created_at ET) vs Airtable (what the dashboard sums) ===");
  console.log("date        SC.ord SC.items     SC.$ | AT.items     AT.$ |      Δ$  | late.ord  late.$  unnamed");
  const monthTotals = {};
  for (const d of days) {
    const s = sc[d];
    const a = at[d];
    const delta = s.cents - a.cents;
    const m = (monthTotals[d.slice(0, 7)] ??= { scOrders: 0, scItems: 0, scCents: 0, atItems: 0, atCents: 0, lateOrders: 0, lateCents: 0, daysOff: 0 });
    m.scOrders += s.orders;
    m.scItems += s.items;
    m.scCents += s.cents;
    m.atItems += a.items;
    m.atCents += a.cents;
    m.lateOrders += s.lateOrders;
    m.lateCents += s.lateCents;
    if (delta !== 0 || s.items !== a.items) m.daysOff += 1;
    const flag = delta !== 0 || s.items !== a.items ? " <<" : "";
    console.log(`${d} ${pad(s.orders, 6)} ${pad(s.items, 8)} ${pad(usd(s.cents), 9)} | ${pad(a.items, 8)} ${pad(usd(a.cents), 9)} | ${pad(usd(delta), 8)} | ${pad(s.lateOrders, 8)} ${pad(usd(s.lateCents), 7)} ${pad(s.unnamed, 8)}${flag}`);
  }

  console.log("\n=== MONTHLY TOTALS ===");
  for (const [month, m] of Object.entries(monthTotals)) {
    console.log(`${month}: SureCart ${m.scOrders} orders / ${m.scItems} items / ${usd(m.scCents)}  |  Airtable ${m.atItems} items / ${usd(m.atCents)}  |  Δ ${usd(m.scCents - m.atCents)}  |  days off: ${m.daysOff}  |  late-paid orders: ${m.lateOrders} (${usd(m.lateCents)})`);
  }

  // --- Per-product monthly diffs ---
  console.log("\n=== PER-PRODUCT MONTHLY DIFFS (only rows that differ) ===");
  for (const month of Object.keys(monthTotals)) {
    const scP = {};
    const atP = {};
    for (const d of days.filter((x) => x.startsWith(month))) {
      for (const [name, v] of Object.entries(sc[d].byProduct)) {
        const t = (scP[name] ??= { count: 0, cents: 0 });
        t.count += v.count;
        t.cents += v.cents;
      }
      for (const [name, v] of Object.entries(at[d].byProduct)) {
        const t = (atP[name] ??= { count: 0, cents: 0 });
        t.count += v.count;
        t.cents += v.cents;
      }
    }
    console.log(`-- ${month}`);
    for (const name of new Set([...Object.keys(scP), ...Object.keys(atP)])) {
      const s = scP[name] ?? { count: 0, cents: 0 };
      const a = atP[name] ?? { count: 0, cents: 0 };
      if (s.count === a.count && s.cents === a.cents) continue;
      console.log(`   ${name.padEnd(58)} SC ${pad(s.count, 4)} ${pad(usd(s.cents), 10)} | AT ${pad(a.count, 4)} ${pad(usd(a.cents), 10)} | Δ ${usd(s.cents - a.cents)}`);
    }
  }

  console.log("\n=== ORDER TYPES ===", JSON.stringify(orderTypes));
  console.log("\n=== PRODUCTS NOT IN config PRODUCTS/BUMPS (still counted in totals, but typed 'Bump' in Airtable) ===");
  for (const [name, u] of Object.entries(unknownProducts)) console.log(`   ${name}: ${u.count} items, ${usd(u.cents)}${u.bump ? " (bump)" : ""}`);

  console.log("\n=== LATE-PAID ORDERS (paid on a later ET day than created) ===");
  const lagBuckets = { "<24h": 0, "1-3d": 0, "3-7d": 0, "7-14d": 0, ">14d": 0 };
  for (const o of lateOrders) {
    const h = o.lagHours;
    lagBuckets[h < 24 ? "<24h" : h < 72 ? "1-3d" : h < 168 ? "3-7d" : h < 336 ? "7-14d" : ">14d"] += 1;
  }
  console.log("   lag distribution:", JSON.stringify(lagBuckets), " by type:", JSON.stringify(lateOrders.reduce((acc, o) => ({ ...acc, [o.orderType]: (acc[o.orderType] ?? 0) + 1 }), {})));

  console.log("\n=== GROWTH SPLIT BY MONTH (SureCart line items: recurring price in checkout order = new signup; in subscription order = renewal) ===");
  for (const [month, g] of Object.entries(growthByMonth).sort()) {
    console.log(`   ${month}: new ${g.newSignups} (${usd(g.newCents)}) | renewals ${g.renewals} (${usd(g.renewalCents)}) | one-time/other ${g.otherItems} (${usd(g.otherCents)})`);
  }

  // --- Fathom checkout page views vs Airtable ---
  console.log("\n=== FATHOM PAGEVIEWS PER TRACKED PRODUCT PAGE: Fathom (live) vs Airtable Checkout Page Views ===");
  console.log("product                                          slug                                   month    Fathom  Airtable  daysDiffer  daysAT0butFathom>0");
  const fathomReport = [];
  for (const [name, meta] of Object.entries(PRODUCTS)) {
    const byDay = fathomByPath[meta.slug] ?? {};
    for (const month of Object.keys(monthTotals)) {
      let fv = 0;
      let av = 0;
      let differ = 0;
      let zeroed = 0;
      for (const d of days.filter((x) => x.startsWith(month))) {
        const f = byDay[d] ?? 0;
        const a = Number(at[d].byProduct[name]?.pageviews ?? 0);
        fv += f;
        av += a;
        if (f !== a) differ += 1;
        if (a === 0 && f > 0) zeroed += 1;
      }
      fathomReport.push({ name, slug: meta.slug, month, fathom: fv, airtable: av, differ, zeroed });
      if (fv === 0 && av === 0) continue;
      console.log(`${name.slice(0, 48).padEnd(48)} ${meta.slug.slice(0, 38).padEnd(38)} ${month} ${pad(fv, 8)} ${pad(av, 9)} ${pad(differ, 11)} ${pad(zeroed, 19)}`);
    }
  }

  if (JSON_OUT) {
    writeFileSync(JSON_OUT, JSON.stringify({ from: FROM, to: TO, sc, at, monthTotals, orderTypes, unknownProducts, lateOrders, growthByMonth, fathomReport }, null, 2));
    console.error(`[audit] wrote ${JSON_OUT}`);
  }
}

main().catch((err) => {
  console.error(`[audit] FAILED: ${err.message}`);
  process.exit(1);
});
