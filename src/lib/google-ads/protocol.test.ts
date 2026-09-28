import { describe, expect, it } from 'vitest';
import {
  buildGoogleAdsProtocolAcquisition,
  buildGoogleAdsWhatsAppMessage,
  generateGoogleAdsProtocol,
  parseGoogleAdsProtocol,
} from './protocol';

describe('Google Ads WhatsApp protocol', () => {
  it('generates an unambiguous six-character code', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateGoogleAdsProtocol()).toMatch(/^[A-Z2-9]{6}$/);
    }
  });

  it('adds and parses the protocol without exposing the click id', () => {
    const message = buildGoogleAdsWhatsAppMessage(
      'Olá! Quero mais informações.',
      'AB7K2M'
    );
    expect(message).toBe('Olá! Quero mais informações.\n\nProtocolo: AB7K2M');
    expect(parseGoogleAdsProtocol(message)).toBe('AB7K2M');
  });

  it('still parses a protocol issued under the old five-character format', () => {
    // Redirects minted before the length bump remain resolvable for
    // MAX_AGE_DAYS, so old messages already in a lead's inbox must keep
    // parsing correctly during the rollout.
    expect(parseGoogleAdsProtocol('Protocolo: AB7K2')).toBe('AB7K2');
  });

  it('does not mistake arbitrary five- or six-letter words for protocols', () => {
    expect(parseGoogleAdsProtocol('Quero saber mais sobre preço')).toBeNull();
    expect(parseGoogleAdsProtocol('Protocolo: OI10I')).toBeNull();
  });

  it('classifies Google traffic without a click id as organic', () => {
    expect(
      buildGoogleAdsProtocolAcquisition('AB7K2', null, null, '7770317006')
    ).toEqual({
      source: null,
      sourceId: '7770317006',
      campaign: null,
      medium: null,
      term: null,
      content: null,
      gclid: null,
      clickIdType: null,
      protocol: 'AB7K2',
    });
  });

  it('attributes the lead to Google when a click id exists', () => {
    expect(
      buildGoogleAdsProtocolAcquisition(
        'AB7K2',
        'click-123',
        'gclid',
        '7770317006'
      )
    ).toMatchObject({
      source: 'Google',
      gclid: 'click-123',
      clickIdType: 'gclid',
      protocol: 'AB7K2',
    });
  });

  it('keeps the protocol code even without a campaign id, so an organic lead still traces to the click', () => {
    expect(
      buildGoogleAdsProtocolAcquisition('AB7K2', null, null, null)
    ).toMatchObject({ source: null, protocol: 'AB7K2' });
  });

  it('carries utm_campaign/medium/content/term through even without a click id', () => {
    expect(
      buildGoogleAdsProtocolAcquisition('AB7K2', null, null, null, {
        campaign: 'creative_fachadas',
        medium: 'cpc',
        content: 'fachada acm',
        term: 'letreiros',
      })
    ).toMatchObject({
      source: null,
      campaign: 'creative_fachadas',
      medium: 'cpc',
      content: 'fachada acm',
      term: 'letreiros',
    });
  });

  it('a Google click id always wins over a conflicting utm_source', () => {
    expect(
      buildGoogleAdsProtocolAcquisition('AB7K2', 'click-123', 'gclid', null, {
        source: 'facebook',
      })
    ).toMatchObject({ source: 'Google', gclid: 'click-123' });
  });

  it('falls back to utm_source for Facebook/Instagram when there is no click id', () => {
    expect(
      buildGoogleAdsProtocolAcquisition('AB7K2', null, null, null, {
        source: 'Facebook',
      })
    ).toMatchObject({ source: 'Facebook' });
    expect(
      buildGoogleAdsProtocolAcquisition('AB7K2', null, null, null, {
        source: 'instagram',
      })
    ).toMatchObject({ source: 'Instagram' });
  });
});
