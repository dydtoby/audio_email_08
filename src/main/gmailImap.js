/**
 * Fetch emails from Gmail via IMAP using OAuth2 tokens (per Google account).
 * 使用 OAuth2 令牌通过 IMAP 从 Gmail 拉取邮件（按 Google 账号隔离）。
 */
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const libmime = require('libmime');
const { Buffer } = require('buffer');
const {
  getAuthenticatedClientForEmail,
  getLinkedGmailAccount,
  ensureGmailAccountInfo,
} = require('./auth/googleAuth');

function normalizeEmailKey(email) {
  if (!email) return null;
  const t = String(email).trim().toLowerCase();
  return t || null;
}

/** @type {Map<string, import('imapflow').ImapFlow>} */
const imapClients = new Map();

let gmailNotifyCallback = null;

const GMAIL_FOLDER_MAP = {
  inbox: 'INBOX',
  sent: '[Gmail]/Sent Mail',
  trash: '[Gmail]/Trash',
  drafts: '[Gmail]/Drafts',
  spam: '[Gmail]/Spam',
  starred: '[Gmail]/Starred',
  all: '[Gmail]/All Mail',
};

function getGmailPath(folder = 'inbox') {
  return GMAIL_FOLDER_MAP[folder.toLowerCase()] || folder;
}

/** Real Trash/Sent/… paths differ by Gmail language and [Gmail] vs [Google Mail] prefix. */
const resolvedMailboxPathCache = new Map();

function resolvedPathCacheKey(accountEmail, folder) {
  return `${normalizeEmailKey(accountEmail)}::${String(folder || '').toLowerCase()}`;
}

function normalizeImapUid(uid) {
  if (uid == null) throw new Error('uid is required');
  if (typeof uid === 'bigint') return uid.toString();
  const s =
    typeof uid === 'number' && Number.isFinite(uid)
      ? String(Math.trunc(uid))
      : String(uid).trim();
  if (!/^\d+$/.test(s)) {
    throw new Error(`Invalid IMAP message uid: ${JSON.stringify(uid)}`);
  }
  return s;
}

/**
 * Resolve a logical folder key (inbox, trash, sent, …) to the mailbox path Gmail exposes over IMAP.
 * Uses SPECIAL-USE from LIST so localized names (e.g. [Gmail]/Bin) work.
 */
async function resolveGmailImapPath(client, accountEmail, folder) {
  const fk = String(folder || 'inbox').toLowerCase();
  if (fk === 'inbox') return 'INBOX';

  const ck = resolvedPathCacheKey(accountEmail, fk);
  if (resolvedMailboxPathCache.has(ck)) {
    return resolvedMailboxPathCache.get(ck);
  }

  const specialUseTarget = {
    trash: '\\Trash',
    sent: '\\Sent',
    drafts: '\\Drafts',
    spam: '\\Junk',
    starred: '\\Flagged',
    all: '\\All',
  }[fk];

  let resolved = null;
  try {
    const entries = await client.list();
    if (specialUseTarget) {
      const hit = entries.find((e) => e.specialUse === specialUseTarget);
      if (hit && hit.path) resolved = hit.path;
    }
  } catch (err) {
    console.warn('[gmailImap] resolveGmailImapPath LIST failed, using defaults:', err.message);
  }

  if (!resolved) {
    resolved = getGmailPath(fk);
  }
  resolvedMailboxPathCache.set(ck, resolved);
  return resolved;
}

function clearResolvedMailboxPathCacheForAccount(accountEmail) {
  const nk = normalizeEmailKey(accountEmail);
  if (!nk) return;
  for (const k of [...resolvedMailboxPathCache.keys()]) {
    if (k.startsWith(`${nk}::`)) resolvedMailboxPathCache.delete(k);
  }
}

async function getAccessToken(accountEmail) {
  const oAuth2Client = getAuthenticatedClientForEmail(accountEmail);
  if (!oAuth2Client) {
    throw new Error('No authenticated Google client for this account. Please login with Google first.');
  }
  const res = await oAuth2Client.getAccessToken();
  const token = typeof res === 'string' ? res : res && res.token;
  if (!token) throw new Error('Failed to obtain Gmail access token.');
  return token;
}

