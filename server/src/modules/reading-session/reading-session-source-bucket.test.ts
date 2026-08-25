import { describe, expect, it } from 'vitest';

import {
  READING_SESSION_SOURCE_BUCKETS,
  READING_SESSION_SOURCE_BUCKET_LABELS,
  emptySourceBucketRecord,
  toReadingSessionSourceBucket,
  toReadingSessionSourceDescriptor,
} from '@bookorbit/types';

describe('toReadingSessionSourceBucket', () => {
  it('maps native, integration, and missing sources to display buckets', () => {
    expect(toReadingSessionSourceBucket('web')).toBe('bookorbit');
    expect(toReadingSessionSourceBucket('manual')).toBe('bookorbit');
    expect(toReadingSessionSourceBucket('koreader')).toBe('koreader');
    expect(toReadingSessionSourceBucket('kobo')).toBe('kobo');
    expect(toReadingSessionSourceBucket(null)).toBe('bookorbit');
    expect(toReadingSessionSourceBucket(undefined)).toBe('bookorbit');
  });
});

describe('toReadingSessionSourceDescriptor', () => {
  it('describes built-in sources', () => {
    expect(toReadingSessionSourceDescriptor('koreader')).toEqual({
      key: 'koreader',
      label: 'KOReader',
      bucket: 'koreader',
      kind: 'built_in',
      appPasswordId: null,
    });
  });

  it('uses the App Password identity for native BookOrbit sessions', () => {
    expect(toReadingSessionSourceDescriptor('web', 42, 'iPhone app')).toEqual({
      key: 'app-password:42',
      label: 'iPhone app',
      bucket: 'bookorbit',
      kind: 'app_password',
      appPasswordId: 42,
    });
  });

  it('keeps explicit integration sources authoritative', () => {
    expect(toReadingSessionSourceDescriptor('kobo', 42, 'Spoofed Kobo')).toEqual({
      key: 'kobo',
      label: 'Kobo',
      bucket: 'kobo',
      kind: 'built_in',
      appPasswordId: null,
    });
  });

  it('falls back safely when a historical label cannot be resolved', () => {
    expect(toReadingSessionSourceDescriptor('manual', 42, null)).toEqual({
      key: 'bookorbit',
      label: 'BookOrbit',
      bucket: 'bookorbit',
      kind: 'built_in',
      appPasswordId: null,
    });
  });
});

describe('reading session source bucket constants', () => {
  it('defines and labels every bucket', () => {
    expect(READING_SESSION_SOURCE_BUCKETS).toEqual(['bookorbit', 'koreader', 'kobo']);
    expect(READING_SESSION_SOURCE_BUCKET_LABELS).toEqual({
      bookorbit: 'BookOrbit',
      koreader: 'KOReader',
      kobo: 'Kobo',
    });
    expect(emptySourceBucketRecord()).toEqual({ bookorbit: 0, koreader: 0, kobo: 0 });
  });
});
