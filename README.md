# SWP Performance Dashboard

Live: https://swp-dashboard-five.vercel.app/

Static dashboard (`index.html`) with data injected daily by
`scripts/dashboard-refresh/` via GitHub Actions (cron ~7:30 AM ET), plus two
on-demand Vercel serverless endpoints.

## On-page buttons

- **🔄 Refresh** — calls `/api/refresh`, which dispatches the GitHub Actions
  `dashboard-refresh.yml` workflow. The page then polls itself and reloads
  automatically when the new deploy lands (~2–4 min end to end). Guarded
  against double-triggers (409 if a run is in progress, 429 if one started
  under 3 minutes ago).
- **✨ Claude Summary** — calls `/api/summary`, which sends the page's own
  embedded numbers (per period: yesterday / 7 days / YTD) to the Claude API
  and returns a written recap: headline, what's working, what needs attention,
  suggested next actions. If `KIT_API_KEY` is set, recent Kit broadcasts are
  included so spikes can be attributed to specific email sends.
- **☀️/🌙 Theme** — light by default; choice persists in localStorage.

## Required Vercel environment variables

Set these in Vercel → Project → Settings → Environment Variables (Production):

| Variable | Needed for | Where to get it |
|---|---|---|
| `DASHBOARD_GITHUB_TOKEN` | 🔄 Refresh | GitHub → Settings → Developer settings → Fine-grained personal access tokens. Repository access: only `swp-dashboard`. Permissions: **Actions: Read and write**. |
| `ANTHROPIC_API_KEY` | ✨ Summary | console.anthropic.com → API Keys |
| `KIT_API_KEY` (optional) | ✨ Summary email correlation | Kit → Settings → Developer → V4 API Key |
| `SUMMARY_MODEL` (optional) | ✨ Summary | Defaults to `claude-sonnet-5` |

After adding variables, redeploy once (Vercel → Deployments → ⋯ → Redeploy)
so the functions pick them up. Until they're set, the buttons show a clear
error message and everything else keeps working.

## Daily refresh pipeline

GitHub Actions (`.github/workflows/dashboard-refresh.yml`) runs
`scripts/dashboard-refresh/index.mjs`: pulls yesterday from Fathom + SureCart,
upserts Airtable's Daily Product Stats, rebuilds period rollups from Airtable
(week/month/YTD are never re-pulled from source), injects into `index.html`,
sanity-checks, commits, pushes — Vercel redeploys automatically. Repo secrets:
`FATHOM_API_TOKEN`, `SURECART_API_KEY`, `AIRTABLE_API_KEY`.
