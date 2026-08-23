export const NotificationType = {
  ScanCompleted: "scan_completed",
  ScanFailed: "scan_failed",
  BooksUnavailable: "books_unavailable",
  BooksRestored: "books_restored",
  MetadataFetchCompleted: "metadata_fetch_completed",
  MetadataFetchFailed: "metadata_fetch_failed",
  BookDockReady: "book_dock_ready",
  BookDockFinalized: "book_dock_finalized",
  BookRequestSubmitted: "book_request_submitted",
  BookRequestApproved: "book_request_approved",
  BookRequestRejected: "book_request_rejected",
  BookRequestAvailable: "book_request_available",
  BookRequestNeedsReview: "book_request_needs_review",
  BookRequestNeedsRelease: "book_request_needs_release",
  BookRequestFailed: "book_request_failed",
  AuthorEnrichmentCompleted: "author_enrichment_completed",
  AuthorEnrichmentFailed: "author_enrichment_failed",
  EmailSent: "email_sent",
  EmailFailed: "email_failed",
  KoboSyncCompleted: "kobo_sync_completed",
  MigrationCompleted: "migration_completed",
  MigrationFailed: "migration_failed",
  FileWriteBackCompleted: "file_write_back_completed",
  FileWriteBackFailed: "file_write_back_failed",
  FileRenameCompleted: "file_rename_completed",
  FileRenameFailed: "file_rename_failed",
  BulkRenameCompleted: "bulk_rename_completed",
  BulkRenameFailed: "bulk_rename_failed",
  AchievementUnlocked: "achievement_unlocked",
} as const;

export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

export const NOTIFICATION_CATEGORIES = {
  scanning: [NotificationType.ScanCompleted, NotificationType.ScanFailed, NotificationType.BooksUnavailable, NotificationType.BooksRestored],
  metadata: [NotificationType.MetadataFetchCompleted, NotificationType.MetadataFetchFailed],
  bookDock: [NotificationType.BookDockReady, NotificationType.BookDockFinalized],
  bookRequests: [
    NotificationType.BookRequestSubmitted,
    NotificationType.BookRequestApproved,
    NotificationType.BookRequestRejected,
    NotificationType.BookRequestAvailable,
    NotificationType.BookRequestNeedsReview,
    NotificationType.BookRequestNeedsRelease,
    NotificationType.BookRequestFailed,
  ],
  authorEnrichment: [NotificationType.AuthorEnrichmentCompleted, NotificationType.AuthorEnrichmentFailed],
  email: [NotificationType.EmailSent, NotificationType.EmailFailed],
  koboSync: [NotificationType.KoboSyncCompleted],
  migration: [NotificationType.MigrationCompleted, NotificationType.MigrationFailed],
  fileWriteBack: [NotificationType.FileWriteBackCompleted, NotificationType.FileWriteBackFailed],
  fileRename: [NotificationType.FileRenameCompleted, NotificationType.FileRenameFailed],
  bulkRename: [NotificationType.BulkRenameCompleted, NotificationType.BulkRenameFailed],
  achievements: [NotificationType.AchievementUnlocked],
} as const;

export type NotificationCategory = keyof typeof NOTIFICATION_CATEGORIES;

export type NotificationPreferences = {
  [K in NotificationCategory]?: boolean;
};

export interface NotificationItem {
  id: number;
  type: NotificationType;
  title: string;
  message: string | null;
  actionUrl: string | null;
  meta: Record<string, unknown> | null;
  read: boolean;
  createdAt: string;
}

export interface NotificationPage {
  items: NotificationItem[];
  total: number;
}
