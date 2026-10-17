/**
 * Gmail API draft CRUD helpers (create, list, get, update, delete, send).
 * Uses the authenticated googleapis client from auth/googleAuth.
 * Gmail API 草稿 CRUD 封装（创建/列表/读取/更新/删除/发送）。
 *
 * Gmail drafts API reference:
 *   https://developers.google.com/gmail/api/reference/rest/v1/users.drafts
 */

const { google } = require('googleapis');
const { getAuthenticatedClientForEmail, getLinkedGmailAccount } = require('../auth/googleAuth');

/** Encode a string as base64url (RFC 4648 §5). / 将字符串编码为 base64url。 */
function toBase64Url(text) {
  return Buffer.from(text, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Escape quotes used when building RFC 2822 display-name "Name" <email> syntax. */
function escapeQuoted(value) {
  return String(value || '').replace(/"/g, '\\"');
}

/** Normalise `to` into an array of trimmed strings. */
function normaliseRecipientList(to) {
  if (!to) return [];
  if (Array.isArray(to)) {
    return to
      .map(value => String(value || '').trim())
      .filter(Boolean);
  }
  return String(to)
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
}

/**
 * Build a minimal RFC 2822 message suitable for Gmail drafts.create/update.
 * 构造最小的 RFC 2822 邮件文本，用于 Gmail 的 drafts.create / drafts.update。
 *
 * @param {object} params
 * @param {string|string[]} [params.to]
 * @param {string|string[]} [params.cc]
 * @param {string|string[]} [params.bcc]
 * @param {string}          [params.from]
 * @param {string}          [params.subject]
 * @param {string}          [params.body]      - plain-text body
 * @returns {string} raw RFC 2822 message
 */
function buildRfc2822Message({ to, cc, bcc, from, subject, body }) {
  const headers = [];
  if (from) headers.push(`From: ${from}`);
  const toList = normaliseRecipientList(to);
  if (toList.length) headers.push(`To: ${toList.join(', ')}`);
  const ccList = normaliseRecipientList(cc);
  if (ccList.length) headers.push(`Cc: ${ccList.join(', ')}`);
  const bccList = normaliseRecipientList(bcc);
  if (bccList.length) headers.push(`Bcc: ${bccList.join(', ')}`);
  headers.push(`Subject: ${subject || ''}`);
  headers.push('MIME-Version: 1.0');
  headers.push('Content-Type: text/plain; charset="UTF-8"');
  headers.push('Content-Transfer-Encoding: 7bit');

  return `${headers.join('\r\n')}\r\n\r\n${body || ''}`;
}

/** Build an authenticated gmail client for a linked Google address. */
function getGmailClient(accountEmail) {
  if (!accountEmail || !String(accountEmail).trim()) {
    throw new Error('accountEmail is required for Gmail API drafts.');
  }
  const authClient = getAuthenticatedClientForEmail(accountEmail);
  if (!authClient) {
    throw new Error('No authenticated Google client for this account. Please login with Google first.');
  }
  return google.gmail({ version: 'v1', auth: authClient });
}

/**
 * Parse a Gmail API draft into the shape the renderer already uses for drafts.
 * 把 Gmail API 的 draft 规范化为渲染进程已有的草稿数据结构。
 *
 * @param {object} draft - the response of drafts.get or items from drafts.list (with format=metadata)
 * @returns {{id:string, remoteMessageId:string|null, to:string[], subject:string, body:string, preview:string, date:string|null}}
 */
function normaliseGmailDraft(draft) {
  const message = draft?.message || {};
  const headers = Array.isArray(message.payload?.headers) ? message.payload.headers : [];

  const getHeader = (name) => {
    const found = headers.find(h => String(h.name).toLowerCase() === name.toLowerCase());
    return found ? String(found.value || '') : '';
  };

  const toHeader = getHeader('To');
  const subjectHeader = getHeader('Subject');
  const dateHeader = getHeader('Date');

  const bodyText = decodeMessageBody(message.payload);
  const snippet = message.snippet || '';
  const preview = (bodyText || snippet || '').split(/\r?\n/).map(line => line.trim()).find(Boolean) || 'Draft saved with no message content yet.';

  return {
    id: String(draft.id),
    remoteMessageId: message.id ? String(message.id) : null,
    to: normaliseRecipientList(toHeader),
    subject: subjectHeader || '(No subject)',
    body: bodyText || '',
    preview,
    date: dateHeader || null,
    snippet,
  };
}

/** Walk a Gmail `payload` tree and return the first text/plain body found. */
function decodeMessageBody(payload) {
  if (!payload) return '';

  if (payload.body?.data && (!payload.mimeType || payload.mimeType.startsWith('text/plain'))) {
    try {
      const b64 = payload.body.data.replace(/-/g, '+').replace(/_/g, '/');
      return Buffer.from(b64, 'base64').toString('utf-8');
    } catch {
      return '';
    }
  }

  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      const text = decodeMessageBody(part);
      if (text) return text;
    }
  }

  return '';
}

/**
 * List drafts for the signed-in Gmail account.
 * 列出当前登录 Gmail 账号的所有草稿。
 *
 * @param {object} [options]
 * @param {number} [options.maxResults=50]
 * @returns {Promise<{drafts: object[]}>}
 */
async function listGmailDrafts({ maxResults = 50, accountEmail } = {}) {
  const gmail = getGmailClient(accountEmail);

  const listRes = await gmail.users.drafts.list({
    userId: 'me',
    maxResults,
  });

  const items = Array.isArray(listRes.data.drafts) ? listRes.data.drafts : [];

  const drafts = [];
  for (const item of items) {
    try {
      const { data } = await gmail.users.drafts.get({
        userId: 'me',
        id: item.id,
        format: 'full',
      });
      drafts.push(normaliseGmailDraft(data));
    } catch (err) {
      console.warn('[gmailDrafts] failed to fetch draft', item.id, err.message);
    }
  }

  return { drafts };
}

/**
 * Create a remote Gmail draft.
 * 创建一个新的 Gmail 远程草稿。
 *
 * @param {object} payload - { to, cc, bcc, subject, body }
 * @returns {Promise<object>} normalised draft
 */
async function createGmailDraft(payload = {}) {
  const { accountEmail, ...rest } = payload && typeof payload === 'object' ? payload : {};
  if (!accountEmail) throw new Error('createGmailDraft: accountEmail is required');
  const gmail = getGmailClient(accountEmail);
  const account = getLinkedGmailAccount(accountEmail);
  const fromAddress = account?.email ? `"${escapeQuoted(account.name || 'Audio Emailer')}" <${account.email}>` : undefined;

  const rfc2822 = buildRfc2822Message({ ...rest, from: fromAddress });

  const { data } = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: {
      message: { raw: toBase64Url(rfc2822) },
    },
  });

  // drafts.create returns { id, message: { id, threadId, labelIds } } — fetch full for normalisation.
  const full = await gmail.users.drafts.get({
    userId: 'me',
    id: data.id,
    format: 'full',
  });
  return normaliseGmailDraft(full.data);
}

