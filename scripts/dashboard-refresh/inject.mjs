// Replaces the [DASHBOARD-DATA-START]...[DASHBOARD-DATA-END] block in index.html.
// Never touches [FUNNEL-CHAINS-START]...[FUNNEL-CHAINS-END], which sits immediately
// after it and is only ever edited by the (separate, weekly, still-manual) Step 3B.
//
// Runs the same two mandatory checks the agent-driven skill required (Step 4.5 / 4.6)
// as plain assertions — throws instead of writing/committing on failure.

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const START_MARKER = "// [DASHBOARD-DATA-START]";
const END_MARKER = "// [DASHBOARD-DATA-END]";
const FUNNEL_START = "// [FUNNEL-CHAINS-START]";
const FUNNEL_END = "// [FUNNEL-CHAINS-END]";

const REQUIRED_CONSTS = [
  "FATHOM_DAILY",
  "FATHOM_WEEKLY",
  "FATHOM_YTD",
  "SITE_TOTALS",
  "MONTHLY",
  "PREV_PERIOD",
  "SPIKE_REFERRERS",
  "SC_PREV_30",
  "SC_DATA",
  "LAST_UPDATED",
];

function buildDataBlock(data) {
  const j = (v) => JSON.stringify(v, null, 2);
  return `${START_MARKER}
const FATHOM_DAILY = ${j(data.FATHOM_DAILY)};
const FATHOM_WEEKLY = ${j(data.FATHOM_WEEKLY)};
const FATHOM_YTD = ${j(data.FATHOM_YTD)};
const SITE_TOTALS = ${j(data.SITE_TOTALS)};
const MONTHLY = ${j(data.MONTHLY)};
const PREV_PERIOD = ${j(data.PREV_PERIOD)};
const SPIKE_REFERRERS = ${j(data.SPIKE_REFERRERS)};
const SC_PREV_30 = ${j(data.SC_PREV_30)};
const SC_DATA = ${j(data.SC_DATA)};
const LAST_UPDATED = ${j(data.LAST_UPDATED)};
${END_MARKER}`;
}

// `outputPath` defaults to `htmlPath` (the real file). Pass a different path
// (e.g. during --dry-run) to write the result somewhere else for review
// without touching the live file at all.
export function injectDashboardData(htmlPath, data, { outputPath, write = true } = {}) {
  const html = readFileSync(htmlPath, "utf8");

  const startIdx = html.indexOf(START_MARKER);
  const endIdx = html.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error("Could not find [DASHBOARD-DATA-START]/[DASHBOARD-DATA-END] markers in index.html");
  }
  const funnelStartIdx = html.indexOf(FUNNEL_START);
  const funnelEndIdx = html.indexOf(FUNNEL_END);
  if (funnelStartIdx === -1 || funnelEndIdx === -1) {
    throw new Error("FUNNEL_CHAINS markers missing before edit — refusing to touch the file");
  }
  const funnelBlockBefore = html.slice(funnelStartIdx, funnelEndIdx + FUNNEL_END.length);

  const before = html.slice(0, startIdx);
  const after = html.slice(endIdx + END_MARKER.length);
  const newHtml = before + buildDataBlock(data) + after;

  // Step 4.5 — structural sanity check (mandatory, do not skip)
  runSanityCheck(newHtml, funnelBlockBefore);

  if (write) {
    writeFileSync(outputPath ?? htmlPath, newHtml, "utf8");
  }
  return newHtml;
}

function runSanityCheck(html, funnelBlockBefore) {
  const missing = REQUIRED_CONSTS.filter((name) => !new RegExp(`^const ${name}\\b`, "m").test(html));
  if (missing.length) {
    throw new Error(`Step 4.5 FAILED: missing const declarations: ${missing.join(", ")}`);
  }
  // Match either hand-written object-literal style (`growth:`) or
  // JSON.stringify style (`"growth":`) — this script writes the latter.
  for (const key of ["byProductPeriod", "recentOrders", "lastFetched", "growth", "monthlyNewSignups"]) {
    if (!new RegExp(`["']?${key}["']?\\s*:`).test(html)) {
      throw new Error(`Step 4.5 FAILED: missing required key "${key}" in new data block`);
    }
  }
  if (!html.includes(funnelBlockBefore)) {
    throw new Error("Step 4.5 FAILED: FUNNEL_CHAINS block changed or went missing during edit");
  }

  // Syntax check: the data block alone must parse as valid JS.
  const block = html.split(START_MARKER)[1].split(END_MARKER)[0];
  try {
    new Function(block)();
  } catch (err) {
    throw new Error(`Step 4.5 FAILED: data block does not parse — ${err.message}`);
  }
}

// Step 4.6 — run-to-run anomaly check (mandatory, do not skip).
// Compares the NEW data against what's currently live on origin/main and
// throws if any previously-real value would be replaced with null/0/empty.
export function runAnomalyCheck(repoDir, newHtmlString) {
  const liveHtml = execSync("git show origin/main:index.html", { cwd: repoDir, encoding: "utf8" });

  const extract = (html) => {
    const block = html.split(START_MARKER)[1]?.split(END_MARKER)[0];
    if (!block) return null;
    const sandbox = {};
    new Function(
      "exports",
      block.replace(/^const /gm, "exports.") // crude but sufficient: capture each const onto exports
    )(sandbox);
    return sandbox;
  };

  const live = extract(liveHtml);
  const fresh = extract(newHtmlString);
  if (!live) return; // nothing to compare against (first-ever run) — nothing to flag

  const isEmpty = (v) => v === null || v === undefined || v === 0 || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);

  const checks = [
    ["SC_DATA.stats", live.SC_DATA?.stats, fresh.SC_DATA?.stats],
    ["SC_DATA.byProduct", live.SC_DATA?.byProduct, fresh.SC_DATA?.byProduct],
    ["SC_DATA.byProductPeriod.ytd", live.SC_DATA?.byProductPeriod?.ytd, fresh.SC_DATA?.byProductPeriod?.ytd],
    ["SC_DATA.recentOrders", live.SC_DATA?.recentOrders, fresh.SC_DATA?.recentOrders],
    ["SC_DATA.growth", live.SC_DATA?.growth, fresh.SC_DATA?.growth],
    ["PREV_PERIOD", live.PREV_PERIOD, fresh.PREV_PERIOD],
  ];

  const degraded = checks.filter(([, liveVal, freshVal]) => !isEmpty(liveVal) && isEmpty(freshVal));
  if (degraded.length) {
    throw new Error(`Step 4.6 FAILED (DEGRADED): ${degraded.map(([name]) => name).join(", ")} went from real values to null/0/empty`);
  }
}
