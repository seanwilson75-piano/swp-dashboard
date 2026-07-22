// Single source of truth for tracked pages and verified product/bump names.
// Mirrors SKILL.md (Scheduled/swp-performance-dashboard-refresh/SKILL.md v6.5) Step 1A and Step 1D.
// Keep this in sync with that doc if either changes — this file is what the
// automated script reads; SKILL.md is the human-readable explanation.

export const FATHOM_SITE_ID = "BCWEGICN";

export const TRACKED_PATHNAMES = [
  "/join-for-1-today/",
  "/join-membership-today/",
  "/standard-checkout-page/",
  "/premium-checkout-page/",
  "/annual-standard-checkout-page/",
  "/annual-premium-checkout-page/",
  "/4-week-beginner-sales-page/",
  "/27musicians/",
  "/april-focus-bundle-2026/",
  "/dans-signature-sounds/",
  "/break",
  "/drop-2-exercise-download-page/",
  "/hear-any-chord/",
  "/gospel-embell",
  "/scales-charts/",
  "/our-roadmap-offer/",
  "/major-vs-minor-quiz/",
  "/half-dim-locrian-arpeggio-download-page/",
  "/available-to-you/",
  "/new-1trial-registration-page/",
  "/27-bundle-waitlist/",
  "/9sus4-to-dominant-release/",
  "/half-dim-locrian-arpeggio-download-page/",
  // Bump accept/not-accept thank-you pages for the Half-Diminished Exercises
  // checkout — not a "product" page, but tracking both lets pageviews on
  // each serve as a proxy for bump offers-shown/acceptance-rate, which
  // SureCart's API doesn't expose anywhere (see surecart.mjs header comment).
  // Not wired into Airtable/byProductPeriod yet — Fathom traffic only for now.
  "/half-diminished-locrian-arpeggio-thank-you-page/", // bump NOT accepted
  "/half-diminished-locrian-bump-accept-thank-you-page/", // bump accepted
];

// Main products: Product Name (exact, must match SureCart) -> { type, slug }
export const PRODUCTS = {
  "Basic Membership — 7 Day $1 Trial": { type: "Subscription", slug: "/join-for-1-today/" },
  "Basic Membership": { type: "Subscription", slug: "/standard-checkout-page/" },
  "Premium Membership": { type: "Subscription", slug: "/premium-checkout-page/" },
  "Annual Standard Membership": { type: "Subscription", slug: "/annual-standard-checkout-page/" },
  "Annual Premium Membership": { type: "Subscription", slug: "/annual-premium-checkout-page/" },
  "Master Beginner Fundamentals in 4 Days": { type: "Product", slug: "/4-week-beginner-sales-page/" },
  "27 Musicians Pro Musicians Bundle Pack": { type: "Product", slug: "/27musicians/" },
  "April Focus Guide": { type: "Product", slug: "/april-focus-bundle-2026/" },
  "Dan's Signature Sounds": { type: "Product", slug: "/dans-signature-sounds/" },
  "Piano Blueprint Session": { type: "Coaching", slug: "/break" },
  "Mediant Drop 2 Exercise": { type: "Product", slug: "/drop-2-exercise-download-page/" },
  "Get the Half-Diminished Exercises": { type: "Product", slug: "/half-dim-locrian-arpeggio-download-page/" },
  "Hear Any Chord — Free Ear Training Chart": { type: "Lead Magnet", slug: "/hear-any-chord/" },
  "Roadmap Lead": { type: "Lead Magnet", slug: "/our-roadmap-offer/" },
  "Major vs Minor Quiz": { type: "Lead Magnet", slug: "/major-vs-minor-quiz/" },
  "Scales Charts": { type: "Lead Magnet", slug: "/scales-charts/" },
  "Get the Half-Diminished Exercises": { type: "Product", slug: "/half-dim-locrian-arpeggio-download-page/" }, // added 2026-06-25, $1
};

