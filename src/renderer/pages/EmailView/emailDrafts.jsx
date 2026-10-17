/**
 * emailDrafts contains small helpers for building prefilled reply and forward
 * compose content. The goal is to keep message-formatting rules out of the
 * main EmailView component so draft behavior is easier to test and adjust.
 */
function stripHtmlToText(value) {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

export function buildReplySubject(subject) {
  const trimmedSubject = (subject || '').trim()
  if (!trimmedSubject) return 'Re: (no subject)'
  return /^re:/i.test(trimmedSubject) ? trimmedSubject : `Re: ${trimmedSubject}`
}

export function buildReplyBody(email, isProbablyHtml) {
  const senderName = email?.fromName || 'Unknown Sender'
  const senderEmail = email?.fromEmail || ''
  const senderLine = senderEmail ? `${senderName} <${senderEmail}>` : senderName
  const sentAt = email?.date || email?.timeAgo || 'an earlier time'
  const sourceBody = (email?.body || email?.preview || '').replace(/\r\n/g, '\n')
  const plainTextBody = isProbablyHtml(sourceBody) ? stripHtmlToText(sourceBody) : sourceBody
  const quotedBody = plainTextBody
    .split('\n')
    .filter((line, index, lines) => line.trim() || (index > 0 && index < lines.length - 1))
    .map(line => `> ${line || ''}`)
    .join('\n')

  return [
    '',
    '',
    `On ${sentAt}, ${senderLine} wrote:`,
    quotedBody || '> ',
  ].join('\n')
}

export function buildForwardSubject(subject) {
  const trimmedSubject = (subject || '').trim()
  if (!trimmedSubject) return 'Fwd: (no subject)'
  return /^fwd:/i.test(trimmedSubject) ? trimmedSubject : `Fwd: ${trimmedSubject}`
}

export function buildForwardBody(email, isProbablyHtml) {
  const senderName = email?.fromName || 'Unknown Sender'
  const senderEmail = email?.fromEmail || ''
  const fromLine = senderEmail ? `${senderName} <${senderEmail}>` : senderName
  const sentAt = email?.date || email?.timeAgo || ''
  const subjectLine = email?.subject || '(No subject)'
  const sourceBody = (email?.body || email?.preview || '').replace(/\r\n/g, '\n')
  const plainTextBody = isProbablyHtml(sourceBody) ? stripHtmlToText(sourceBody) : sourceBody

  return [
    '',
    '',
    '---------- Forwarded message ---------',
    `From: ${fromLine}`,
    `Date: ${sentAt}`,
    `Subject: ${subjectLine}`,
    '',
    plainTextBody,
  ].join('\n')
}


function buildDraftPreview(body) {
  const firstLine = String(body || '')
    .split('\n')
    .map(line => line.trim())
    .find(Boolean)

  return firstLine || 'Draft saved with no message content yet.'
}

export function createLocalDraftFromCompose({
  id,
  form,
  accountEmail,
  scopeKey,
  attachmentsMeta,
}) {
  // Backend handoff:
  // this helper defines the frontend draft shape used by EmailView.
  // If provider-backed drafts are returned with these same keys
  // (`id`, `to`, `subject`, `body`, `preview`, `scopeKey`, `isDraft`),
  // the existing draft list and editor can reuse them directly.
  const normalisedTo = String(form?.to || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)

  return {
    id: id || `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    fromName: 'Draft',
    fromEmail: accountEmail || '',
    to: normalisedTo,
    subject: String(form?.subject || '').trim() || '(No subject)',
    preview: buildDraftPreview(form?.body),
    body: String(form?.body || ''),
    date: 'Draft',
    timeAgo: 'Draft',
    unread: false,
    starred: false,
    attachments: Array.isArray(attachmentsMeta) ? attachmentsMeta : [],
    isDraft: true,
    scopeKey: scopeKey || 'primary',
  }
}
