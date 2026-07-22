// Direct SureCart REST API calls for SUBSCRIPTION LIFECYCLE data — retention,
// churn, and monthly-recurring-revenue. Complements surecart.mjs, which only
// pulls /v1/orders (immutable transactions). This module answers a different
// question: of the members who signed up, how many are we KEEPING, and for how
// long — with a focus on the month 1–3 window where churn is concentrated.
//
// WHY A FULL RE-PULL EACH RUN (not a single-day pull like orders):
//   A subscription's status is MUTABLE — someone who signed up three months ago
//   can cancel today. Yesterday's orders never change once placed, but yesterday
//   did change the lifecycle state of older cohorts. So capturing churn requires
//   re-reading the whole subscription list every run. ~1,600 subs / 100 per page
//   ≈ 16 pages — trivial for a once-daily job.
//
// FIELDS USED (verified live 2026-07-22 against the real API):
//   - created_at            unix SECONDS — cohort/start instant
//   - ended_at              unix SECONDS or null — cancellation instant
//   - status                active | trialing | past_due | canceled | completed | incomplete
//   - subtotal_amount       CENTS — the recurring charge
//   - current_period_start_at / current_period_end_at  unix SECONDS — billing interval
//   - live_mode             boolean — we keep only true (defensive; a live key
//                           already only returns live rows)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const API_BASE = "https://api.surecart.com/v1";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;
const DAY = 86400; // seconds
const AVG_MONTH_DAYS = 30.44;

// Known-fraud SureCart subscription IDs (card-testing waves) — excluded from
// every lifecycle metric below so fraud never counts as a real signup,
// cancellation, or churn. See fraud-exclusions.json for the source-of-truth
// list and Notion's "Fraud & Security" runbook (Systems /AI /Dashboards area)
// for incident history.
const __dirname = dirname(fileURLToPath(import.meta.url));
function loadFraudExclusionIds() {
  const path = join(__dirname, "fraud-exclusions.json");
  const { waves } = JSON.parse(readFileSync(path, "utf8"));
  return new Set(waves.flatMap((w) => w.subscriptionIds));
}
const FRAUD_SUBSCRIPTION_IDS = loadFraudExclusionIds();

