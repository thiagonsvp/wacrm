/**
 * Generate the dependency-free browser snippet shown in Account Settings.
 *
 * `redirectBase` is the account's `/go/google-ads/{token}` link — the same
 * one used by direct-to-WhatsApp ad campaigns — passed only when "Campanhas
 * direto para WhatsApp" is configured. When present, a WhatsApp button on
 * the page is rewritten to go through it, so the real click id/utm values
 * are stored server-side behind a short "Protocolo: XXXXXX" and never
 * appear in the chat text. Without it there is nowhere server-side to keep
 * that data, so it falls back to tagging the pre-filled text directly —
 * still fully attributed, since the CRM strips that markup from the inbox
 * before display and parses it the same way either way.
 */
export function googleLeadTrackingSnippet(
  endpoint: string,
  redirectBase = ''
): string {
  if (!endpoint) return '';
  return `<script>
(function () {
  var ENDPOINT = ${JSON.stringify(endpoint)};
  var REDIRECT_BASE = ${JSON.stringify(redirectBase)};
  var STORAGE_KEY = 'wacrm_google_ads_attribution';
  var KEYS = ['gclid','gbraid','wbraid','campaignid','utm_source','utm_medium','utm_campaign','utm_id','utm_term','utm_content'];
  var query = new URLSearchParams(window.location.search);
  var saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch (_) {}
  KEYS.forEach(function (key) {
    var value = query.get(key);
    if (value) saved[key] = value;
  });
  if (!saved.landing_url) saved.landing_url = window.location.href;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch (_) {}

  function value(form, names, selector) {
    var data = new FormData(form);
    for (var i = 0; i < names.length; i++) {
      var found = data.get(names[i]);
      if (found) return String(found);
    }
    var input = selector ? form.querySelector(selector) : null;
    return input && input.value ? input.value : '';
  }

  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    var payload = Object.assign({}, saved, {
      name: value(form, ['name','nome'], '[autocomplete="name"]'),
      email: value(form, ['email'], 'input[type="email"]'),
      phone: value(form, ['phone','telefone','tel','whatsapp'], 'input[type="tel"]'),
      company: value(form, ['company','empresa'], '[autocomplete="organization"]')
    });
    if (!payload.phone) return;
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true
    }).catch(function () {});
  }, true);

  function decorateWhatsAppLinks() {
    var hasTracking = KEYS.some(function (key) { return saved[key]; });
    if (!hasTracking) return;
    document.querySelectorAll('a[href]').forEach(function (link) {
      try {
        var url = new URL(link.href, window.location.href);
        if (url.hostname !== 'wa.me' && url.hostname !== 'api.whatsapp.com' && url.hostname !== 'web.whatsapp.com') return;
        if (REDIRECT_BASE) {
          var redirect = new URL(REDIRECT_BASE);
          KEYS.forEach(function (key) { if (saved[key]) redirect.searchParams.set(key, saved[key]); });
          var currentText = url.searchParams.get('text');
          if (currentText) redirect.searchParams.set('text', currentText);
          link.href = redirect.toString();
          return;
        }
        // No WhatsApp-direct redirect configured yet — tag the pre-filled
        // text instead so attribution still reaches the CRM. The inbox
        // strips this markup before showing the message either way.
        var tracking = KEYS.filter(function (key) { return saved[key]; })
          .map(function (key) { return '[' + key + ':' + saved[key] + ']'; }).join('');
        var current = url.searchParams.get('text') || '';
        if (current.indexOf(tracking) === -1) url.searchParams.set('text', tracking + ' ' + current);
        link.href = url.toString();
      } catch (_) {}
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', decorateWhatsAppLinks);
  else decorateWhatsAppLinks();
})();
</script>`;
}
