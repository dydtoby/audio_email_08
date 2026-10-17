/**
 * Utility functions for email processing and identification.
 */

export const COMPOSITE_LIST_ID_RE = /^(.+@.+)::(\d+)$/

export function parseMailboxFromListId(id) {
  if (id == null) return null
  const m = String(id).match(COMPOSITE_LIST_ID_RE)
  return m ? m[1] : null
}

export function parseUidTailFromListId(id) {
  if (id == null) return null
  const m = String(id).match(COMPOSITE_LIST_ID_RE)
  return m ? m[2] : null
}

export function imapUidForGmailListRow(email) {
  if (email?.uid != null && email.uid !== '') return email.uid
  const parsed = parseUidTailFromListId(email?.id)
  if (parsed != null) return parsed
  return email?.uid
}

/**
 * `from` string for text_extraction / `extractEmailFromHtml` payload.
 * When `fromName` is the same as `fromEmail`, avoid `addr <addr>`: the Python
 * `clean_person_value` strips angle brackets and the spoken prefix becomes
 * the mailbox twice (sounds like the duplicate reader-meta lines).
 */
export function buildFromFieldForTextExtraction(email) {
  if (!email || typeof email !== 'object') return ''
  const name = String(email.fromName || '').trim()
  const addr = String(email.fromEmail || '').trim()
  if (!addr && !name) return ''
  if (!addr) return name
  if (!name) return addr
  if (name.toLowerCase() === addr.toLowerCase()) return addr
  const inner = name.replace(/^<\s*|\s*>$/g, '').trim()
  if (inner.toLowerCase() === addr.toLowerCase()) return addr
  return `${name} <${addr}>`.trim()
}

export function getEmailRecordKey(email) {
  if (!email) return ''
  const mbRaw = (email.mailboxEmail && String(email.mailboxEmail).trim()) || parseMailboxFromListId(email.id)
  const mb = mbRaw ? String(mbRaw).trim().toLowerCase() : ''
  let uid = email.uid
  if (uid == null || uid === '') {
    const fromId = parseUidTailFromListId(email.id)
    if (fromId != null) uid = fromId
  }
  if (uid == null) uid = email.id
  if (mb) return `${mb}::${uid}`
  return String(uid ?? '')
}
export function isProbablyHtml(text) {
  if (!text) return false
  const trimmed = text.trim()
  return (
    trimmed.toLowerCase().includes('<html>') ||
    trimmed.toLowerCase().includes('<!doctype html>') ||
    (trimmed.startsWith('<') && trimmed.endsWith('>') && (trimmed.includes('<div') || trimmed.includes('<p') || trimmed.includes('<table')))
  )
}

export function formatDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
}

export function toSortTimestamp(value) {
  if (!value) return 0
  const t = new Date(value).getTime()
  return Number.isFinite(t) ? t : 0
}
