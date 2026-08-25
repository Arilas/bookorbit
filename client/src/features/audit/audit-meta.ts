import { AuditAction, type AuditAppPasswordActor, type AuditLogEntry, type BookDeletionAuditBook, type BookDeletionAuditMeta } from '@bookorbit/types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isDeletionBook(value: unknown): value is BookDeletionAuditBook {
  return (
    isRecord(value) &&
    Number.isInteger(value.id) &&
    typeof value.id === 'number' &&
    value.id > 0 &&
    (typeof value.title === 'string' || value.title === null)
  )
}

export function getAuditAppPasswordActor(entry: AuditLogEntry): AuditAppPasswordActor | null {
  if (!isRecord(entry.meta) || !isRecord(entry.meta.actorAuth)) return null

  const { authMethod, appPasswordId, appPasswordLabel } = entry.meta.actorAuth
  if (
    authMethod !== 'app_password' ||
    typeof appPasswordId !== 'number' ||
    !Number.isSafeInteger(appPasswordId) ||
    appPasswordId <= 0 ||
    (typeof appPasswordLabel !== 'string' && appPasswordLabel !== null)
  ) {
    return null
  }

  return { authMethod, appPasswordId, appPasswordLabel }
}

export function getBookDeletionAuditMeta(entry: AuditLogEntry): BookDeletionAuditMeta | null {
  if (entry.action !== AuditAction.BookBulkDelete || !isRecord(entry.meta)) return null

  const { total, books, omitted } = entry.meta
  if (
    typeof total !== 'number' ||
    !Number.isInteger(total) ||
    total < 0 ||
    !Array.isArray(books) ||
    !books.every(isDeletionBook) ||
    typeof omitted !== 'number' ||
    !Number.isInteger(omitted) ||
    omitted < 0 ||
    books.length + omitted !== total
  ) {
    return null
  }

  return { total, books, omitted }
}
