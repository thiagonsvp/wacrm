import { normalizePhone } from '@/lib/whatsapp/phone-utils';

interface UazapiIdentityMessage {
  fromMe?: boolean | string;
  from_me?: boolean | string;
  isFromMe?: boolean | string;
  owner?: string;
  chatid?: string;
  chatlid?: string;
  sender?: string;
  sender_pn?: string;
}

interface UazapiIdentityChat {
  owner?: string;
  chatid?: string;
  wa_chatid?: string;
  phone?: string;
  wa_phone?: string;
}

export interface UazapiIdentityPayload {
  owner?: string;
  message?: UazapiIdentityMessage;
  chat?: UazapiIdentityChat;
}

export interface UazapiChatIdentity {
  fromMe: boolean;
  /** Direct phone of the other party, when UAZAPI supplied one. */
  phone: string | null;
  /** Opaque WhatsApp linked-device id of the other party. */
  lid: string | null;
  ownerPhone: string | null;
}

function isTrue(value: boolean | string | undefined): boolean {
  return value === true || value === 'true' || value === '1';
}

function asLid(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized?.endsWith('@lid') ? normalized : null;
}

function asPhone(value: string | undefined): string | null {
  if (!value || asLid(value)) return null;
  const phone = normalizePhone(value.replace(/@.*/, ''));
  return phone || null;
}

function first<T>(values: Array<T | null>): T | null {
  return values.find((value): value is T => value !== null) ?? null;
}

/**
 * Normalize the inconsistent identities emitted by UAZAPI.
 *
 * For inbound messages, `sender_pn`/`chatid` identify the customer and
 * `sender` often carries their `@lid`. For messages sent from WhatsApp Web,
 * some UAZAPI builds incorrectly put the business number in `chatid`; the
 * actual customer is then available only as `message.chatlid`.
 */
export function parseUazapiChatIdentity(
  body: UazapiIdentityPayload
): UazapiChatIdentity {
  const msg = body.message ?? {};
  const chat = body.chat ?? {};
  const fromMe = [msg.fromMe, msg.from_me, msg.isFromMe].some(isTrue);
  const ownerPhone = first([
    asPhone(body.owner),
    asPhone(msg.owner),
    asPhone(chat.owner),
  ]);

  if (fromMe) {
    const directCandidates = [
      asPhone(msg.chatlid),
      asPhone(msg.chatid),
      asPhone(chat.chatid),
      asPhone(chat.wa_chatid),
      asPhone(chat.phone),
      asPhone(chat.wa_phone),
    ].filter((phone) => phone && phone !== ownerPhone);

    return {
      fromMe,
      phone: directCandidates[0] ?? null,
      // In the confirmed broken payload, this is the only field that
      // identifies the customer. `sender` and chat.wa_chatlid identify the
      // business itself and must not be used here.
      lid: asLid(msg.chatlid),
      ownerPhone,
    };
  }

  return {
    fromMe,
    phone: first([
      asPhone(msg.sender_pn),
      asPhone(msg.chatid),
      asPhone(chat.chatid),
      asPhone(chat.wa_chatid),
      asPhone(chat.phone),
      asPhone(chat.wa_phone),
    ]),
    lid: first([asLid(msg.sender), asLid(msg.chatlid), asLid(msg.chatid)]),
    ownerPhone,
  };
}
