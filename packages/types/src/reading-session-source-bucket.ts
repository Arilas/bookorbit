import type { ReadingSessionSource } from "./reading-session";

export const READING_SESSION_SOURCE_BUCKETS = ["bookorbit", "koreader", "kobo"] as const;
export type ReadingSessionSourceBucket = (typeof READING_SESSION_SOURCE_BUCKETS)[number];

export const READING_SESSION_SOURCE_BUCKET_LABELS: Record<ReadingSessionSourceBucket, string> = {
  bookorbit: "BookOrbit",
  koreader: "KOReader",
  kobo: "Kobo",
};

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

// web/manual are both native BookOrbit surfaces; null/unknown (and historical Kobo-as-web
// sessions that predate source tagging) collapse into the BookOrbit bucket by design.
export function toReadingSessionSourceBucket(source: ReadingSessionSource | null | undefined): ReadingSessionSourceBucket {
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
  if (bucket === "bookorbit" && appPasswordId != null && appPasswordLabel) {
    return {
      key: `app-password:${appPasswordId}`,
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
  return { bookorbit: 0, koreader: 0, kobo: 0 };
}