async function getAccount(accountEmail) {
  let account = getLinkedGmailAccount(accountEmail);
  if (!account || !account.email) {
    account = await ensureGmailAccountInfo(accountEmail);
  }
  if (!account || !account.email) {
    throw new Error('No linked Gmail account for this address. Please complete Google login first.');
  }
  return account;
}

/**
 * @param {string} accountEmail - Gmail address used for IMAP auth and client cache key.
 */
async function ensureClientConnected(accountEmail) {
  if (!accountEmail || !String(accountEmail).trim()) {
    throw new Error('accountEmail is required for Gmail IMAP.');
  }
  const acc = await getAccount(accountEmail);
  const key = normalizeEmailKey(acc.email);

  let client = imapClients.get(key);
  if (client && client.authenticated) {
    return client;
  }

  if (client) {
    try {
      await client.logout();
    } catch (e) {
      /* ignore */
    }
    imapClients.delete(key);
  }

  const accessToken = await getAccessToken(accountEmail);

  client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: acc.email, accessToken },
    logger: false,
  });

  client.on('exists', (data) => {
    console.log(`[IMAP] ${data.count} messages in mailbox (new messages may have arrived)`);
    if (gmailNotifyCallback) {
      gmailNotifyCallback({
        type: 'exists',
        count: data.count,
        path: client.mailbox?.path,
        accountEmail: acc.email,
      });
    }
  });

  client.on('flags', (data) => {
    console.log(`[IMAP] Flags updated for message seq=${data.seq}`);
    if (gmailNotifyCallback) {
      gmailNotifyCallback({
        type: 'flags',
        seq: data.seq,
        path: client.mailbox?.path,
        accountEmail: acc.email,
      });
    }
  });

  client.on('expunge', (data) => {
    console.log(`[IMAP] Message seq=${data.seq} was expunged (deleted)`);
    if (gmailNotifyCallback) {
      gmailNotifyCallback({
        type: 'expunge',
        seq: data.seq,
        path: client.mailbox?.path,
        accountEmail: acc.email,
      });
    }
  });

  client.on('error', (err) => {
    console.error('[IMAP] Client error:', err);
  });

  client.on('close', () => {
    console.log('[IMAP] Connection closed');
    imapClients.delete(key);
  });

  await client.connect();
  // Do not call getMailboxLock() here without release() — imapflow only allows one
  // mailbox lock at a time; a leaked INBOX lock would block move/delete (messageMove).

  imapClients.set(key, client);
  return client;
}

/**
 * @param {string} [accountEmail] - When omitted, uses default linked account (startup / legacy).
 */
async function initGmailClient(accountEmail) {
  try {
    const { resolveDefaultGoogleEmail } = require('./auth/googleAuth');
    const target = accountEmail || resolveDefaultGoogleEmail();
    if (!target) return;
    await ensureClientConnected(target);
    console.log('[IMAP] Persistent Gmail client initialized for', target);
  } catch (err) {
    console.error('[IMAP] Failed to initialize persistent client:', err);
  }
}

