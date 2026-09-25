// Direct SureCart REST API calls (https://api.surecart.com/v1), replacing the
// SureCart MCP "Abilities" the agent-driven skill used to rely on (which only
// expose transactional operations, not the admin-rendered Items Purchased /
// Bumps reports — see SKILL.md history and the 2026-06-22 refresh run).
//
// VERIFIED LIVE against the real API on 2026-06-22 (not just docs-guessed):
//   - GET /v1/orders?status[]=paid&limit=100&page=N returns newest-first by
//     created_at — no separate sort param needed, no date-filter param on
//     this endpoint. We paginate from page 1 and stop as soon as we pass
//     the window, since results are already newest-first.
//   - Expanding nested resources uses REPEATED `expand[]=` params (array
//     bracket syntax), NOT a comma-separated single param:
//       expand[]=checkout&expand[]=checkout.line_items&expand[]=line_item.price&expand[]=price.product
//   - A line_item's `bump` field is a UUID STRING when it's a bump line item,
//     and `null` for a regular line item — it is NOT a boolean as initially
//     assumed from docs alone. Use `li.bump != null` to detect bumps.
//   - line_item.total_amount is in CENTS, confirmed against three known bump
//     prices ($47/$9/$1/$17) matching exactly.
//   - The order object itself has NO amount field — `checkout.total_amount`
//     (cents) is the order's paid amount; you must expand `checkout` to get it.
//
// VERIFIED LIVE on 2026-09-14:
//   - The LIST endpoint honors the same expand[] params, so one page call
//     returns 100 orders with their line items — no per-order fetches.
//   - api.surecart.com sits behind Cloudflare, which temporarily bans an IP
//     (HTTP 429, error 1015) for bursty traffic — 5 concurrent requests tripped
//     it. Calls here are sequential and paced, and a 429 waits a full minute.
//   - SureCart's own daily order statistics bucket orders by created_at in
//     America/New_York. Bucketing the same way makes our days match its reports.
//   - A failed renewal charge is retried on the SAME order, whose status flips
//     to paid 1–14 days after created_at (all 266 late payments Jan–Sep 2026
//     landed within 336h). A run that reads only yesterday misses them for
//     good, so index.mjs re-derives a trailing window of days on every run.
//   - order_type is "checkout" (customer-initiated purchase) or "subscription"
//     (billing-cycle charge). A recurring-price line item in a checkout order is
//     a NEW SIGNUP (incl. $1 trial starts); in a subscription order it's a
//     RENEWAL (incl. trial→paid conversions). August 2026 new signups by this
//     rule (95) matched subscriptions.mjs's created_at count exactly.

import { BUMPS, PRODUCT_ALIASES } from "./config.mjs";

const API_BASE = "https://api.surecart.com/v1";
const LINE_ITEM_EXPAND = "expand[]=checkout&expand[]=checkout.line_items&expand[]=line_item.price&expand[]=price.product";

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;
const RATE_LIMIT_WAIT_MS = 65_000;
const PAGE_PACE_MS = 400;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const etDayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

// YYYY-MM-DD of a unix-seconds instant in America/New_York.
export function etDay(unixSeconds) {
  return etDayFormatter.format(new Date(unixSeconds * 1000));
}

