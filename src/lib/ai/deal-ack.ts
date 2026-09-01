// ------------------------------------------------------------
// Messages that can never move a deal.
//
// The classifier prompt (deal-signal.ts) tells the model that a bare
// acknowledgement — "ok", "certo", "obrigado", a thumbs-up — or a
// greeting with nothing else never changes the state of a sale. Every
// such inbound still bought a full provider call (~2k prompt tokens) to
// have the model confirm the board should stay where it is: measured on
// this deployment's own log, one classification in five was triggered
// by a message on this list. Recognising them in code skips the call
// outright; the next substantive message still gets classified.
//
// Deliberately narrow. "sim", "não", "quero", "fechado", "pode ser" are
// NOT here — each can be the customer's answer to a quote or an offer,
// which the model must read in context.
// ------------------------------------------------------------

/**
 * Words that, alone or combined with each other, make up a message that
 * carries no sales signal. Compared after `normalizeForAck`, so accents,
 * case, punctuation and emoji never matter.
 */
const ACK_WORDS = new Set([
  // acknowledgements
  'ok', 'okay', 'okk', 'oks', 'certo', 'entendi', 'entendido', 'isso',
  'beleza', 'blz', 'show', 'top', 'perfeito', 'joia', 'otimo', 'maravilha',
  'legal', 'bacana', 'ta', 'tabom', 'bom', 'boa', 'tudo', 'bem', 'vou', 'ver',
  // thanks
  'obrigado', 'obrigada', 'obg', 'vlw', 'valeu', 'brigado', 'brigada',
  'agradeco', 'grato', 'grata', 'de', 'nada', 'por', 'favor',
  // greetings / sign-offs
  'oi', 'oii', 'oie', 'ola', 'eai', 'opa', 'dia', 'tarde', 'noite', 'ate',
  'mais', 'logo', 'tchau', 'abraco', 'abracos', 'abs', 'fica', 'com', 'deus',
  // waiting
  'aguardo', 'aguardando', 'aguardar', 'espero',
])

/**
 * Lower-case, strip diacritics, drop everything that is not a letter,
 * digit or space (punctuation, emoji, symbols), collapse whitespace.
 */
export function normalizeForAck(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * True when the message is a pure acknowledgement, greeting or
 * emoji/punctuation-only nudge — i.e. the classifier would, by its own
 * rules, report the same state it already reported.
 *
 * Digits are never an ack: "128", "14", "4200" are the customer naming a
 * capacity, a model or accepting a price.
 */
export function isAcknowledgement(text: string | null | undefined): boolean {
  if (text == null) return false
  const norm = normalizeForAck(text)
  // Emoji-only ("👍", "❤️"), "?", "..." — nothing left once symbols go.
  // An originally-empty message is not an ack: there is nothing to skip.
  if (!norm) return text.trim().length > 0
  const words = norm.split(' ')
  return words.every((w) => ACK_WORDS.has(w))
}
