// ------------------------------------------------------------
// Campaign tracking carried inside the first message's text.
//
// Meta hands click-to-WhatsApp attribution to us structurally, in the
// webhook's `referral` / `externalAdReply` block. Google has no
// equivalent: a `gclid` lives in the query string of the advertiser's
// own site, and clicking a wa.me link there forwards NOTHING but the
// pre-filled text. So for Google the text is the only channel available,
// and the site has to put the id there deliberately.
//
// This parser is deliberately permissive about the shape, because the
// markup is produced by whatever the site's button template does and we
// do not control it. Both of these work:
//
//   [Home-Float][gclid:Cj0KCQ...] Olá! Gostaria de um orçamento.
//   Olá! Vim pelo site ?gclid=Cj0KCQ...&utm_campaign=institucional
//
// It never invents attribution: with no recognisable id or utm in the
// text it returns an empty object, and the lead stays organic.
// ------------------------------------------------------------

export interface TextAcquisition {
  /** Google Ads click id — the whole point of this module. */
  gclid?: string;
  clickIdType?: 'gclid' | 'gbraid' | 'wbraid';
  /** utm_campaign, used as the campaign name when Google is the source. */
  campaign?: string;
  /** Campaign id or external identifier when available */
  sourceId?: string;
  /** Derived platform, only when the text actually says so. */
  source?: 'Google' | 'Facebook' | 'Instagram';
  /** Never set by this parser — declared so the webhook's
   *  `protocolMatch?.acquisition ?? parseAcquisitionFromText(...)` union
   *  can read `.protocol` without a type-narrowing check. */
  protocol?: string;
}

/**
 * Click ids and utm values are URL-safe tokens. Bounding the length
 * stops a pasted essay from being stored as a "campaign", and excluding
 * the bracket/space characters keeps `[gclid:x] hello` from swallowing
 * the human part of the message.
 */
const TOKEN = '[A-Za-z0-9._~%+-]+';
const MAX_LEN = 512;

/** `[key:value]`, `[key=value]`, `key=value` and `key:value`. */
function matchParam(text: string, key: string): string | undefined {
  const patterns = [
    new RegExp(`\\[\\s*${key}\\s*[:=]\\s*(${TOKEN})\\s*\\]`, 'i'),
    new RegExp(`(?:^|[?&\\s])${key}\\s*[:=]\\s*(${TOKEN})`, 'i'),
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    const value = m?.[1];
    if (value && value.length <= MAX_LEN) return value;
  }
  return undefined;
}

/**
 * Pull campaign tracking out of an inbound message's text.
 *
 * Google Ads also issues `wbraid` / `gbraid` instead of `gclid` on
 * iOS app-to-web journeys; both are accepted and stored in the same
 * column, since they play the same role for offline conversion import.
 */
export function parseAcquisitionFromText(
  text: string | null | undefined
): TextAcquisition {
  if (!text) return {};

  const click = (['gclid', 'wbraid', 'gbraid'] as const)
    .map((type) => ({ type, value: matchParam(text, type) }))
    .find((candidate) => candidate.value);
  const gclid = click?.value;
  const campaign = matchParam(text, 'utm_campaign');
  const sourceId = matchParam(text, 'utm_id') || matchParam(text, 'source_id');
  const utmSource = matchParam(text, 'utm_source')?.toLowerCase();

  const out: TextAcquisition = {};
  if (gclid) {
    out.gclid = gclid;
    out.clickIdType = click?.type;
  }
  if (campaign) out.campaign = decodeURIComponent(campaign).replace(/\+/g, ' ');
  if (sourceId) out.sourceId = decodeURIComponent(sourceId);

  // A Google click id is required for paid Google attribution. A bare
  // utm_source=google is only a hint and remains organic because it cannot be
  // reconciled with Google Ads. Meta source hints keep their existing rule.
  if (gclid) out.source = 'Google';
  else if (utmSource === 'facebook') out.source = 'Facebook';
  else if (utmSource === 'instagram') out.source = 'Instagram';

  return out;
}
