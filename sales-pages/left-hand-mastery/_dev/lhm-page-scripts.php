<?php
/**
 * Left Hand Mastery: sales page scripts.
 *
 * Paste into Code Snippets as a PHP snippet, set it to "Only run on site front-end", and activate.
 * Loads only on the Left Hand Mastery sales page (page ID 1030387, slug left-hand-mastery).
 *
 * - Header script: prices, dates, coupon codes, and the coupon that's added to the URL
 *   before the SureCart checkout loads.
 * - Footer script: price ladder, countdown, sticky buy bar, smooth scroll, Fathom events.
 *
 * To change prices, dates or coupon codes, edit TIERS and PRICES in the header script below.
 */

function swp_lhm_is_sales_page() {
	return is_page( array( 1030387, 'left-hand-mastery' ) );
}

add_action( 'wp_head', function () {
	if ( ! swp_lhm_is_sales_page() ) {
		return;
	}
	echo <<<'SWP_LHM_HEAD'
<script>
/* ===== Shared config + coupon sync. Runs before the SureCart form loads. ===== */
(function () {
  'use strict';

  /* ---------- EDIT PRICES, DATES & COUPONS HERE ---------- */
  /* Each tier ends at midnight Eastern (EDT = -04:00 in October).            */
  /* coupon = the SureCart code for that day. It must match SureCart exactly. */
  var TIERS = [
    { id: 1, price: '$24', coupon: 'LHM-DAY1', endsAt: '2026-10-12T00:00:00-04:00' }, // Oct 11 (and before)
    { id: 2, price: '$47', coupon: 'LHM-DAY2', endsAt: '2026-10-13T00:00:00-04:00' }, // Oct 12
    { id: 3, price: '$67', coupon: null,       endsAt: null }                          // Oct 13 and after
  ];

  /* Fixed prices used in the value stack and elsewhere. */
  var PRICES = {
    'tier1': '$24',
    'tier2': '$47',
    'tier3': '$67',
    'regular': '$67',
    'save1': '$43',
    'save2': '$20',
    'rule-each': '$25',
    'rules': '$150',
    'charts': '$99',
    'song-each': '$24',
    'songs': '$72',
    'total': '$321'
  };

  /* Testing: add ?swp_now=2026-10-12T09:00:00-04:00 to the page URL. */
  var lastOverride = null;
  var offset = 0;

  function readOverride() {
    var fromUrl = null;
    try { fromUrl = new URLSearchParams(window.location.search).get('swp_now'); } catch (e) {}
    return window.SWP_LHM_NOW || fromUrl || null;
  }

  function now() {
    var override = readOverride();
    if (override !== lastOverride) {
      lastOverride = override;
      var t = override ? Date.parse(override) : NaN;
      offset = isNaN(t) ? 0 : t - Date.now();
    }
    return Date.now() + offset;
  }

  function tierIndex(t) {
    for (var i = 0; i < TIERS.length; i++) {
      if (!TIERS[i].endsAt || t < Date.parse(TIERS[i].endsAt)) return i;
    }
    return TIERS.length - 1;
  }

  /* SureCart reads ?coupon= from the page URL when the checkout loads.
     Put today's launch code in the URL. Swap out a launch code from an
     earlier day (an old email link). Leave any other code alone, so the
     VIP codes from the waitlist emails still work. */
  function syncCoupon(idx) {
    try {
      var url = new URL(window.location.href);
      var current = url.searchParams.get('coupon');
      var launchCodes = TIERS.map(function (x) { return (x.coupon || '').toUpperCase(); });
      if (current && launchCodes.indexOf(current.toUpperCase()) === -1) return;
      var want = TIERS[idx].coupon;
      if (want && current !== want) url.searchParams.set('coupon', want);
      else if (!want && current) url.searchParams.delete('coupon');
      else return;
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    } catch (e) {}
  }

  window.SWP_LHM = {
    TIERS: TIERS,
    PRICES: PRICES,
    now: now,
    tierIndex: tierIndex,
    syncCoupon: syncCoupon
  };

  syncCoupon(tierIndex(now()));
})();
</script>
SWP_LHM_HEAD;
}, 1 );

