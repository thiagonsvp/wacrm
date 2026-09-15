/** Generate the dependency-free browser snippet shown in Account Settings. */
export function googleLeadTrackingSnippet(endpoint: string): string {
  if (!endpoint) return '';
  return `<script>
(function () {
  var ENDPOINT = ${JSON.stringify(endpoint)};
  var STORAGE_KEY = 'wacrm_google_ads_attribution';
  var KEYS = ['gclid','gbraid','wbraid','utm_source','utm_medium','utm_campaign','utm_id','utm_term','utm_content'];
  var query = new URLSearchParams(window.location.search);
  var saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch (_) {}
  KEYS.forEach(function (key) {
    var value = query.get(key);
    if (value) saved[key] = value;
  });
  if (!saved.landing_url && (saved.gclid || saved.gbraid || saved.wbraid)) saved.landing_url = window.location.href;
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
    var tracking = KEYS.filter(function (key) { return saved[key]; })
      .map(function (key) { return '[' + key + ':' + saved[key] + ']'; }).join('');
    if (!tracking) return;
    document.querySelectorAll('a[href]').forEach(function (link) {
      try {
        var url = new URL(link.href, window.location.href);
        if (url.hostname !== 'wa.me' && url.hostname !== 'api.whatsapp.com' && url.hostname !== 'web.whatsapp.com') return;
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