async function fetchRecentGmailMessages({ page = 1, pageSize = 20, folder = 'inbox', accountEmail } = {}) {
  if (!accountEmail) throw new Error('fetchRecentGmailMessages: accountEmail is required');
  page = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  pageSize = Number.isFinite(pageSize) && pageSize > 0 && pageSize <= 100 ? Math.floor(pageSize) : 20;

  const client = await ensureClientConnected(accountEmail);
  const path = await resolveGmailImapPath(client, accountEmail, folder);
  const lock = await client.getMailboxLock(path);

  try {
    /** Inbox UNSEEN from server (all pages), for sidebar badges — not the current fetch slice. */
    let inboxUnreadTotal;
    try {
      const inboxPath = getGmailPath('inbox');
      const st = await client.status(inboxPath, { unseen: true });
      inboxUnreadTotal = typeof st?.unseen === 'number' ? st.unseen : undefined;
    } catch (err) {
      console.warn('[IMAP] inbox STATUS unseen failed:', err.message);
      inboxUnreadTotal = undefined;
    }

    const exists = client.mailbox.exists || 0;
    if (!exists) {
      return {
        messages: [],
        pagination: { page, pageSize, total: 0, totalPages: 0, hasNext: false, hasPrev: false },
        inboxUnreadTotal: inboxUnreadTotal ?? 0,
        debug: { mailbox: client.mailbox?.path, exists, inboxUnreadTotal },
      };
    }

    const total = exists;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const endSeq = total - (safePage - 1) * pageSize;
    const startSeq = Math.max(1, endSeq - pageSize + 1);
    const seqRange = `${startSeq}:${endSeq}`;

    const messages = [];
    const acct = String(accountEmail).trim();
    for await (const msg of client.fetch(seqRange, {
      uid: true,
      envelope: true,
      internalDate: true,
      flags: true,
    })) {
      messages.push({
        uid: msg.uid,
        accountEmail: acct,
        subject: msg.envelope.subject || '',
        from: (msg.envelope.from || []).map((a) => a.address || a.name).join(', '),
        date: msg.internalDate,
        flags: msg.flags instanceof Set ? Array.from(msg.flags) : [],
      });
    }

    messages.sort((a, b) => new Date(b.date) - new Date(a.date));

    return {
      messages,
      pagination: {
        page: safePage,
        pageSize,
        total,
        totalPages,
        hasNext: safePage < totalPages,
        hasPrev: safePage > 1,
      },
      inboxUnreadTotal: inboxUnreadTotal ?? 0,
      debug: { mailbox: client.mailbox?.path, exists, seqRange, inboxUnreadTotal },
    };
  } finally {
    lock.release();
  }
}

/**
 * IMAP SEARCH in the selected mailbox (TEXT matches headers + body), then fetch envelopes.
 * Returns newest matches first, capped at `limit` for performance.
 * Optional `filterBy` supports whole-mailbox flag filters for list tabs.
 * @param {{ query: string, folder?: string, accountEmail: string, limit?: number, filterBy?: 'all'|'unread'|'read'|'starred' }} opts
 */
async function searchGmailMessages({ query, folder = 'inbox', accountEmail, limit = 150, filterBy = 'all' } = {}) {
  if (!accountEmail) throw new Error('searchGmailMessages: accountEmail is required');
  const q = String(query ?? '').trim();
  const normalizedFilter = String(filterBy || 'all').trim().toLowerCase();
  const hasFlagFilter = normalizedFilter !== 'all';
  if (!q && !hasFlagFilter) {
    return { messages: [], matchedUidCount: 0, truncated: false };
  }

  // `limit <= 0` means "no cap" (caller intentionally requests full match set).
  const useUnlimited = Number.isFinite(limit) && Number(limit) <= 0;
  const safeLimit = useUnlimited
    ? Number.POSITIVE_INFINITY
    : (Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 5000) : 150);
  const client = await ensureClientConnected(accountEmail);
  const path = await resolveGmailImapPath(client, accountEmail, folder);
  const lock = await client.getMailboxLock(path);

  try {
    const criteria = {};
    if (q) criteria.text = q;
    if (normalizedFilter === 'unread') criteria.seen = false;
    else if (normalizedFilter === 'read') criteria.seen = true;
    else if (normalizedFilter === 'starred') criteria.flagged = true;
    const uidResults = await client.search(criteria, { uid: true });
    if (!uidResults || uidResults === false || !uidResults.length) {
      return { messages: [], matchedUidCount: 0, truncated: false };
    }

    const sortedDesc = [...uidResults].sort((a, b) => b - a);
    const totalMatched = sortedDesc.length;
    const uidList = Number.isFinite(safeLimit) ? sortedDesc.slice(0, safeLimit) : sortedDesc;
    const truncated = totalMatched > uidList.length;

    const messages = [];
    if (uidList.length === 0) {
      return { messages: [], matchedUidCount: totalMatched, truncated };
    }

    const acct = String(accountEmail).trim();
    for await (const msg of client.fetch(uidList, {
      uid: true,
      envelope: true,
      internalDate: true,
      flags: true,
    }, { uid: true })) {
      messages.push({
        uid: msg.uid,
        accountEmail: acct,
        subject: msg.envelope.subject || '',
        from: (msg.envelope.from || []).map((a) => a.address || a.name).join(', '),
        date: msg.internalDate,
        flags: msg.flags instanceof Set ? Array.from(msg.flags) : [],
      });
    }

    messages.sort((a, b) => new Date(b.date) - new Date(a.date));

    return { messages, matchedUidCount: totalMatched, truncated };
  } finally {
    lock.release();
  }
}

