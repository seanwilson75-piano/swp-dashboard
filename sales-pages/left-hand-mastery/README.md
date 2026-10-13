# Left Hand Mastery: What to Paste

Only the `PASTE-...` files in this folder go into WordPress. Ignore `_dev/`.

| File | Paste into | First line says | Last line says |
|---|---|---|---|
| [PASTE-FINAL-sales-page.txt](https://github.com/seanwilson75-piano/swp-dashboard/raw/claude/vibrant-clarke-7th5nf/sales-pages/left-hand-mastery/PASTE-FINAL-sales-page.txt) | `/left-hand-mastery/`, Custom HTML block, HTML tab | `FINAL VERSION (no code; price $67)` | `END OF PAGE` |
| [PASTE-THANK-YOU-page.txt](https://github.com/seanwilson75-piano/swp-dashboard/raw/claude/vibrant-clarke-7th5nf/sales-pages/left-hand-mastery/PASTE-THANK-YOU-page.txt) | `/left-hand-mastery-thank-you/`, Custom HTML block, HTML tab | `THANK-YOU PAGE` | `END THANK-YOU PAGE` |

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

## Final sales page

One price everywhere: **$67** (buttons, value card, checkout header). No launch dates, day prices, price cards, or countdown. No code.
The Monday and Tuesday launch versions are archived in `_dev/launch-archive/`.

## Images

`wp-uploads/` holds the 7 images, already uploaded to the Media Library (`/wp-content/uploads/2026/10/`).

## `_dev/` (not for pasting)

- `left-hand-mastery-blocks.html`: working copy of the sales page (same as the final file).
- `lhm-page-scripts.php` / `lhm-page-scripts-for-code-snippets-NOT-INSTALLED.txt`: a script written for the Code Snippets plugin, which is **not** on this site. Never installed; not needed for the final page.
- `price-labels-source.js`: the date-switching label code. **It broke the live page when pasted in the HTML block. Don't paste it.**
- `preview.html`: local preview.

Open question for after the launch: why `<script>` tags in this site's Custom HTML block don't run. The final page needs no code, so this only matters for future launches.