// Retries timeouts, network drops (e.g. undici's `TypeError: terminated`),
// 5xx, and Cloudflare 429s. Other 4xx errors won't resolve themselves and
// fail immediately.
async function scFetch(apiKey, path) {
  const endpoint = path.split("?")[0];
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      const message = err.name === "TimeoutError" ? `timed out after ${REQUEST_TIMEOUT_MS}ms` : err.message;
      if (attempt >= MAX_RETRIES) throw new Error(`SureCart API request failed on GET ${endpoint}: ${message}`);
      console.warn(`[surecart] retrying GET ${endpoint} after error: ${message} (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
      continue;
    }
    if (res.ok) return res.json();

    const rateLimited = res.status === 429;
    const detail = rateLimited ? "rate limited by Cloudflare" : (await res.text()).slice(0, 300);
    const err = new Error(`SureCart API ${res.status} on GET ${endpoint}: ${detail}`);
    if ((!rateLimited && res.status < 500) || attempt >= MAX_RETRIES) throw err;
    const delay = rateLimited ? RATE_LIMIT_WAIT_MS : RETRY_BASE_DELAY_MS * 2 ** attempt;
    console.warn(`[surecart] ${err.message} — retrying in ${delay / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})`);
    await sleep(delay);
  }
}

async function* iteratePaidOrdersNewestFirst(apiKey) {
  for (let page = 1; ; page++) {
    const result = await scFetch(apiKey, `/orders?status[]=paid&limit=100&page=${page}&${LINE_ITEM_EXPAND}`);
    if (!result.data?.length) return;
    for (const order of result.data) yield order;
    if (result.data.length < 100) return;
    await sleep(PAGE_PACE_MS);
  }
}

// Builds per-day, per-product sales for paid orders created fromDay..toDay
// (inclusive, ET dates):
//   { "YYYY-MM-DD": { orderCount, breakdown: { "Product Name": {
//       count, revenueCents, newSignups, newSignupRevenueCents,
//       renewals, renewalRevenueCents, isBump, isRecurring } } } }
// The line item's own `bump` field (non-null = bump) is authoritative for
// whether something is a bump; config.BUMPS is only a name cross-check.
// Product names are trimmed — SureCart has at least one with a trailing space —
// then mapped through config.PRODUCT_ALIASES to the dashboard's product name.
export async function fetchSureCartDailyBreakdowns({ apiKey, fromDay, toDay }) {
  const byDay = {};
  const unmatchedLineItems = [];

  for await (const order of iteratePaidOrdersNewestFirst(apiKey)) {
    const createdDay = etDay(order.created_at);
    if (createdDay > toDay) continue;
    if (createdDay < fromDay) break; // newest-first: walked past the window
    if (typeof order.checkout !== "object" || order.checkout === null) {
      throw new Error(`SureCart list response did not expand checkout for order ${order.id} — expand[] params no longer honored on /orders?`);
    }

    const day = (byDay[createdDay] ??= { orderCount: 0, breakdown: {} });
    day.orderCount += 1;
    for (const li of order.checkout.line_items?.data ?? []) {
      const scName = li.price?.product?.name?.trim();
      const name = PRODUCT_ALIASES[scName] ?? scName;
      if (!name) {
        unmatchedLineItems.push({ orderId: order.id, raw: li });
        continue;
      }
      const cents = li.total_amount ?? 0;
      const recurring = li.price?.recurring_interval != null;
      const entry = (day.breakdown[name] ??= {
        count: 0,
        revenueCents: 0,
        newSignups: 0,
        newSignupRevenueCents: 0,
        renewals: 0,
        renewalRevenueCents: 0,
        isBump: false,
        isRecurring: false,
      });
      entry.count += 1;
      entry.revenueCents += cents;
      entry.isBump ||= li.bump != null || Object.prototype.hasOwnProperty.call(BUMPS, name);
      entry.isRecurring ||= recurring;
      if (recurring && order.order_type === "checkout") {
        entry.newSignups += 1;
        entry.newSignupRevenueCents += cents;
      } else if (recurring && order.order_type === "subscription") {
        entry.renewals += 1;
        entry.renewalRevenueCents += cents;
      }
    }
  }

  if (unmatchedLineItems.length) {
    console.warn(
      `[surecart] ${unmatchedLineItems.length} line item(s) had no resolvable product name. Sample:`,
      JSON.stringify(unmatchedLineItems[0], null, 2)
    );
  }

  return byDay;
}

// Most recent N paid orders, any date — for SC_DATA.recentOrders.
export async function fetchRecentPaidOrders({ apiKey, limit = 8 }) {
  const result = await scFetch(apiKey, `/orders?status[]=paid&limit=${limit}&page=1&expand[]=checkout`);
  return (result.data ?? []).map((order) => ({
    id: order.id,
    number: order.number,
    created_at: order.created_at,
    status: order.status,
    amount: order.checkout?.total_amount ?? null, // cents
  }));
}