// Bumps: Bump Name (exact) -> parent product name.
// NOTE: "Master Beginner Fundamentals in 4 Days" is sold as both a standalone
// main product AND a $0 bump on Annual checkout pages — do NOT write a
// second "bump" record for it (would collide with the main-product
// Record ID upsert key `date|Product Name`). It stays a main-product record only.
export const BUMPS = {
  "Your First 30 Days: Member Practice Guide": "Basic Membership — 7 Day $1 Trial",
  "Beginner Practice Plan - for 4 Songs": "Master Beginner Fundamentals in 4 Days",
  "Play Like Them: MIDI File Bundle 🎹🔥": "Basic Membership", // also appears under Annual Standard
  "Travis Sayles Organ Runs – Custom MIDI Transcription": "27 Musicians Pro Musicians Bundle Pack",
  "27 Musicians Guided Study Session": "27 Musicians Pro Musicians Bundle Pack",
  "Dan's Signature Sounds - Logic Sessions Pack": "Dan's Signature Sounds",
  // Added 2026-06-25. Parent inferred from the bump-accept/not-accepted
  // thank-you-page pair being attached to the Half-Diminished Exercises
  // checkout flow — confirm with Sean if this is ever wrong.
  "Half-Diminished Arpeggio Companion Video(s)": "Get the Half-Diminished Exercises",
};

// SureCart bump line items are matched against this set by name. Per the
// 2026-06-22 decision: only Orders/Revenue are written for bumps. There is
// no API (REST or MCP) that exposes "offers shown" / "acceptance rate" —
// that lives only in SureCart's admin-rendered Bumps Report, not a public
// endpoint. Those two fields are intentionally NOT populated by this script.

export const AIRTABLE_BASE_ID = "appGGzkWDtvCU3wGk";
export const AIRTABLE_DAILY_PRODUCT_STATS_TABLE = "tblzeTGmTQJ6UOEJl";

// Subscription lifecycle snapshots — one row per day (active/churn/MRR),
// written by subscriptions.mjs. Enables trending active members + MRR over time.
export const AIRTABLE_SUBSCRIPTION_SNAPSHOTS_TABLE = "tblfjchLKKlwUTsXU";

// TWO MEMBERSHIP-REVENUE LENSES — do not "reconcile" them into one number:
//   1. Daily Product Stats membership revenue (~$10.7K/mo) = BOOKED order
//      revenue: what SureCart charged for membership products in a period.
//   2. subscriptions.mjs Active MRR (~$10.8K/mo, verified live 2026-07-22) =
//      the forward RUN-RATE of currently-active subscriptions (annual ÷12).
//   These agree to within ~1% — the ~$17.6K figure that once circulated was an
//   ad-hoc over-count (past_due/trialing at full value, or gross trial amounts)
//   and is NOT authoritative. Active MRR from subscriptions.mjs is the number
//   to trust for run-rate; Daily Product Stats stays the source for booked
//   period revenue. Different questions, both correct.

export const DAILY_PRODUCT_STATS_FIELDS = {
  recordId: "fldq5e23DGa8BpJFU",
  date: "fldpXLQ7f7YArQ2WS",
  productName: "fldElt29AlVrqt8kW",
  productType: "fldaDSMZxj0MH1L4v",
  parentProduct: "fldSiyrezf8Lafj2v",
  checkoutPageViews: "fldNXDrSKfS0OHDEw",
  checkoutUniques: "fldsb51VFNGWgdTIl",
  orders: "fld484kz8strCDJoY",
  revenue: "fld73O4I32t6EizEU",
  newSignups: "fldJDfygpRc6dKjy4",
  renewals: "fldQoPfOyrhXFAT2B",
  parentOrders: "fldDZmOLIgOm6H6tY",
  manyChatClicks: "fldccyzSz9rcoMPF3",
  manyChatKeyword: "fldlx2D6TU9wiJMFu",
  trafficSource: "fldcP97eyH8Pam5NH",
  notes: "fldYmd2ow7dzhxTB7",
};

export const SUBSCRIPTION_SNAPSHOT_FIELDS = {
  snapshotDate: "fldaDQ9p1P7lyHEN0",
  date: "fldoFa5zcREWFwwA6",
  active: "fldwvnKrLzgXwXadb",
  pastDue: "fldCBAZcJZWaeSD00",
  trialing: "fldwFZFS93V3hKQoc",
  canceled: "fldfRl88KbCoNFq9o",
  total: "fldxtPlzCoxVoT72R",
  activeMrr: "fldOPwoJYuJ83KZvQ",
  medianTenureDays: "fldEjHZibuLVB1hjT",
  avgNewSignupsT6: "fldHyzI5bdq1Y44o6",
  avgChurnPctT6: "fldrvSRVw57tUh4Eo",
};

// Subscription product types — used to compute Renewals = Orders - NewSignups
export const SUBSCRIPTION_PRODUCT_NAMES = Object.entries(PRODUCTS)
  .filter(([, p]) => p.type === "Subscription")
  .map(([name]) => name);