add_action( 'wp_footer', function () {
	if ( ! swp_lhm_is_sales_page() ) {
		return;
	}
	echo <<<'SWP_LHM_FOOT'
<script>
(function () {
  'use strict';

  /* Prices, dates and coupons live in Block 0. */
  var LHM = window.SWP_LHM;
  if (!LHM) return;
  var TIERS = LHM.TIERS;
  var PRICES = LHM.PRICES;
  var lastIdx = null;

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function formatRemaining(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var d = Math.floor(s / 86400);
    var h = Math.floor((s % 86400) / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    return (d > 0 ? d + 'd ' : '') + pad(h) + 'h ' + pad(m) + 'm ' + pad(sec) + 's';
  }

  function each(selector, fn) {
    var nodes = document.querySelectorAll(selector);
    for (var i = 0; i < nodes.length; i++) fn(nodes[i]);
  }

  function refresh() {
    var t = LHM.now();
    var idx = LHM.tierIndex(t);
    var tier = TIERS[idx];
    var next = TIERS[idx + 1] || null;
    var launchOver = !tier.endsAt;

    /* The day changed while the page was open: move the coupon too. */
    if (lastIdx !== null && idx !== lastIdx) LHM.syncCoupon(idx);
    lastIdx = idx;

    each('[data-swp-price]', function (el) {
      var key = el.getAttribute('data-swp-price');
      if (!key) el.textContent = tier.price;
      else if (key === 'next') el.textContent = next ? next.price : tier.price;
      else if (PRICES[key]) el.textContent = PRICES[key];
    });

    each('[data-swp-tier]', function (el) {
      var id = Number(el.getAttribute('data-swp-tier'));
      el.classList.toggle('is-current', id === tier.id);
      el.classList.toggle('is-past', id < tier.id);
    });

    each('[data-swp-show-tier]', function (el) {
      el.hidden = Number(el.getAttribute('data-swp-show-tier')) !== tier.id;
    });

    each('[data-swp-launch-only]', function (el) {
      el.hidden = launchOver;
    });

    each('[data-swp-countdown]', function (el) {
      if (!next || !tier.endsAt) { el.hidden = true; return; }
      el.hidden = false;
      var timeEl = el.querySelector('[data-swp-countdown-time]');
      if (timeEl) timeEl.textContent = formatRemaining(Date.parse(tier.endsAt) - t);
    });
  }

  /* Smooth scroll for every button that points at the checkout. */
  document.addEventListener('click', function (e) {
    var link = e.target.closest ? e.target.closest('a[href="#swp-lhm-checkout"]') : null;
    if (!link) return;

    /* Fathom: count clicks per button (hero, value, final, sticky). */
    try {
      if (window.fathom && typeof window.fathom.trackEvent === 'function') {
        window.fathom.trackEvent('LHM buy click: ' + (link.getAttribute('data-swp-cta') || 'other'));
      }
    } catch (err) {}

    var target = document.getElementById('swp-lhm-checkout');
    if (!target) return;
    e.preventDefault();
    var top = target.getBoundingClientRect().top + window.pageYOffset - 24;
    window.scrollTo({ top: top, behavior: 'smooth' });
  });

  /* Sticky bar: show it once the first button scrolls away. Hide it at the checkout. */
  var sticky = document.querySelector('[data-swp-sticky]');
  var firstCta = document.querySelector('#swp-lhm-b .swp-lhm-cta');
  var checkout = document.getElementById('swp-lhm-j');
  var ticking = false;

  function updateSticky() {
    ticking = false;
    if (!sticky || !firstCta || !checkout) return;
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var show = firstCta.getBoundingClientRect().bottom < 0 && checkout.getBoundingClientRect().top > vh;
    sticky.classList.toggle('is-visible', show);
    sticky.setAttribute('aria-hidden', show ? 'false' : 'true');
    var btn = sticky.querySelector('a');
    if (btn) btn.tabIndex = show ? 0 : -1;
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(updateSticky);
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);

  LHM.refresh = refresh;

  function start() { refresh(); updateSticky(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
  setInterval(refresh, 1000);
})();
</script>
SWP_LHM_FOOT;
}, 99 );
