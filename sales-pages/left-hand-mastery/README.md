# Left Hand Mastery: Sales Page

Live URL: https://seanwilsonpiano.com/left-hand-mastery/
Specs: Notion › Products & Offers DB › 🎹 Left Hand Mastery

| File | What it is |
|---|---|
| `left-hand-mastery-blocks.html` | **The page HTML + CSS.** Paste the whole file into one Custom HTML block (HTML tab only). |
| `lhm-page-scripts.php` | **The page JavaScript**, as a Code Snippets PHP snippet. Loads only on this page. |
| `lhm-page-scripts-PASTE-INTO-CODE-SNIPPETS.txt` | The same snippet without the opening `<?php` line. **This is the one to paste** into Code Snippets. Regenerate it whenever the .php changes: `tail -n +2 lhm-page-scripts.php > lhm-page-scripts-PASTE-INTO-CODE-SNIPPETS.txt`. |
| `thank-you-page.html` | The thank-you page. Paste into one Custom HTML block on `/left-hand-mastery-thank-you/`. |
| `wp-uploads/` | 7 images. Upload them to the Media Library **without renaming them**. |
| `preview.html` | Preview only (HTML + scripts combined). Never paste it into WordPress. |

## Why the JavaScript is separate

The Custom HTML block on this site shows `<script>` tags on the page but never runs them (the console showed `SWP_LHM loaded: false`).
Without the script, no coupon gets added and the checkout charges $67 while the page says $24.
Code Snippets prints the script straight into the page, and the coupon part runs in the page header, before SureCart starts.

## Install

1. **Page HTML:** copy `left-hand-mastery-blocks.html` (GitHub › Copy raw file), replace everything in the block's HTML tab, Update.
2. **Scripts:** Snippets › Add New. Keep the type on **Functions (PHP)**. Name it "Left Hand Mastery sales page scripts".
   Paste `lhm-page-scripts-PASTE-INTO-CODE-SNIPPETS.txt`. Set it to **Only run on site front-end**, then **Save Changes and Activate**.
3. **Check in an incognito window:** the countdown under the first button should be ticking, and the address bar should show `?coupon=LHM-DAY1`
   (before Sunday) or `LHM-DAY2` (Monday).
4. **Images:** Media › Add New, drag in all 7 files from `wp-uploads/`. Upload them in October so they land in `/wp-content/uploads/2026/10/`.
5. **Caching or speed plugin:** if it has "Delay JavaScript", exclude this page, or the coupon won't be in place before SureCart loads.

## How pricing works

The SureCart product is **$67**. Launch prices come from coupons, and the page applies them for the buyer:

| When (ET) | Page shows | Coupon added to the URL |
|---|---|---|
| Through Sun Oct 11, 11:59 pm | $24 | `LHM-DAY1` |
| Mon Oct 12 | $47 | `LHM-DAY2` |
| Oct 13 on | $67, launch ladder and countdown hidden | none |

- SureCart reads `?coupon=` from the page URL. The header script in `lhm-page-scripts.php` puts the right code there.
- A link carrying an old launch code (a Sunday email clicked on Monday) gets switched to that day's code.
- **Any other code is left alone.** VIP links like `/left-hand-mastery/?coupon=LHM-VIP-DAY2` and `?coupon=LHM-VIP20` work as is.
- Coupon codes, prices, and dates are all in `TIERS` and `PRICES` at the top of `lhm-page-scripts.php`. **The codes must match SureCart exactly.**

**Test any day before it happens:** add `?swp_now=2026-10-12T09:00:00-04:00` to the URL. This only changes what the page shows. SureCart still checks the coupon's real start and end dates.

## Coupon test links (confirmed codes)

| Test | Link | Checkout total |
|---|---|---|
| Sunday (everyone) | `/left-hand-mastery/?coupon=LHM-DAY1` | $24.00 |
| Monday (public) | `/left-hand-mastery/?coupon=LHM-DAY2` | $47.00 |
| Monday (VIP) | `/left-hand-mastery/?coupon=LHM-VIP-DAY2` | $37.60 |
| After Monday (VIP) | `/left-hand-mastery/?coupon=LHM-VIP20` | $53.60 |
| No coupon | `/left-hand-mastery/` | script adds that day's code: $24 Sun, $47 Mon, $67 after |

VIP links keep their code. The page still shows the public price for that day (for example $47 on Monday) while the checkout shows the lower VIP total.

## Tracking

Every buy button sends a Fathom event: `LHM buy click: hero`, `value`, `final`, or `sticky`. These show up under Fathom › Events, so you can see which button sells.