/** Cache of parsed attachments by message, so repeated downloads skip a full IMAP refetch + simpleParser. */
const ATTACHMENT_CACHE_TTL_MS = 5 * 60 * 1000;
const ATTACHMENT_CACHE_MAX_ENTRIES = 32;
const attachmentContentCache = new Map();

function attachmentCacheKey(accountEmail, folder, uidStr) {
  const acct = normalizeEmailKey(accountEmail) || '';
  const f = String(folder || 'inbox').toLowerCase();
  return `${acct}::${f}::${uidStr}`;
}

function readAttachmentCache(key) {
  const entry = attachmentContentCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.storedAt > ATTACHMENT_CACHE_TTL_MS) {
    attachmentContentCache.delete(key);
    return null;
  }
  return entry.attachments;
}

function writeAttachmentCache(key, attachments) {
  if (!Array.isArray(attachments)) return;
  attachmentContentCache.set(key, { attachments, storedAt: Date.now() });
  if (attachmentContentCache.size > ATTACHMENT_CACHE_MAX_ENTRIES) {
    const oldestKey = attachmentContentCache.keys().next().value;
    if (oldestKey != null) attachmentContentCache.delete(oldestKey);
  }
}

/** Parsed body fields by message (same key shape as attachment cache). */
const BODY_CACHE_TTL_MS = 10 * 60 * 1000;
const BODY_CACHE_MAX_ENTRIES = 64;
const bodyMessageCache = new Map();

function readBodyCache(key) {
  const entry = bodyMessageCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.storedAt > BODY_CACHE_TTL_MS) {
    bodyMessageCache.delete(key);
    return null;
  }
  return entry.payload;
}

function writeBodyCache(key, payload) {
  if (!payload || typeof payload !== 'object') return;
  bodyMessageCache.set(key, { payload, storedAt: Date.now() });
  if (bodyMessageCache.size > BODY_CACHE_MAX_ENTRIES) {
    const oldestKey = bodyMessageCache.keys().next().value;
    if (oldestKey != null) bodyMessageCache.delete(oldestKey);
  }
}

function decodeMimeWordsRfc2047(str) {
  if (!str || typeof str !== 'string') return '';
  try {
    return libmime.decodeWords(str);
  } catch {
    return str;
  }
}

function envelopeJoin(list) {
  if (!Array.isArray(list)) return '';
  return list
    .map((a) => a.address || a.name || '')
    .filter(Boolean)
    .join(', ');
}

/** @param {any} node @param {{ htmlPart: string|null, textPart: string|null }} acc */
function collectTextPartPaths(node, acc) {
  if (!node) return acc;
  const type = String(node.type || '').toLowerCase();
  if (node.part) {
    if (type === 'text/html') acc.htmlPart = node.part;
    if (type === 'text/plain') acc.textPart = node.part;
  }
  if (Array.isArray(node.childNodes)) {
    for (const ch of node.childNodes) collectTextPartPaths(ch, acc);
  }
  return acc;
}

/**
 * @param {any} node
 * @param {Array<{ name: string, size: string, contentType: string }>} out
 * @param {Set<string>} seenNames
 */
