# Left Hand Mastery: What to Paste

Only the `PASTE-...` files in this folder go into WordPress. Ignore `_dev/`.

| File | Paste into | First line says | Last line says | When |
|---|---|---|---|---|
| [PASTE-MONDAY-Oct12-static.txt](https://github.com/seanwilson75-piano/swp-dashboard/raw/claude/vibrant-clarke-7th5nf/sales-pages/left-hand-mastery/PASTE-MONDAY-Oct12-static.txt) | `/left-hand-mastery/`, Custom HTML block, HTML tab | `MONDAY OCT 12 STATIC VERSION` | `END BLOCK Z` | Live now (Mon Oct 12) |
| [PASTE-TUESDAY-Oct13-static.txt](https://github.com/seanwilson75-piano/swp-dashboard/raw/claude/vibrant-clarke-7th5nf/sales-pages/left-hand-mastery/PASTE-TUESDAY-Oct13-static.txt) | `/left-hand-mastery/`, same block, HTML tab | `TUESDAY OCT 13+ STATIC VERSION` | `END BLOCK Z` | After midnight ET, Oct 13. Stays from then on. |
| [PASTE-THANK-YOU-page.txt](https://github.com/seanwilson75-piano/swp-dashboard/raw/claude/vibrant-clarke-7th5nf/sales-pages/left-hand-mastery/PASTE-THANK-YOU-page.txt) | `/left-hand-mastery-thank-you/`, Custom HTML block, HTML tab | `THANK-YOU PAGE` | `END THANK-YOU PAGE` | Already installed. Only if it needs replacing. |

The links above open the **Raw** (plain text) view.

## How to paste (every time)

1. Open the file's **Raw** link. Press **Cmd+Shift+R** so you get the newest version.
2. Click the page, **Cmd+A**, **Cmd+C**.
3. In the Custom HTML block's **HTML** tab: **Cmd+A**, **Cmd+V**. Leave the CSS and JavaScript tabs empty.
4. Check the **first line** and the **last line** match the table.
5. **Only save if the preview on the right shows the page.** Blank preview = the paste is incomplete. Don't save.
6. Click **Update** in the box, then the page's blue **Update** (top right).
7. Check the live page in an incognito window.

Don't copy from the chat's file viewer: it can cut long files short.

## What each sales page version shows

| | Buttons | Price cards | Countdown |
|---|---|---|---|
| Monday | $47 | $24 crossed out · **$47 TODAY** · $67 | hidden |
| Tuesday+ | $67 | $24, $47 crossed out · **$67 TODAY** | hidden |

These versions have **no code**: the prices are written into the page. The checkout total comes from the coupon in the link (`?coupon=LHM-DAY2`, `?coupon=LHM-VIP-DAY2`, `?coupon=LHM-VIP20`), not from the page.

## Images

`wp-uploads/` holds the 7 images, already uploaded to the Media Library (`/wp-content/uploads/2026/10/`).

## `_dev/` (not for pasting)

- `left-hand-mastery-blocks.html`: working copy of the sales page (same as the Monday file).
- `lhm-page-scripts.php` / `lhm-page-scripts-for-code-snippets-NOT-INSTALLED.txt`: the Code Snippets script (adds the day's coupon, runs the countdown). Never got installed.
- `price-labels-source.js`: the date-switching label code. **It broke the live page when pasted in the HTML block. Don't paste it.**
- `preview.html`: local preview.

Open question for after the launch: why `<script>` tags in this site's Custom HTML block don't run. Until that's solved, use the static versions.
