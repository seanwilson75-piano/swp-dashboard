// Vercel serverless function: triggers the GitHub Actions "Dashboard Refresh"
// workflow (workflow_dispatch) so the dashboard can be refreshed on demand
// from the page itself, without waiting for the 7:30am cron.
//
// Required Vercel env var:
//   DASHBOARD_GITHUB_TOKEN — fine-grained GitHub PAT scoped to the
//     seanwilson75-piano/swp-dashboard repo with Actions: Read and write.
//
// Abuse guard: refuses if a run is already queued/in progress, or if the
// last run started less than 3 minutes ago — so a stray double-tap (or a
// stranger who finds the URL) can't burn Actions minutes.

const REPO = "seanwilson75-piano/swp-dashboard";
const WORKFLOW = "dashboard-refresh.yml";
const MIN_GAP_MS = 3 * 60 * 1000;

async function gh(token, path, init = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  return res;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }
  const token = process.env.DASHBOARD_GITHUB_TOKEN;
  if (!token) {
    return res.status(500).json({ error: "DASHBOARD_GITHUB_TOKEN is not configured in Vercel project settings" });
  }

  try {
    // Guard: is a refresh already running or very recent?
    const runsRes = await gh(token, `/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=1`);
    if (runsRes.ok) {
      const { workflow_runs: runs = [] } = await runsRes.json();
      const latest = runs[0];
      if (latest && (latest.status === "queued" || latest.status === "in_progress")) {
        return res.status(409).json({ error: "A refresh is already running", started_at: latest.run_started_at });
      }
      if (latest && Date.now() - new Date(latest.run_started_at).getTime() < MIN_GAP_MS) {
        return res.status(429).json({ error: "A refresh just finished — wait a couple of minutes before triggering another" });
      }
    }

    const dispatchRes = await gh(token, `/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: "POST",
      body: JSON.stringify({ ref: "main", inputs: {} }),
    });
    if (dispatchRes.status !== 204) {
      const body = await dispatchRes.text();
      return res.status(502).json({ error: `GitHub dispatch failed (${dispatchRes.status}): ${body.slice(0, 300)}` });
    }

    return res.status(200).json({
      ok: true,
      message: "Refresh workflow dispatched. Fresh data typically lands in 2–4 minutes.",
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