function collectAttachmentMetaFromBodyStructure(node, out, seenNames) {
  if (!node) return;
  const type = String(node.type || '').toLowerCase();
  if (type.startsWith('multipart/')) {
    if (Array.isArray(node.childNodes)) {
      for (const ch of node.childNodes) collectAttachmentMetaFromBodyStructure(ch, out, seenNames);
    }
    return;
  }

  const part = node.part;
  if (!part) return;
  if (type === 'text/plain' || type === 'text/html') return;

  const disp = String(node.disposition || '').toLowerCase();
  const dp = node.dispositionParameters || {};
  const param = node.parameters || {};
  let filename = dp.filename || param.name || param.filename;
  if (filename) filename = decodeMimeWordsRfc2047(String(filename)).trim();

  const size = Number.isFinite(node.size) ? `${node.size} B` : '';
  const ct = node.type || '';

  const isAttachmentDisposition = disp === 'attachment';
  const hasNamedFile = !!filename;
  const isLikelyBinaryAttachment =
    isAttachmentDisposition ||
    (hasNamedFile && type !== 'message/rfc822') ||
    (type.startsWith('application/') && hasNamedFile) ||
    (type === 'message/rfc822' && hasNamedFile);

  if (isLikelyBinaryAttachment && hasNamedFile && !seenNames.has(filename)) {
    seenNames.add(filename);
    out.push({ name: filename, size, contentType: ct });
  }

  if (Array.isArray(node.childNodes)) {
    for (const ch of node.childNodes) collectAttachmentMetaFromBodyStructure(ch, out, seenNames);
  }
}

async function streamToBuffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function downloadBodyPartToBuffer(client, uidStr, part) {
  if (!part) return Buffer.alloc(0);
  const { content } = await client.download(uidStr, part, { uid: true });
  if (!content) return Buffer.alloc(0);
  return streamToBuffer(content);
}

function buildAttachmentMetaList(parsedAttachments) {
  if (!Array.isArray(parsedAttachments)) return [];
  return parsedAttachments
    .map((att) => ({
      name: att?.filename || 'attachment',
      size: Number.isFinite(att?.size) ? `${att.size} B` : '',
      contentType: att?.contentType || '',
    }))
    .filter((att) => att.name);
}

