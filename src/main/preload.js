/**
 * Preload: contextBridge API for the renderer (IPC + local JSON fixtures).
 * 预加载脚本：通过 contextBridge 暴露给渲染进程的 API（IPC + 本地 JSON 夹具）。
 */
const { contextBridge, ipcRenderer } = require('electron');
const fs = require('fs/promises');
const path = require('path');

// Fixture directory next to main (stable regardless of process cwd)
// 夹具目录相对于 main，避免依赖进程当前工作目录
const DATA_DIR = path.join(__dirname, '..', 'data');

// Load JSON arrays from src/data/*.json / 从 src/data 读取邮件夹具
async function loadEmails(fileName = 'emails.json') {
  const filePath = path.join(DATA_DIR, fileName);
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw);
}

contextBridge.exposeInMainWorld('api', {
  scheduleTask: (timeString) => ipcRenderer.send('schedule-task', timeString),
  getSavedTasks: () => ipcRenderer.invoke('get-saved-tasks'),
  clearSchedule: () => ipcRenderer.send('clear-schedule'),
  loadEmails,
});

contextBridge.exposeInMainWorld('electronAPI', {
  googleLogin: () => ipcRenderer.invoke('auth:google-login'),
  /** Linked Google account (email, name, picture) from secure store. / 已登录 Google 时读取本地保存的邮箱、昵称、头像 */
  getGoogleAccount: () => ipcRenderer.invoke('auth:google-account'),
  /** Every Google address with locally stored tokens (multi-account). */
  listGoogleAccounts: () => ipcRenderer.invoke('auth:google-accounts-list'),
  yahooLogin: () => ipcRenderer.invoke('auth:yahoo-login'),
  /**
   * Revoke tokens and clear locally stored credentials.
   * 撤销 token 并清除本地保存的凭证。
   * @param {'google'|'yahoo'|'all'} [provider]
   */
  logout: (provider = 'all') => ipcRenderer.invoke('auth:logout', { provider }),
  /**
   * Fetch Gmail messages with pagination in descending date order.
   * Resolves with `{ status, messages, pagination, inboxUnreadTotal?, ... }` where
   * `inboxUnreadTotal` is full INBOX UNSEEN (IMAP STATUS), not the current page slice.
   * @param {number} page     - Page index (starts from 1), default is page 1
   * @param {number} pageSize - Page size, default is 20
   */
  fetchGmailMessages: (page = 1, pageSize = 20, folder = 'inbox', accountEmail) =>
    ipcRenderer.invoke('mail:gmail-fetch', { page, pageSize, folder, accountEmail }),
  /**
   * Server-side IMAP search in the given folder (TEXT + optional flag filter).
   * `filterBy`: 'all' | 'unread' | 'read' | 'starred'
   * @returns {Promise<{ status, messages?, matchedUidCount?, truncated?, error? }>}
   */
  searchGmailMessages: (query, folder = 'inbox', accountEmail, limit = 150, filterBy = 'all') =>
    ipcRenderer.invoke('mail:gmail-search', { query, folder, accountEmail, limit, filterBy }),
  fetchGmailBody: (uid, folder = 'inbox', accountEmail) =>
    ipcRenderer.invoke('mail:gmail-fetch-body', { uid, folder, accountEmail }),
  downloadGmailAttachment: (uid, folder = 'inbox', accountEmail, attachmentName) =>
    ipcRenderer.invoke('mail:gmail-download-attachment', { uid, folder, accountEmail, attachmentName }),
  updateGmailFlags: (uid, folder, { add, remove } = {}, accountEmail) =>
    ipcRenderer.invoke('mail:gmail-update-flags', { uid, folder, add, remove, accountEmail }),
  /**
   * Move a Gmail message between folders.
   * 在 Gmail 文件夹间移动邮件。
   * @param {number|string} uid
   * @param {string} fromFolder - 'inbox' | 'sent' | 'trash' | ...
   * @param {string} toFolder   - 'trash' | 'inbox' | ...
   */
  moveGmailMessage: (uid, fromFolder, toFolder, accountEmail) =>
    ipcRenderer.invoke('mail:gmail-move', { uid, fromFolder, toFolder, accountEmail }),
  /**
   * Permanently delete a Gmail message (usually in Trash).
   * 永久删除 Gmail 邮件（通常在 Trash 中）。
   * @param {number|string} uid
   * @param {string} [folder='trash']
   */
  expungeGmailMessage: (uid, folder = 'trash', accountEmail) =>
    ipcRenderer.invoke('mail:gmail-expunge', { uid, folder, accountEmail }),
  /** @param {{ smtp?: object, mail: object, useGoogleOAuth?: boolean }} payload */
  sendSmtpMail: (payload) => ipcRenderer.invoke('mail:smtp-send', payload),
  /** @param {object} smtp - nodemailer transport options, or { useGoogleOAuth: true } */
  verifySmtp: (smtp) => ipcRenderer.invoke('mail:smtp-verify', smtp),
  // ── Gmail remote drafts ───────────────────────────────────────────────────
  // Gmail 远程草稿
  listGmailDrafts: (maxResults = 50, accountEmail) =>
    ipcRenderer.invoke('mail:gmail-drafts-list', { maxResults, accountEmail }),
  /** @param {{to?:string|string[], cc?:string|string[], bcc?:string|string[], subject?:string, body?:string}} payload */
  createGmailDraft: (payload) =>
    ipcRenderer.invoke('mail:gmail-drafts-create', payload),
  updateGmailDraft: (draftId, payload) =>
    ipcRenderer.invoke('mail:gmail-drafts-update', { draftId, ...payload }),
  deleteGmailDraft: (draftId, accountEmail) =>
    ipcRenderer.invoke('mail:gmail-drafts-delete', { draftId, accountEmail }),
  sendGmailDraft: (draftId, accountEmail) =>
    ipcRenderer.invoke('mail:gmail-drafts-send', { draftId, accountEmail }),
  extractEmailFromHtml: (htmlOrPayload) =>
    ipcRenderer.invoke(
      'voice:extract-email',
      typeof htmlOrPayload === 'string' ? { html: htmlOrPayload } : htmlOrPayload,
    ),
  speakFromHtml: ({ html, voice, speed }) =>
    ipcRenderer.invoke('voice:speak-from-html', { html, voice, speed }),
  speakEmail: ({ email, voice, speed }) =>
    ipcRenderer.invoke('voice:speak-email', { email, voice, speed }),
  speakUnreadEmails: ({ emails, voice, speed }) =>
    ipcRenderer.invoke('voice:speak-unread', { emails, voice, speed }),
  ttsControl: (action) =>
    ipcRenderer.invoke('voice:control', { action }),
  getTtsVoices: () =>
    ipcRenderer.invoke('voice:get-voices'),
  getTtsPreferences: () =>
    ipcRenderer.invoke('voice:get-preferences'),
  setTtsPreferences: ({ voice, speed, pauseEnabled, pauseSeconds }) =>
    ipcRenderer.invoke('voice:set-preferences', { voice, speed, pauseEnabled, pauseSeconds }),
  getUiSettings: () =>
    ipcRenderer.invoke('settings:get-ui'),
  setUiSettings: (partial) =>
    ipcRenderer.invoke('settings:set-ui', partial),
  onMailUpdate: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('mail:nav-update', listener);
    return () => ipcRenderer.removeListener('mail:nav-update', listener);
  },
  getPendingScheduledReading: () => ipcRenderer.invoke('get-pending-scheduled-reading'),
  logToMain: (level, ...args) => ipcRenderer.send('log-to-main', level, ...args),
  onScheduledReading: (callback) => {
    const listener = (_event, messages) => callback(messages);
    ipcRenderer.on('start-scheduled-reading', listener);
    return () => ipcRenderer.removeListener('start-scheduled-reading', listener);
  },
});
