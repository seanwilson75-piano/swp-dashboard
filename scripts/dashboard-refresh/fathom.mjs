// Direct Fathom Analytics API calls (https://api.usefathom.com/v1/aggregations),
// replacing the `fathom-analytics:get-aggregation` MCP tool used by the agent-driven
// skill. Same params/shape, called as plain HTTP instead of via an MCP round-trip.

import { FATHOM_SITE_ID, TRACKED_PATHNAMES } from "./config.mjs";

const API_BASE = "https://api.usefathom.com/v1/aggregations";

function buildEmptyEntry() {
  return { pageviews: 0, uniques: 0, avg_duration: 0, bounce_rate: 0 };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Fathom enforces both a concurrency cap (lower tiers: 5 in-flight) and a
// burst rate limit. Calls here are already sequential (see fetchFathomData),
// but a 429 can still happen on a tight loop — retry with backoff, honoring
// Retry-After if Fathom sends one, rather than failing the whole daily run.
async function callFathom(token, params, attempt = 1) {
  const url = new URL(API_BASE);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, value);
  }
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 429 && attempt <= 5) {
    const retryAfterHeader = Number(res.headers.get("retry-after"));
    const waitMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0 ? retryAfterHeader * 1000 : attempt * 1500;
    console.warn(`[fathom] 429 rate limited (attempt ${attempt}) — waiting ${waitMs}ms before retry`);
    await sleep(waitMs);
    return callFathom(token, params, attempt + 1);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Fathom API ${res.status} on ${url.pathname}?${url.searchParams}: ${body}`);
  }
  return res.json();
}

// Converts Fathom's row-per-pathname response into { "/path/": {pageviews,uniques,avg_duration,bounce_rate} },
// filling in zeroed entries for any tracked pathname with no traffic in the window.
function toPerPathnameMap(rows) {
  const map = {};
  for (const path of TRACKED_PATHNAMES) map[path] = buildEmptyEntry();
  for (const row of rows) {
    if (!map[row.pathname]) continue; // ignore untracked pages
    map[row.pathname] = {
      pageviews: Number(row.pageviews ?? 0),
      uniques: Number(row.uniques ?? 0),
      avg_duration: Number(row.avg_duration ?? 0),
      bounce_rate: Number(row.bounce_rate ?? 0),
    };
  }
  return map;
}

export async function fetchFathomData({ token, yesterday, sevenDaysAgo, fourteenDaysAgo, eightDaysAgo, ytdStart, timezone = "America/New_York" }) {
  const commonAggregates = "pageviews,uniques,visits,avg_duration,bounce_rate";

  // Sequential, not Promise.all: Fathom's API plan caps concurrent requests
  // (free/lower tiers allow 5 in flight) and this call set is 8+ wide once
  // spike attribution is included. A daily refresh has no latency requirement,
  // so there's no reason to risk a 429 for parallelism we don't need.
  const dailyRows = await callFathom(token, { entity: "pageview", entity_id: FATHOM_SITE_ID, aggregates: commonAggregates, date_from: yesterday, date_to: yesterday, field_grouping: "pathname", sort_by: "pageviews:desc", limit: 25, timezone });
  const weeklyRows = await callFathom(token, { entity: "pageview", entity_id: FATHOM_SITE_ID, aggregates: commonAggregates, date_from: sevenDaysAgo, date_to: yesterday, field_grouping: "pathname", sort_by: "pageviews:desc", limit: 25, timezone });
  const ytdRows = await callFathom(token, { entity: "pageview", entity_id: FATHOM_SITE_ID, aggregates: commonAggregates, date_from: ytdStart, date_to: yesterday, field_grouping: "pathname", sort_by: "pageviews:desc", limit: 25, timezone });
  const monthlyRows = await callFathom(token, { entity: "pageview", entity_id: FATHOM_SITE_ID, aggregates: "pageviews,uniques,visits", date_from: ytdStart, date_to: yesterday, date_grouping: "month", timezone });
  const priorWeekRows = await callFathom(token, { entity: "pageview", entity_id: FATHOM_SITE_ID, aggregates: commonAggregates, date_from: fourteenDaysAgo, date_to: eightDaysAgo, field_grouping: "pathname", sort_by: "pageviews:desc", limit: 25, timezone });
  const dailyTotals = await callFathom(token, { entity: "pageview", entity_id: FATHOM_SITE_ID, aggregates: commonAggregates, date_from: yesterday, date_to: yesterday, timezone });
  const weeklyTotals = await callFathom(token, { entity: "pageview", entity_id: FATHOM_SITE_ID, aggregates: commonAggregates, date_from: sevenDaysAgo, date_to: yesterday, timezone });
  const ytdTotals = await callFathom(token, { entity: "pageview", entity_id: FATHOM_SITE_ID, aggregates: commonAggregates, date_from: ytdStart, date_to: yesterday, timezone });

  const FATHOM_DAILY = toPerPathnameMap(dailyRows);
  const FATHOM_WEEKLY = toPerPathnameMap(weeklyRows);
  const FATHOM_YTD = toPerPathnameMap(ytdRows);
  const PREV_PERIOD = toPerPathnameMap(priorWeekRows);

  // Fathom does NOT return month-grouped rows in calendar order — sort before
  // mapping, or the dashboard's monthly chart/deltas and the "partial" flag
  // (which must land on the current month) come out scrambled.
  const monthKey = (row) => String(row.date ?? row.month ?? `${row.year}-${String(row.month_number).padStart(2, "0")}-01`);
  const MONTHLY = monthlyRows
    .slice()
    .sort((a, b) => monthKey(a).localeCompare(monthKey(b)))
    .map((row) => ({
      month: new Date(monthKey(row)).toLocaleString("en-US", { month: "short" }),
      pageviews: Number(row.pageviews ?? 0),
      uniques: Number(row.uniques ?? 0),
    }));
  if (MONTHLY.length) MONTHLY[MONTHLY.length - 1].partial = true;

  const SITE_TOTALS = {
    daily: dailyTotals[0] ?? buildEmptyEntry(),
    weekly: weeklyTotals[0] ?? buildEmptyEntry(),
    ytd: ytdTotals[0] ?? buildEmptyEntry(),
  };

  // Spike detection: any tracked page where weekly pageviews >= 2x prior-week pageviews.
  const spikingPages = TRACKED_PATHNAMES.filter((path) => {
    const weekly = FATHOM_WEEKLY[path]?.pageviews ?? 0;
    const prior = PREV_PERIOD[path]?.pageviews ?? 0;
    return prior > 0 && weekly >= prior * 2;
  });

  const SPIKE_REFERRERS = {};
  for (const path of spikingPages) {
    const rows = await callFathom(token, {
      entity: "pageview",
      entity_id: FATHOM_SITE_ID,
      aggregates: "pageviews",
      date_from: sevenDaysAgo,
      date_to: yesterday,
      field_grouping: "pathname,referrer_hostname,utm_source,utm_campaign",
      filters: JSON.stringify([{ property: "pathname", operator: "is", value: path }]),
      sort_by: "pageviews:desc",
      limit: 5,
      timezone,
    });
    SPIKE_REFERRERS[path] = rows.slice(0, 2).map((row) => {
      let source;
      if (row.utm_source && row.utm_campaign) source = `${row.utm_source}: ${row.utm_campaign}`;
      else if (row.referrer_hostname) source = row.referrer_hostname;
      else source = "direct/unknown";
      return { source, views: Number(row.pageviews ?? 0) };
    });
  }

  // Traffic-source attribution: top referrers/UTMs per tracked page, for
  // yesterday and for the 7-day window. This is what lets the on-page Claude
  // summary answer "I got 12 trial sales — what drove them?" with actual
  // source data instead of guesses.
  const fetchSources = async (dateFrom, dateTo) => {
    const rows = await callFathom(token, {
      entity: "pageview",
      entity_id: FATHOM_SITE_ID,
      aggregates: "pageviews",
      date_from: dateFrom,
      date_to: dateTo,
      field_grouping: "pathname,referrer_hostname,utm_source,utm_campaign",
      sort_by: "pageviews:desc",
      limit: 100,
      timezone,
    });
    const map = {};
    for (const row of rows) {
      if (!TRACKED_PATHNAMES.includes(row.pathname)) continue;
      let source;
      if (row.utm_source && row.utm_campaign) source = `${row.utm_source}: ${row.utm_campaign}`;
      else if (row.utm_source) source = row.utm_source;
      else if (row.referrer_hostname) source = row.referrer_hostname;
      else source = "direct/unknown";
      (map[row.pathname] ??= []).push({ source, views: Number(row.pageviews ?? 0) });
    }
    for (const key of Object.keys(map)) map[key] = map[key].slice(0, 5);
    return map;
  };
  const DAILY_SOURCES = await fetchSources(yesterday, yesterday);
  const WEEKLY_SOURCES = await fetchSources(sevenDaysAgo, yesterday);

  return { FATHOM_DAILY, FATHOM_WEEKLY, FATHOM_YTD, MONTHLY, SITE_TOTALS, PREV_PERIOD, SPIKE_REFERRERS, DAILY_SOURCES, WEEKLY_SOURCES };
}