async function fetchGmailMessageBody(uid, folder = 'inbox', accountEmail) {
  if (!accountEmail) throw new Error('fetchGmailMessageBody: accountEmail is required');
  const uidStr = normalizeImapUid(uid);
  const cacheKey = attachmentCacheKey(accountEmail, folder, uidStr);
  const cached = readBodyCache(cacheKey);
  if (cached) {
    console.log('[gmailImap] fetchGmailMessageBody cache hit', {
      uid: uidStr,
      folder,
      account: normalizeEmailKey(accountEmail),
    });
    return cached;
  }

  const client = await ensureClientConnected(accountEmail);
  const path = await resolveGmailImapPath(client, accountEmail, folder);
  const lock = await client.getMailboxLock(path);

  try {
    const tStruct0 = Date.now();
    const msg = await client.fetchOne(
      uidStr,
      {
        uid: true,
        envelope: true,
        internalDate: true,
        bodyStructure: true,
      },
      { uid: true }
    );
    const tStruct1 = Date.now();

    if (!msg) throw new Error(`Message UID ${uidStr} not found.`);

    const paths = collectTextPartPaths(msg.bodyStructure, { htmlPart: null, textPart: null });

    if (paths.htmlPart || paths.textPart) {
      try {
        let html = '';
        let text = '';
        const tHtml0 = Date.now();
        let tHtml1 = tHtml0;
        if (paths.htmlPart) {
          const buf = await downloadBodyPartToBuffer(client, uidStr, paths.htmlPart);
          html = buf.toString('utf8');
          tHtml1 = Date.now();
        }
        let tTxt0 = Date.now();
        let tTxt1 = Date.now();
        if (paths.textPart && (!paths.htmlPart || paths.textPart !== paths.htmlPart)) {
          tTxt0 = Date.now();
          const buf = await downloadBodyPartToBuffer(client, uidStr, paths.textPart);
          text = buf.toString('utf8');
          tTxt1 = Date.now();
        }

        const hasBody = (html && html.trim()) || (text && text.trim());
        if (hasBody) {
          const attachmentList = [];
          collectAttachmentMetaFromBodyStructure(msg.bodyStructure, attachmentList, new Set());

          const subject = decodeMimeWordsRfc2047(String(msg.envelope?.subject || ''));
          const result = {
            uid: uidStr,
            subject,
            from: envelopeJoin(msg.envelope?.from),
            to: envelopeJoin(msg.envelope?.to),
            date: msg.internalDate || msg.envelope?.date || null,
            text,
            html,
            attachments: attachmentList,
          };

          console.log('[gmailImap] fetchGmailMessageBody partial path', {
            uid: uidStr,
            folder,
            fetchStructureMs: tStruct1 - tStruct0,
            downloadHtmlMs: paths.htmlPart ? tHtml1 - tHtml0 : 0,
            downloadTextMs:
              paths.textPart && (!paths.htmlPart || paths.textPart !== paths.htmlPart) ? tTxt1 - tTxt0 : 0,
            htmlBytes: Buffer.byteLength(html, 'utf8'),
            textBytes: Buffer.byteLength(text, 'utf8'),
            attachmentMetaCount: attachmentList.length,
          });

          writeBodyCache(cacheKey, result);
          return result;
        }
      } catch (err) {
        console.warn('[gmailImap] fetchGmailMessageBody partial path error, using full MIME', {
          uid: uidStr,
          err: err.message,
        });
      }
    }

    const tSrc0 = Date.now();
    const msgFull = await client.fetchOne(
      uidStr,
      { uid: true, envelope: true, internalDate: true, source: true },
      { uid: true }
    );
    const tSrc1 = Date.now();
    if (!msgFull) throw new Error(`Message UID ${uidStr} not found.`);

    const raw = msgFull.source || '';
    const rawBytes = Buffer.isBuffer(raw) ? raw.length : Buffer.byteLength(String(raw), 'utf8');

    const tParse0 = Date.now();
    const parsed = await simpleParser(raw);
    const tParse1 = Date.now();

    console.log('[gmailImap] fetchGmailMessageBody full MIME path', {
      uid: uidStr,
      folder,
      fetchStructureMs: tStruct1 - tStruct0,
      fetchSourceMs: tSrc1 - tSrc0,
      simpleParserMs: tParse1 - tParse0,
      rawBytes,
      hadTextPartsInStructure: !!(paths.htmlPart || paths.textPart),
    });

    const attachments = buildAttachmentMetaList(parsed.attachments);
    writeAttachmentCache(cacheKey, parsed.attachments || []);

    const result = {
      uid: uidStr,
      subject: parsed.subject || msgFull.envelope?.subject || '',
      from: parsed.from?.text || envelopeJoin(msgFull.envelope?.from),
      to: parsed.to?.text || envelopeJoin(msgFull.envelope?.to),
      date: parsed.date || msgFull.internalDate || msgFull.envelope?.date || null,
      text: parsed.text || '',
      html: parsed.html || '',
      attachments,
    };
    writeBodyCache(cacheKey, result);
    return result;
  } finally {
    lock.release();
  }
}

async function fetchGmailAttachmentContent(uid, folder = 'inbox', accountEmail, attachmentName) {
  if (!accountEmail) throw new Error('fetchGmailAttachmentContent: accountEmail is required');
  if (!attachmentName || !String(attachmentName).trim()) {
    throw new Error('fetchGmailAttachmentContent: attachmentName is required');
  }

  const uidStr = normalizeImapUid(uid);
  const targetName = String(attachmentName).trim();
  const cacheKey = attachmentCacheKey(accountEmail, folder, uidStr);

  const cached = readAttachmentCache(cacheKey);
  if (cached) {
    const target = cached.find((att) => String(att?.filename || '').trim() === targetName);
    if (target && target.content) {
      return {
        filename: target.filename || targetName,
        contentType: target.contentType || 'application/octet-stream',
        content: target.content,
      };
    }
  }

  const client = await ensureClientConnected(accountEmail);
  const path = await resolveGmailImapPath(client, accountEmail, folder);
  const lock = await client.getMailboxLock(path);

  try {
    const msg = await client.fetchOne(uidStr, { source: true }, { uid: true });
    if (!msg) throw new Error(`Message UID ${uidStr} not found.`);

    const raw = msg.source || '';
    const parsed = await simpleParser(raw);
    const attachments = Array.isArray(parsed.attachments) ? parsed.attachments : [];
    writeAttachmentCache(cacheKey, attachments);

    const target = attachments.find((att) => String(att?.filename || '').trim() === targetName);
    if (!target || !target.content) {
      throw new Error(`Attachment not found: ${targetName}`);
    }

    return {
      filename: target.filename || targetName,
      contentType: target.contentType || 'application/octet-stream',
      content: target.content,
    };
  } finally {
    lock.release();
  }
}

