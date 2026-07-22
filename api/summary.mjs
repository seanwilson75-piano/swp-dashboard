// Vercel serverless function: generates a Claude-written performance summary
// for a chosen period (daily / weekly / ytd) from the dashboard's own data.
// The browser sends the already-embedded dashboard numbers, so this function
// makes no Fathom/SureCart/Airtable calls of its own.
//
// Required Vercel env var:
//   ANTHROPIC_API_KEY — Claude API key (console.anthropic.com).
// Optional:
//   SUMMARY_MODEL — override the Claude model (default claude-sonnet-5).
//   KIT_API_KEY   — Kit (ConvertKit) v4 API key. If set, recent email
//     broadcasts are included so the summary can correlate sends with
//     traffic/sales spikes ("what did I do that worked").

const DEFAULT_MODEL = "claude-sonnet-5";
const MAX_PAYLOAD_BYTES = 200_000;

async function fetchKitBroadcasts(apiKey) {
  try {
    const res = await fetch("https://api.kit.com/v4/broadcasts?per_page=50", {
      headers: { "X-Kit-Api-Key": apiKey },
    });
    if (!res.ok) return null;
    const { broadcasts = [] } = await res.json();
    const cutoff = Date.now() - 45 * 24 * 3600 * 1000;
    return broadcasts
      .filter((b) => b.send_at && new Date(b.send_at).getTime() > cutoff && new Date(b.send_at) <= new Date())
      .map((b) => ({ subject: b.subject, sent: b.send_at.slice(0, 10) }));
  } catch {
    return null; // Kit is a nice-to-have — never fail the summary over it
  }
}

const PERIOD_LABELS = { daily: "yesterday", weekly: "the last 7 days", ytd: "the year to date" };

function buildPrompt(period, data, broadcasts) {
  return `You are the performance analyst for Sean Wilson Piano LLC, an online piano-education business (memberships, courses, digital products) sold via SureCart with traffic tracked in Fathom Analytics.

Below is the dashboard data for ${PERIOD_LABELS[period] ?? period} (${data.dateRange ?? ""}). Revenue figures are in US dollars. "conv" is checkout conversion (orders ÷ page uniques). If present, "trafficSources" maps each page's path to its top referrers/UTM sources for the period — use it to say WHERE buyers came from (email, Instagram, ManyChat, Google, direct), which is the single most valuable thing you can tell Sean.

Sean's TWO priorities are (1) new member gains and (2) reducing churn in the MONTH 1–3 window. If a "retention" object is present, treat it as central, not a footnote:
- retention.snapshot: active/pastDue/trialing/canceled counts, activeMrrCents (÷100 for $), medianTenureDays (median days from signup to cancellation).
- retention.trailing6: avgNewSignups and avgChurnPct (average monthly, trailing 6 months).
- retention.cohortRetention: per signup-month, the % of that cohort still active at day 30 (m1Pct), 60 (m2Pct), 90 (m3Pct). null = cohort too young to measure yet. This is the month-1-to-3 picture — compare recent cohorts to older ones to say whether early retention is improving or worsening.
- retention.retentionCurve: % of all subscriptions still active by days since signup (dayMark 0/7/14/30/45/60/90) — the survival curve; the biggest drop usually sits at the day 7–14 trial-to-paid conversion.
- retention.monthlyFlow: newSignups vs cancellations vs net per month — whether the membership is net-growing.

<dashboard_data>
${JSON.stringify(data, null, 1)}
</dashboard_data>
${broadcasts?.length ? `
Recent email broadcasts sent from Kit (use these to explain traffic/sales spikes — an email send the day before a spike is almost always the cause):
<email_broadcasts>
${JSON.stringify(broadcasts, null, 1)}
</email_broadcasts>
` : ""}
Write a concise performance summary in markdown. Structure:

## The headline
One or two sentences: overall revenue + orders for the period and whether things look strong, normal, or soft.

## What's working
The top products/pages by revenue and by conversion, with numbers. If something clearly outperformed (vs prior-period data where provided), name it and — if email broadcasts are listed — say which send likely drove it, by subject line and date.

## What needs attention
Underperformers, drops vs prior period, failed payments, bumps/upsells with poor take rates. If retention data is present, this is where month-1-to-3 churn belongs: call out the current month-1/2/3 retention numbers, whether recent cohorts are holding better or worse than older ones, and where on the survival curve members are dropping off. Skip anything with too little traffic to judge.

## Do this next
2-4 specific, small actions grounded in the numbers above (e.g. "resend X to non-openers", "push traffic to Y, its conversion is strong but views are low"). When retention data is present, at least one action should target the month-1-to-3 window (e.g. an onboarding touch before the day-7→14 conversion cliff, or a win-back for the cohort bleeding hardest). No generic advice.

Rules: plain language, no filler, every claim tied to a number in the data. If data for something is missing or too thin, say so briefly rather than guessing. Total length under 400 words.`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured in Vercel project settings" });
  }

  const { period, data } = req.body ?? {};
  if (!period || !data || typeof data !== "object") {
    return res.status(400).json({ error: "Expected JSON body: { period, data }" });
  }
  if (JSON.stringify(data).length > MAX_PAYLOAD_BYTES) {
    return res.status(413).json({ error: "Payload too large" });
  }

  const broadcasts = process.env.KIT_API_KEY ? await fetchKitBroadcasts(process.env.KIT_API_KEY) : null;

  try {
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.SUMMARY_MODEL || DEFAULT_MODEL,
        // Sonnet 5 runs adaptive thinking by default, and max_tokens caps
        // thinking + text combined — a low ceiling gets fully consumed by
        // thinking, returning an empty answer. This is a bounded summarization
        // task that doesn't need extended reasoning, so thinking is disabled
        // and the ceiling is generous enough for the ~400-word recap.
        max_tokens: 2048,
        thinking: { type: "disabled" },
        messages: [{ role: "user", content: buildPrompt(period, data, broadcasts) }],
      }),
    });
    if (!claudeRes.ok) {
      const body = await claudeRes.text();
      return res.status(502).json({ error: `Claude API error (${claudeRes.status}): ${body.slice(0, 300)}` });
    }
    const result = await claudeRes.json();
    const summary = result.content?.filter((b) => b.type === "text").map((b) => b.text).join("\n") ?? "";
    return res.status(200).json({ ok: true, summary, usedBroadcasts: Boolean(broadcasts?.length) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