// Milestones for cohort retention: day 30 / 60 / 90 = "month 1 / 2 / 3".
const RETENTION_MILESTONE_DAYS = [30, 60, 90];
// Day marks for the overall survival curve.
const CURVE_DAY_MARKS = [0, 7, 14, 30, 45, 60, 90];
const TRAILING_MONTHS = 12;
const TRAILING_AVG_MONTHS = 6;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Same retry/timeout semantics as surecart.mjs's scFetch (duplicated rather
// than shared, matching this codebase's self-contained-module convention —
// see the standalone sleep()/fetch helpers in fathom.mjs and surecart.mjs).
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
      console.warn(`[subscriptions] retrying GET ${path} after error: ${lastErr.message} (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await sleep(delay);
    }
  }
  throw lastErr;
}

async function fetchAllLiveSubscriptions(apiKey) {
  const all = [];
  let page = 1;
  for (;;) {
    const result = await scFetch(apiKey, `/subscriptions?limit=100&page=${page}`);
    const rows = result.data ?? [];
    if (!rows.length) break;
    for (const sub of rows) {
      if (sub.live_mode && !FRAUD_SUBSCRIPTION_IDS.has(sub.id)) all.push(sub);
    }
    if (rows.length < 100) break;
    page += 1;
  }
  return all;
}

// Monthly-normalized recurring amount (cents). Billing interval is derived from
// the current period length: ~annual → ÷12, ~quarterly → ÷3, else treated as
// the monthly recurring charge as-is. Only ever summed over ACTIVE subs (whose
// current_period reflects the real billing cadence, not a trial window).
function monthlyAmountCents(sub) {
  const amt = sub.subtotal_amount ?? 0;
  const start = sub.current_period_start_at;
  const end = sub.current_period_end_at;
  if (!start || !end || end <= start) return amt;
  const days = (end - start) / DAY;
  if (days > 300) return Math.round(amt / 12); // annual
  if (days > 80) return Math.round(amt / 3); // quarterly
  return amt; // monthly (7–31 day periods all bill as a monthly recurring charge)
}

// Tenure in days: canceled → time from signup to cancellation; still-live → age.
function tenureDays(sub, now) {
  const end = sub.ended_at ?? now;
  return (end - sub.created_at) / DAY;
}

function monthKey(unixSeconds) {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 7); // YYYY-MM
}

function median(nums) {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

// Trailing list of "YYYY-MM" keys, oldest→newest, ending at the current month.
function trailingMonthKeys(now, count) {
  const keys = [];
  const d = new Date(now * 1000);
  d.setUTCDate(1);
  for (let i = count - 1; i >= 0; i--) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    keys.push(m.toISOString().slice(0, 7));
  }
  return keys;
}

function monthStartUnix(monthKeyStr) {
  return Math.floor(Date.parse(`${monthKeyStr}-01T00:00:00Z`) / 1000);
}

function computeLifecycle(subs, now) {
  const active = subs.filter((s) => s.status === "active");
  const pastDue = subs.filter((s) => s.status === "past_due");
  const trialing = subs.filter((s) => s.status === "trialing");
  const canceled = subs.filter((s) => s.status === "canceled" || s.status === "completed");

  // --- Snapshot ---
  const activeMrrCents = active.reduce((sum, s) => sum + monthlyAmountCents(s), 0);
  const canceledTenures = canceled
    .filter((s) => s.ended_at)
    .map((s) => tenureDays(s, now));
  const snapshot = {
    active: active.length,
    pastDue: pastDue.length,
    trialing: trialing.length,
    canceled: canceled.length,
    total: subs.length,
    activeMrrCents,
    medianTenureDays: Math.round(median(canceledTenures)),
    asOf: new Date(now * 1000).toISOString().slice(0, 10),
  };

  // --- Cohort retention (month 1/2/3 survival by signup month) ---
  // Only cohorts within the trailing window, and within each cohort only subs
  // old enough to have reached a given milestone, count toward that milestone.
  const cohortKeys = trailingMonthKeys(now, TRAILING_MONTHS);
  const cohortRetention = cohortKeys.map((cohortMonth) => {
    const cohort = subs.filter((s) => monthKey(s.created_at) === cohortMonth);
    const row = { cohortMonth, size: cohort.length };
    RETENTION_MILESTONE_DAYS.forEach((milestone, i) => {
      const label = `m${i + 1}`; // m1 / m2 / m3
      const eligible = cohort.filter((s) => (now - s.created_at) / DAY >= milestone);
      const survived = eligible.filter((s) => tenureDays(s, now) >= milestone);
      row[`${label}Eligible`] = eligible.length;
      row[`${label}Pct`] = eligible.length ? round1((survived.length / eligible.length) * 100) : null;
    });
    return row;
  });

  // --- Overall survival curve (% still active by days-since-signup) ---
  const retentionCurve = CURVE_DAY_MARKS.map((dayMark) => {
    if (dayMark === 0) return { dayMark, pctActive: 100, eligible: subs.length };
    const eligible = subs.filter((s) => (now - s.created_at) / DAY >= dayMark);
    const survived = eligible.filter((s) => tenureDays(s, now) >= dayMark);
    return {
      dayMark,
      pctActive: eligible.length ? round1((survived.length / eligible.length) * 100) : null,
      eligible: eligible.length,
    };
  });

  // --- Monthly flow: new signups vs cancellations vs net ---
  const flowKeys = trailingMonthKeys(now, TRAILING_MONTHS);
  const monthlyFlow = flowKeys.map((month) => {
    const start = monthStartUnix(month);
    const end = monthStartUnix(trailingMonthKeys(start + 40 * DAY, 1)[0]); // first of next month
    const newSignups = subs.filter((s) => s.created_at >= start && s.created_at < end).length;
    const cancellations = subs.filter((s) => s.ended_at && s.ended_at >= start && s.ended_at < end).length;
    return { month, newSignups, cancellations, net: newSignups - cancellations };
  });

  // --- Trailing-6-month averages (exclude the current partial month) ---
  const completeFlow = monthlyFlow.slice(0, -1).slice(-TRAILING_AVG_MONTHS);
  const avgNewSignups = completeFlow.length
    ? Math.round(completeFlow.reduce((s, m) => s + m.newSignups, 0) / completeFlow.length)
    : 0;
  const churnRates = completeFlow.map((m) => {
    const start = monthStartUnix(m.month);
    // Active at start of month = created before month start and not yet ended (or ended after start).
    const activeAtStart = subs.filter(
      (s) => s.created_at < start && (!s.ended_at || s.ended_at >= start)
    ).length;
    return activeAtStart ? (m.cancellations / activeAtStart) * 100 : null;
  }).filter((r) => r !== null);
  const avgChurnPct = churnRates.length
    ? round1(churnRates.reduce((s, r) => s + r, 0) / churnRates.length)
    : 0;

  return {
    snapshot,
    cohortRetention,
    retentionCurve,
    monthlyFlow,
    trailing6: { avgNewSignups, avgChurnPct },
  };
}

export async function fetchSubscriptionLifecycleData({ apiKey, now = Math.floor(Date.now() / 1000) }) {
  const subs = await fetchAllLiveSubscriptions(apiKey);
  return computeLifecycle(subs, now);
}
