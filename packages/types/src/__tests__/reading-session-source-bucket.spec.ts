import { describe, expect, it } from "vitest";

import {
  READING_SESSION_SOURCE_BUCKETS,
  READING_SESSION_SOURCE_BUCKET_LABELS,
  emptySourceBucketRecord,
  toReadingSessionSourceBucket,
  toReadingSessionSourceDescriptor,
} from "../reading-session-source-bucket";

describe("toReadingSessionSourceBucket", () => {
  it("maps web to bookorbit", () => {
    expect(toReadingSessionSourceBucket("web")).toBe("bookorbit");
  });

  it("maps manual to bookorbit", () => {
    expect(toReadingSessionSourceBucket("manual")).toBe("bookorbit");
  });

  it("keeps iOS, Apple Watch and Android in distinct buckets", () => {
    expect(toReadingSessionSourceBucket("ios")).toBe("ios");
    expect(toReadingSessionSourceBucket("watchos")).toBe("watchos");
    expect(toReadingSessionSourceBucket("android")).toBe("android");
  });

  it("maps koreader to koreader", () => {
    expect(toReadingSessionSourceBucket("koreader")).toBe("koreader");
  });

  it("maps kobo to kobo", () => {
    expect(toReadingSessionSourceBucket("kobo")).toBe("kobo");
  });

  it("maps null/undefined to bookorbit", () => {
    expect(toReadingSessionSourceBucket(null)).toBe("bookorbit");
    expect(toReadingSessionSourceBucket(undefined)).toBe("bookorbit");
  });
});

describe("toReadingSessionSourceDescriptor", () => {
  it("uses a named App Password while preserving a native platform bucket", () => {
    expect(toReadingSessionSourceDescriptor("ios", 12, "iPhone app")).toEqual({
      key: "app-password:12:ios",
      label: "iPhone app",
      bucket: "ios",
      kind: "app_password",
      appPasswordId: 12,
    });
    expect(toReadingSessionSourceDescriptor("watchos", 13, "Watch app").bucket).toBe("watchos");
    expect(toReadingSessionSourceDescriptor("android", 14, "Android app").bucket).toBe("android");
  });

  it("keeps one App Password distinct across platform buckets", () => {
    expect(toReadingSessionSourceDescriptor("web", 12, "Reading app").key).toBe("app-password:12:bookorbit");
    expect(toReadingSessionSourceDescriptor("ios", 12, "Reading app").key).toBe("app-password:12:ios");
  });

  it("keeps KOReader and Kobo authoritative", () => {
    expect(toReadingSessionSourceDescriptor("koreader", 12, "Tablet")).toEqual({
      key: "koreader",
      label: "KOReader",
      bucket: "koreader",
      kind: "built_in",
      appPasswordId: null,
    });
    expect(toReadingSessionSourceDescriptor("kobo", 12, "Tablet").key).toBe("kobo");
  });

  it("falls back to the built-in source without a complete App Password identity", () => {
    expect(toReadingSessionSourceDescriptor("web", 12, null).key).toBe("bookorbit");
    expect(toReadingSessionSourceDescriptor("ios", null, "iPhone app").key).toBe("ios");
  });
});

describe("reading session source bucket constants", () => {
  it("exposes all six display buckets", () => {
    expect(READING_SESSION_SOURCE_BUCKETS).toEqual(["bookorbit", "ios", "watchos", "android", "koreader", "kobo"]);
  });

  it("labels every bucket", () => {
    expect(READING_SESSION_SOURCE_BUCKET_LABELS).toEqual({
      bookorbit: "BookOrbit",
      ios: "iOS app",
      watchos: "Apple Watch",
      android: "Android app",
      koreader: "KOReader",
      kobo: "Kobo",
    });
  });

  it("builds a zero-filled record", () => {
    expect(emptySourceBucketRecord()).toEqual({ bookorbit: 0, ios: 0, watchos: 0, android: 0, koreader: 0, kobo: 0 });
  });
});
