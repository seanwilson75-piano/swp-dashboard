# Funnel Chains — Product/Bump Name Reconciliation (2026-06-07)

## What changed
Corrected mismatched product and bump names in the **Funnel Chains** Airtable table
(base: SWP Performance Data, table: `Funnel Chains`) so they match the live SureCart
catalog and verified order line items exactly. These names had drifted from sales-page
copy/headlines rather than the actual SureCart product/price records.

## Corrections made (old → new)

| Parent funnel | Field | Old (incorrect) | New (verified) |
|---|---|---|---|
| 4-Day Beginner Course | Bump 1 | Daily Workbook Guide for Beginner Course | Beginner Practice Plan - for 4 Songs |
| 4-Day Beginner Course | Bump 2 | Master Your Foundation in 4 Days | Master Beginner Fundamentals in 4 Days |
| $1 Trial Membership | Bump 1 | 30 Day Guided Practice Plan for Every Level | Your First 30 Days: Member Practice Guide |
| 27 MIDI File Bundle | Parent Product | 27 MIDI File Bundle | 27 Musicians Pro Musicians Bundle Pack |
| 27 MIDI File Bundle | Bump 1 | Travis Sayles Custom Organ Breakdown | Travis Sayles Organ Runs – Custom MIDI Transcription |
| Basic Monthly Membership | Bump | Play Like Them: MIDI File Bundle | Play Like Them: MIDI File Bundle 🎹🔥 (emoji is part of the canonical name) |

## How this was verified
Cross-checked against:
1. The full live SureCart product/price catalog (`surecart/list-products`, `surecart/list-prices`)
2. Actual paid order line items (`surecart/get-order`) — confirmed real checkout-display
   names and bump prices as charged to customers (e.g. "Beginner Practice Plan Guide"
   bump showing as $17 → $12 on live $27 Master Beginner Fundamentals orders)
3. Sean's direct confirmation of the corrected mappings

## Does the dashboard skill need updating?
No. The `swp-performance-dashboard` skill pulls product/order data live from SureCart
on every run — it does not hardcode any of these names. `Funnel Chains` is a separate
static reference table (used for bump/upsell mapping context, not by the dashboard
refresh itself). Tomorrow's run will reflect the corrected names automatically since
they now live in Airtable and SureCart is the live source of truth either way.

No code or skill changes were necessary — this was a data-correction task only.
