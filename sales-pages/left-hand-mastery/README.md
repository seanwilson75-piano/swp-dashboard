# Left Hand Mastery: Sales Page

Live URL: https://seanwilsonpiano.com/left-hand-mastery/
Specs: Notion › Products & Offers DB › 🎹 Left Hand Mastery

| File | What it is |
|---|---|
| `left-hand-mastery-blocks.html` | **The file you paste into WordPress.** Blocks 0, A–J, and Z. Each block goes in its own Custom HTML block. |
| `wp-uploads/` | 7 images. Upload them to the Media Library **without renaming them**. |
| `preview.html` | Preview only, built from the blocks file. Shows the page with local images and a placeholder where the checkout goes. Never paste it into WordPress. |

## Install (about 15 minutes)

1. **Upload images.** Media › Add New, then drag in all 7 files from `wp-uploads/`.
   Upload them in October so they land in `/wp-content/uploads/2026/10/`. That's the path the HTML uses.
   After uploading, open one of them (`lhm-rule-1.webp`) and confirm the URL is
   `https://seanwilsonpiano.com/wp-content/uploads/2026/10/lhm-rule-1.webp`.
   If WordPress added `-1` to a name, fix that `src` in the HTML.
2. **Paste blocks in order:** 0 (styles + config, first) → A → B → C → D → E → F → G → H → I → J (checkout) → Z (script, last).
   Block 0 must be first. It sets the coupon before the SureCart form loads.
3. **Check the checkout renders** in Block J. If you see the raw `[sc_form id=1030412]` text instead, follow the 3-block split in the comment at the top of Block J.
4. **Caching or speed plugin:** if it has "Delay JavaScript" or "Defer inline JS", exclude this page (or the Block 0 script). If the Block 0 script gets delayed, the coupon won't be in place and the checkout shows the full $67.

## How pricing works

The SureCart product is **$67**. Launch prices come from coupons, and the page applies them for the buyer:

| When (ET) | Page shows | Coupon added to the URL |
|---|---|---|
| Through Sun Oct 11, 11:59 pm | $24 | `LHM-DAY1` |
| Mon Oct 12 | $47 | `LHM-DAY2` |
| Oct 13 on | $67, launch ladder and countdown hidden | none |

- SureCart reads `?coupon=` from the page URL. Block 0 puts the right code there.
- A link carrying an old launch code (a Sunday email clicked on Monday) gets switched to that day's code.
- **Any other code is left alone.** VIP links like `/left-hand-mastery/?coupon=LHM-VIP-DAY2` and `?coupon=LHM-VIP20` work as is.
- Coupon codes, prices, and dates are all at the top of the Block 0 `<script>`. **The codes must match SureCart exactly.** Notion lists `LHM-DAY1` / `LHM-DAY2` as "suggested", so confirm them.

**Test any day before it happens:** add `?swp_now=2026-10-12T09:00:00-04:00` to the URL. This only changes what the page shows. SureCart still checks the coupon's real start and end dates.

## Tracking

Every buy button sends a Fathom event: `LHM buy click: hero`, `value`, `final`, or `sticky`. These show up under Fathom › Events, so you can see which button sells.
