import { describe, expect, it } from 'vitest';
import {
  buildInboundMediaPath,
  expiredDayFolders,
  inboundMediaExtension,
  safeInboundContentType,
} from './inbound-media';

describe('safeInboundContentType', () => {
  it('keeps allow-listed media types, dropping parameters', () => {
    expect(safeInboundContentType('audio/ogg; codecs=opus')).toBe('audio/ogg');
    expect(safeInboundContentType('image/jpeg')).toBe('image/jpeg');
  });

  it('never stores a type the browser would render as a page', () => {
    for (const t of [
      'text/html',
      'image/svg+xml',
      'application/xhtml+xml',
      'application/xml',
      null,
    ]) {
      expect(safeInboundContentType(t)).toBe('application/octet-stream');
    }
  });
});

describe('inboundMediaExtension', () => {
  it('prefers the response MIME type, ignoring parameters', () => {
    expect(inboundMediaExtension('audio/ogg; codecs=opus', 'https://x/f')).toBe(
      'ogg'
    );
    expect(inboundMediaExtension('image/jpeg', 'https://x/f.png')).toBe('jpg');
  });

  it('falls back to the URL extension, then to bin', () => {
    expect(inboundMediaExtension(null, 'https://x/files/a.MOV?t=1')).toBe('mov');
    expect(
      inboundMediaExtension('application/octet-stream', 'https://x/files/a')
    ).toBe('bin');
    expect(inboundMediaExtension(null, 'not a url')).toBe('bin');
  });
});

describe('buildInboundMediaPath', () => {
  it('groups by account and UTC day', () => {
    expect(
      buildInboundMediaPath(
        'acc-1',
        'jpg',
        new Date('2026-10-05T23:30:00-03:00'),
        'uuid'
      )
    ).toBe('account-acc-1/2026-10-06/uuid.jpg');
  });
});

describe('expiredDayFolders', () => {
  const now = new Date('2026-10-05T12:00:00Z');

  it('keeps exactly the retention window and drops older days', () => {
    expect(
      expiredDayFolders(['2026-08-05', '2026-08-06', '2026-08-07'], now, 60)
    ).toEqual(['2026-08-05']);
  });

  it('ignores anything that is not a day folder', () => {
    expect(expiredDayFolders(['.emptyFolderPlaceholder', 'x'], now, 60)).toEqual(
      []
    );
  });
});
