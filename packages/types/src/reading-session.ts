import type { ReadingSessionSourceDescriptor } from "./reading-session-source-bucket";

export const READING_SESSION_SOURCES = ["web", "koreader", "manual", "kobo"] as const;
export type ReadingSessionSource = (typeof READING_SESSION_SOURCES)[number];

export interface BookReadingSession {
  id: number;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  progressDelta: number | null;
  endProgress: number | null;
  format: string | null;
  source: ReadingSessionSource | null;
  sourceAttribution: ReadingSessionSourceDescriptor;
}

export interface BookReadingSourceSlice extends ReadingSessionSourceDescriptor {
  totalSeconds: number;
  totalSessions: number;
}

export interface BookReadingSessionStats {
  totalSessions: number;
  totalSeconds: number;
  avgDurationSeconds: number;
  firstSessionAt: string | null;
  lastSessionAt: string | null;
  dailySummary: { day: string; totalMinutes: number }[];
  paceProgressDelta: number;
  paceDurationSeconds: number;
  progressSummary: { day: string; endProgress: number }[];
  // endProgress of the most recently ended session that recorded one, or null when no
  // session has. Unlike every other field here it ignores the list filters, because it
  // feeds the book's progress ring rather than a summary of the filtered rows.
  latestEndProgress: number | null;
  // Reading time/sessions split by built-in source or named App Password.
  // Only sources with activity are included.
  bySource: BookReadingSourceSlice[];
}

export interface BookReadingSessionListResponse {
  items: BookReadingSession[];
  total: number;
  page: number;
  pageSize: number;
  stats: BookReadingSessionStats;
}
