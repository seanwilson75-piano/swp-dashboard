// Direct SureCart REST API calls (https://api.surecart.com/v1), replacing the
// SureCart MCP "Abilities" the agent-driven skill used to rely on (which only
// expose transactional operations, not the admin-rendered Items Purchased /
// Bumps reports — see SKILL.md history and the 2026-06-22 refresh run).
//
// VERIFIED LIVE against the real API on 2026-06-22 (not just docs-guessed):
//   - GET /v1/orders?status[]=paid&limit=100&page=N returns newest-first by
//     created_at — no separate sort param needed, no date-filter param on
//     this endpoint. We paginate from page 1 and stop as soon as we pass
//     yesterday's window, since results are already newest-first.
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

import { BUMPS } from "./config.mjs";

const API_BASE = "https://api.surecart.com/v1";
const LINE_ITEM_EXPAND = "expand[]=checkout&expand[]=checkout.line_items&expand[]=line_item.price&expand[]=price.product";

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Retries on timeouts, network drops, and 5xx — these are the transient
// failures seen in practice (e.g. a stalled connection that undici reports
// as `TypeError: terminated`). 4xx errors are not retried since they won't
// resolve themselves.
async function scFetch(apiKey, path) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
      if (res.ok) return await res.json();
      const text = await res.text();
      const err = new Error(`SureCart API ${res.status} on GET ${path}: ${text}`);
      if (res.status < 500) throw err;
      lastErr = err;
    } catch (err) {
      lastErr = err.name === "AbortError"
        ? new Error(`SureCart API request timed out after ${REQUEST_TIMEOUT_MS}ms on GET ${path}`)
        : err;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < MAX_RETRIES) {
      const delay = RETRY_BASE_DELAY_MS * 2 ** attempt;
      console.warn(`[surecart] retrying GET ${path} after error: ${lastErr.message} (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await sleep(delay);
    }
  }
  throw lastErr;
}

async function* iteratePaidOrdersNewestFirst(apiKey) {
  let page = 1;
  for (;;) {
    const result = await scFetch(apiKey, `/orders?status[]=paid&limit=100&page=${page}`);
    if (!result.data?.length) return;
    for (const order of result.data) yield order;
    if (result.data.length < 100) return;
    page += 1;
  }
}

// Orders are newest-first, so we can stop paginating the moment we see an
// order older than the window start — no need to walk all ~6000+ paid orders.
async function listPaidOrdersForDay(apiKey, startUnix, endUnix) {
  const orders = [];
  for await (const order of iteratePaidOrdersNewestFirst(apiKey)) {
    if (order.created_at > endUnix) continue; // newer than window (shouldn't normally happen on page 1, but skip rather than break)
    if (order.created_at < startUnix) break; // walked past the window — done
    orders.push(order);
  }
  return orders;
}

async function expandOrderLineItems(apiKey, orderId) {
  const order = await scFetch(apiKey, `/orders/${orderId}?${LINE_ITEM_EXPAND}`);
  const lineItems = order?.checkout?.line_items?.data ?? [];
  return { order, lineItems };
}

function lineItemProductName(lineItem) {
  return lineItem?.price?.product?.name ?? null;
}

function lineItemRevenueDollars(lineItem) {
  return (lineItem?.total_amount ?? 0) / 100;
}

// Builds { "Product Name": { count, revenue } } for yesterday. The line
// item's own `bump` field (non-null = bump) is authoritative for whether
// something is a bump; config.BUMPS is only used as a name cross-check.
export async function fetchSureCartDailyBreakdown({ apiKey, yesterdayStartUnix, yesterdayEndUnix }) {
  const orders = await listPaidOrdersForDay(apiKey, yesterdayStartUnix, yesterdayEndUnix);

  const breakdown = {};
  const unmatchedLineItems = [];

  for (const order of orders) {
    const { lineItems } = await expandOrderLineItems(apiKey, order.id);
    for (const li of lineItems) {
      const name = lineItemProductName(li);
      if (!name) {
        unmatchedLineItems.push({ orderId: order.id, raw: li });
        continue;
      }
      const isBump = li.bump != null || Object.prototype.hasOwnProperty.call(BUMPS, name);
      if (!breakdown[name]) breakdown[name] = { count: 0, revenue: 0, isBump };
      breakdown[name].count += 1;
      breakdown[name].revenue += lineItemRevenueDollars(li);
    }
  }

  if (unmatchedLineItems.length) {
    console.warn(
      `[surecart] ${unmatchedLineItems.length} line item(s) had no resolvable product name. Sample:`,
      JSON.stringify(unmatchedLineItems[0], null, 2)
    );
  }

  return { breakdown, orderCount: orders.length };
}

// Most recent N paid orders, any date — for SC_DATA.recentOrders.
export async function fetchRecentPaidOrders({ apiKey, limit = 8 }) {
  const orders = [];
  for await (const order of iteratePaidOrdersNewestFirst(apiKey)) {
    orders.push(order);
    if (orders.length >= limit) break;
  }
  const expanded = await Promise.all(
    orders.map((order) => scFetch(apiKey, `/orders/${order.id}?expand[]=checkout`))
  );
  return expanded.map((order) => ({
    id: order.id,
    number: order.number,
    created_at: order.created_at,
    status: order.status,
    amount: order.checkout?.total_amount ?? null, // cents
  }));
}