/**
 * Update (replace contents of) an existing remote Gmail draft.
 * 更新（覆盖）已存在的 Gmail 远程草稿内容。
 *
 * @param {string} draftId
 * @param {object} payload - { to, cc, bcc, subject, body }
 * @returns {Promise<object>} normalised draft
 */
async function updateGmailDraft(draftId, payload = {}) {
  if (!draftId) throw new Error('updateGmailDraft: draftId is required');

  const { accountEmail, ...rest } = payload && typeof payload === 'object' ? payload : {};
  if (!accountEmail) throw new Error('updateGmailDraft: accountEmail is required');

  const gmail = getGmailClient(accountEmail);
  const account = getLinkedGmailAccount(accountEmail);
  const fromAddress = account?.email ? `"${escapeQuoted(account.name || 'Audio Emailer')}" <${account.email}>` : undefined;

  const rfc2822 = buildRfc2822Message({ ...rest, from: fromAddress });

  await gmail.users.drafts.update({
    userId: 'me',
    id: draftId,
    requestBody: {
      message: { raw: toBase64Url(rfc2822) },
    },
  });

  const full = await gmail.users.drafts.get({
    userId: 'me',
    id: draftId,
    format: 'full',
  });
  return normaliseGmailDraft(full.data);
}

/**
 * Delete a remote Gmail draft.
 * 删除一个 Gmail 远程草稿。
 *
 * @param {string} draftId
 * @returns {Promise<{ok: true}>}
 */
async function deleteGmailDraft(draftId, accountEmail) {
  if (!draftId) throw new Error('deleteGmailDraft: draftId is required');
  if (!accountEmail) throw new Error('deleteGmailDraft: accountEmail is required');
  const gmail = getGmailClient(accountEmail);
  await gmail.users.drafts.delete({
    userId: 'me',
    id: draftId,
  });
  return { ok: true };
}

/**
 * Send an existing remote Gmail draft.
 * 发送一个已存在的 Gmail 远程草稿。
 *
 * @param {string} draftId
 * @returns {Promise<{messageId: string|null, threadId: string|null}>}
 */
async function sendGmailDraft(draftId, accountEmail) {
  if (!draftId) throw new Error('sendGmailDraft: draftId is required');
  if (!accountEmail) throw new Error('sendGmailDraft: accountEmail is required');
  const gmail = getGmailClient(accountEmail);
  const { data } = await gmail.users.drafts.send({
    userId: 'me',
    requestBody: { id: draftId },
  });
  return {
    messageId: data?.id ? String(data.id) : null,
    threadId: data?.threadId ? String(data.threadId) : null,
  };
}

module.exports = {
  listGmailDrafts,
  createGmailDraft,
  updateGmailDraft,
  deleteGmailDraft,
  sendGmailDraft,
  // Exported for tests
  buildRfc2822Message,
  toBase64Url,
};
