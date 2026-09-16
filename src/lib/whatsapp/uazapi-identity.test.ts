import { describe, expect, it } from 'vitest';
import { parseUazapiChatIdentity } from './uazapi-identity';

describe('parseUazapiChatIdentity', () => {
  it('captures the customer phone and lid from an inbound message', () => {
    expect(
      parseUazapiChatIdentity({
        owner: '5521966021918',
        message: {
          fromMe: false,
          chatid: '5521981930313@s.whatsapp.net',
          sender: '40334205681690@lid',
          sender_pn: '5521981930313@s.whatsapp.net',
        },
      })
    ).toEqual({
      fromMe: false,
      phone: '5521981930313',
      lid: '40334205681690@lid',
      ownerPhone: '5521966021918',
    });
  });

  it('rejects the business phone and keeps the customer lid for fromMe', () => {
    expect(
      parseUazapiChatIdentity({
        owner: '5521966021918',
        message: {
          fromMe: true,
          owner: '5521966021918',
          chatid: '5521966021918@s.whatsapp.net',
          chatlid: '40334205681690@lid',
          sender: '5521966021918@s.whatsapp.net',
          sender_pn: '5521966021918@s.whatsapp.net',
        },
        chat: {
          phone: '5521966021918',
          wa_chatid: '5521966021918@s.whatsapp.net',
        },
      })
    ).toEqual({
      fromMe: true,
      phone: null,
      lid: '40334205681690@lid',
      ownerPhone: '5521966021918',
    });
  });

  it('uses a direct peer phone when a normal fromMe payload supplies it', () => {
    expect(
      parseUazapiChatIdentity({
        owner: '5511999990000',
        message: {
          fromMe: 'true',
          chatid: '5511888880000@s.whatsapp.net',
          sender: '5511999990000@s.whatsapp.net',
        },
      })
    ).toMatchObject({
      fromMe: true,
      phone: '5511888880000',
      ownerPhone: '5511999990000',
    });
  });
});
