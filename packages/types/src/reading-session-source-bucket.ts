import type { ReadingSessionSource } from "./reading-session";

export const READING_SESSION_SOURCE_BUCKETS = ["bookorbit", "ios", "watchos", "android", "koreader", "kobo"] as const;
export type ReadingSessionSourceBucket = (typeof READING_SESSION_SOURCE_BUCKETS)[number];

export const READING_SESSION_SOURCE_BUCKET_LABELS: Record<ReadingSessionSourceBucket, string> = {
  bookorbit: "BookOrbit",
  ios: "iOS app",
  watchos: "Apple Watch",
  android: "Android app",
  koreader: "KOReader",
  kobo: "Kobo",
};

// Web/manual and null/unknown history collapse into the general BookOrbit bucket.
// Native clients remain distinct so device attribution survives aggregation.
export interface ReadingSessionSourceDescriptor {
  key: string;
  label: string;
  bucket: ReadingSessionSourceBucket;
  kind: "built_in" | "app_password";
  appPasswordId: number | null;
}

export interface ReadingSessionSourceUsage extends ReadingSessionSourceDescriptor {
  readingSeconds: number;
}
export function toReadingSessionSourceBucket(source: ReadingSessionSource | null | undefined): ReadingSessionSourceBucket {
  if (source === "ios") return "ios";
  if (source === "watchos") return "watchos";
  if (source === "android") return "android";
  if (source === "koreader") return "koreader";
  if (source === "kobo") return "kobo";
  return "bookorbit";
}

export function toReadingSessionSourceDescriptor(
  source: ReadingSessionSource | null | undefined,
  appPasswordId?: number | null,
  appPasswordLabel?: string | null,
): ReadingSessionSourceDescriptor {
  const bucket = toReadingSessionSourceBucket(source);
  if (source !== "koreader" && source !== "kobo" && appPasswordId != null && appPasswordLabel) {
    return {
      key: `app-password:${appPasswordId}:${bucket}`,
      label: appPasswordLabel,
      bucket,
      kind: "app_password",
      appPasswordId,
    };
  }

  return {
    key: bucket,
    label: READING_SESSION_SOURCE_BUCKET_LABELS[bucket],
    bucket,
    kind: "built_in",
    appPasswordId: null,
  };
}

export function emptySourceBucketRecord(): Record<ReadingSessionSourceBucket, number> {
  return { bookorbit: 0, ios: 0, watchos: 0, android: 0, koreader: 0, kobo: 0 };
}