async function updateGmailMessageFlags(uid, folder, { add = [], remove = [] } = {}, accountEmail) {
  if (!accountEmail) throw new Error('updateGmailMessageFlags: accountEmail is required');
  const uidStr = normalizeImapUid(uid);
  const client = await ensureClientConnected(accountEmail);
  const path = await resolveGmailImapPath(client, accountEmail, folder);
  const lock = await client.getMailboxLock(path);

  try {
    if (add.length > 0) {
      await client.messageFlagsAdd(uidStr, add, { uid: true });
    }
    if (remove.length > 0) {
      await client.messageFlagsRemove(uidStr, remove, { uid: true });
    }
    return { success: true };
  } finally {
    lock.release();
  }
}

async function moveGmailMessage(uid, fromFolder, toFolder, accountEmail) {
  if (!accountEmail) throw new Error('moveGmailMessage: accountEmail is required');
  if (!uid) throw new Error('moveGmailMessage: uid is required');
  if (!fromFolder || !toFolder) throw new Error('moveGmailMessage: fromFolder and toFolder are required');

  const uidStr = normalizeImapUid(uid);
  const client = await ensureClientConnected(accountEmail);
  const fromPath = await resolveGmailImapPath(client, accountEmail, fromFolder);
  const toPath = await resolveGmailImapPath(client, accountEmail, toFolder);
  if (fromPath === toPath) {
    return { success: true, fromPath, toPath, noop: true };
  }

  const lock = await client.getMailboxLock(fromPath);
  try {
    const moveResult = await client.messageMove(uidStr, toPath, { uid: true });
    if (!moveResult) {
      throw new Error(
        'Gmail IMAP MOVE failed (no result). Common causes: wrong Trash folder for your Gmail language, or stale message UID — refresh the list and try again.'
      );
    }
    return { success: true, fromPath, toPath, moveResult };
  } finally {
    lock.release();
  }
}

async function expungeGmailMessage(uid, folder = 'trash', accountEmail) {
  if (!accountEmail) throw new Error('expungeGmailMessage: accountEmail is required');
  if (!uid) throw new Error('expungeGmailMessage: uid is required');
  const uidStr = normalizeImapUid(uid);
  const client = await ensureClientConnected(accountEmail);
  const path = await resolveGmailImapPath(client, accountEmail, folder);
  const lock = await client.getMailboxLock(path);
  try {
    const delResult = await client.messageDelete(uidStr, { uid: true });
    if (delResult === false) {
      throw new Error('Gmail IMAP could not permanently delete this message.');
    }
    return { success: true, path };
  } finally {
    lock.release();
  }
}

function setGmailNotifyCallback(cb) {
  gmailNotifyCallback = cb;
}

/**
 * @param {string} [accountEmail] - Close one IMAP session; omit to close all.
 */
async function closeImapClient(accountEmail) {
  if (accountEmail) {
    const key = normalizeEmailKey(accountEmail);
    const client = key ? imapClients.get(key) : null;
    if (!client) return { closed: false };
    try {
      await client.logout();
    } catch (err) {
      console.warn('[IMAP] logout failed:', err.message);
    }
    imapClients.delete(key);
    clearResolvedMailboxPathCacheForAccount(accountEmail);
    return { closed: true };
  }

  const entries = [...imapClients.entries()];
  for (const [, client] of entries) {
    try {
      await client.logout();
    } catch (err) {
      console.warn('[IMAP] logout failed:', err.message);
    }
  }
  imapClients.clear();
  resolvedMailboxPathCache.clear();
  return { closed: entries.length > 0 };
}

module.exports = {
  initGmailClient,
  fetchRecentGmailMessages,
  searchGmailMessages,
  fetchGmailMessageBody,
  fetchGmailAttachmentContent,
  updateGmailMessageFlags,
  moveGmailMessage,
  expungeGmailMessage,
  setGmailNotifyCallback,
  closeImapClient,
};
