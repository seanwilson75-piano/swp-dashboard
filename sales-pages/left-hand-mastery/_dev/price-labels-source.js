/* Readable source of the PRICE LABELS code in left-hand-mastery-blocks.html (base64 in the onload attribute). Edit here, then re-encode. */
(function () {
  if (window.SWP_LHM_LABELS) return;
  window.SWP_LHM_LABELS = true;

  /* Same dates as the coupon script: each day ends at midnight Eastern. */
  var TIERS = [
    { id: 1, price: 24, endsAt: '2026-10-12T00:00:00-04:00' },
    { id: 2, price: 47, endsAt: '2026-10-13T00:00:00-04:00' },
    { id: 3, price: 67, endsAt: null }
  ];
  var REGULAR = 67;
  var CARD = { tier1: 24, tier2: 47, tier3: 67, regular: 67 };

  function money(n) { n = Math.round(n * 100) / 100; return '$' + (n % 1 ? n.toFixed(2) : String(n)); }

  function now() {
    var o = null;
    try { o = new URLSearchParams(window.location.search).get('swp_now'); } catch (e) {}
    var t = o ? Date.parse(o) : NaN;
    if (isNaN(t)) return Date.now();
    if (window.SWP_LHM_LABEL_OFFSET === undefined) window.SWP_LHM_LABEL_OFFSET = t - Date.now();
    return Date.now() + window.SWP_LHM_LABEL_OFFSET;
  }

  function tierIndex(t) {
    for (var i = 0; i < TIERS.length; i++) {
      if (!TIERS[i].endsAt || t < Date.parse(TIERS[i].endsAt)) return i;
    }
    return TIERS.length - 1;
  }

  function coupon() {
    try { return (new URLSearchParams(window.location.search).get('coupon') || '').toUpperCase(); } catch (e) { return ''; }
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function remaining(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return (d > 0 ? d + 'd ' : '') + pad(h) + 'h ' + pad(m) + 'm ' + pad(s % 60) + 's';
  }

  function each(sel, fn) { var n = document.querySelectorAll(sel); for (var i = 0; i < n.length; i++) fn(n[i]); }

  function refresh() {
    var t = now(), idx = tierIndex(t), tier = TIERS[idx], next = TIERS[idx + 1] || null;

    /* Today's price for this visitor. VIP links show their own total. */
    var c = coupon(), price = tier.price;
    if (c === 'LHM-VIP-DAY2' && tier.id <= 2) price = 37.6;
    if (c === 'LHM-VIP20') price = 53.6;

    /* If the Code Snippets script is also running, keep it writing the same numbers. */
    if (window.SWP_LHM && window.SWP_LHM.TIERS && window.SWP_LHM.TIERS[idx]) window.SWP_LHM.TIERS[idx].price = money(price);

    each('[data-swp-price]', function (el) {
      var key = el.getAttribute('data-swp-price');
      var v = null;
      if (!key) v = money(price);
      else if (key === 'next') v = money(next ? next.price : price);
      else if (key === 'save') v = money(REGULAR - price);
      else if (CARD[key] !== undefined) v = money(CARD[key]);
      if (v !== null && el.textContent !== v) el.textContent = v;
    });

    /* Price cards: past days crossed out, today highlighted, future days unchanged. */
    each('[data-swp-tier]', function (el) {
      var id = Number(el.getAttribute('data-swp-tier'));
      el.classList.toggle('is-current', id === tier.id);
      el.classList.toggle('is-past', id < tier.id);
    });

    each('[data-swp-show-tier]', function (el) { el.hidden = Number(el.getAttribute('data-swp-show-tier')) !== tier.id; });
    each('[data-swp-launch-only]', function (el) { el.hidden = !tier.endsAt; });

    each('[data-swp-countdown]', function (el) {
      if (!next || !tier.endsAt) { el.hidden = true; return; }
      el.hidden = false;
      var te = el.querySelector('[data-swp-countdown-time]');
      if (te) te.textContent = remaining(Date.parse(tier.endsAt) - t);
    });
  }

  refresh();
  setInterval(refresh, 1000);
})();
