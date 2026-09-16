import { describe, expect, it } from 'vitest';
import {
  buildGoogleAdsWhatsAppMessage,
  generateGoogleAdsProtocol,
  parseGoogleAdsProtocol,
} from './protocol';

describe('Google Ads WhatsApp protocol', () => {
  it('generates an unambiguous five-character code', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateGoogleAdsProtocol()).toMatch(/^[A-Z2-9]{5}$/);
    }
  });

  it('adds and parses the protocol without exposing the click id', () => {
    const message = buildGoogleAdsWhatsAppMessage(
      'Olá! Quero mais informações.',
      'AB7K2'
    );
    expect(message).toBe('Olá! Quero mais informações.\n\nProtocolo: AB7K2');
    expect(parseGoogleAdsProtocol(message)).toBe('AB7K2');
  });

  it('does not mistake arbitrary five-letter words for protocols', () => {
    expect(parseGoogleAdsProtocol('Quero saber mais sobre preço')).toBeNull();
    expect(parseGoogleAdsProtocol('Protocolo: OI10I')).toBeNull();
  });
});
