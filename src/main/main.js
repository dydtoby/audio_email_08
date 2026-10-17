/**
 * Electron main process: window, IPC, mail and auth wiring.
 * Electron 主进程：窗口、IPC、邮件与认证逻辑入口。
 */
const path = require('path');
const fsSync = require('fs');
const os = require('os');
const dotenv = require('dotenv');
const localEnvPath = path.join(__dirname, '..', '..', '.env');
const packagedEnvPath = path.join(process.resourcesPath || '', '.env');
const exeDirEnvPath = path.join(path.dirname(process.execPath || ''), '.env');
const homeEnvPath = path.join(os.homedir(), '.env');

for (const envPath of [localEnvPath, packagedEnvPath, exeDirEnvPath, homeEnvPath]) {
  if (envPath && fsSync.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }
}
const { app, BrowserWindow, ipcMain, dialog } = require('electron')

// Disable Chromium's autoplay policy so scheduled reading can play audio without user interaction
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const fs = require('fs/promises')
const ElectronStore = require('electron-store')
const { initializeScheduler, getSavedTasks, handleScheduleTask, clearScheduleTask, setScheduledCallback } = require('./scheduler/schedulerManager');
const { ensureGoogleSession, ensureYahooSession } = require('./auth/sessionManager')
const {
  startGoogleOAuthFlow,
  getLinkedGmailAccount,
  ensureGmailAccountInfo,
  logoutGoogle,
  resolveDefaultGoogleEmail,
  listGoogleAccounts,
} = require('./auth/googleAuth')
const { startYahooOAuthFlow, getLinkedYahooAccount, logoutYahoo } = require('./auth/yahooAuth')
const { initGmailClient, fetchRecentGmailMessages, searchGmailMessages, fetchGmailMessageBody, fetchGmailAttachmentContent, updateGmailMessageFlags, moveGmailMessage, expungeGmailMessage, setGmailNotifyCallback, closeImapClient } = require('./email/gmailImap')
const { sendMail: smtpSendMail, verifySmtp } = require('./email/smtpClient')
const { getGmailSmtpTransportOptions } = require('./email/gmailSmtpOAuth')
const {
  listGmailDrafts,
  createGmailDraft,
  updateGmailDraft,
  deleteGmailDraft,
  sendGmailDraft,
} = require('./email/gmailDrafts')
const {
  processEmailHtml,
  speakFromHtml,
  speakEmailData,
  speakUnreadEmails,
  ttsControl,
  getTtsVoices,
  getTtsPreferences,
  setTtsPreferences,
} = require('./integration/voicePipeline')
const {
  startTextExtractionServer,
  stopTextExtractionServer,
} = require('./textExtractionServer')
const { getStoreEncryptionKey } = require('./storeEncryption')

const isDev = !app.isPackaged
const DEV_SERVER_PORT = require(path.join(__dirname, '..', '..', 'devPort.cjs'))
const Store = typeof ElectronStore === 'function' ? ElectronStore : ElectronStore.default
const uiSettingsStore = new Store({
  name: 'ui-settings',
  encryptionKey: getStoreEncryptionKey(),
  clearInvalidConfig: true,
  defaults: {
    theme: 'dark',
    fontSize: 'medium',
    language: 'en-US',
    emailsPerPage: 20,
    audio: {
      speed: 'Normal',
      voiceMode: 'Female',
      voiceUri: '',
    },
    tts: {
      pauseEnabled: false,
      pauseSeconds: 0.7,
    },
  },
})

function normalizePauseSeconds(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0.7
  return Math.min(10, Math.max(0, n))
}

function normalizeUiSettings(raw) {
  const input = raw && typeof raw === 'object' ? raw : {}
  const theme = input.theme === 'light' ? 'light' : 'dark'
  const fontSize = ['small', 'medium', 'large'].includes(input.fontSize) ? input.fontSize : 'medium'
  const language = typeof input.language === 'string' && input.language.trim()
    ? input.language.trim()
    : 'en-US'
  const emailsPerPage = [20, 50, 100].includes(Number(input.emailsPerPage))
    ? Number(input.emailsPerPage)
    : 20
  const audioIn = input.audio && typeof input.audio === 'object' ? input.audio : {}
  const normalizedSpeed = String(audioIn.speed || '').trim().toLowerCase()
  const speed = normalizedSpeed === 'slow'
    ? 'Slow'
    : normalizedSpeed === 'fast'
      ? 'Fast'
      : 'Normal'
  const voiceMode = audioIn.voiceMode === 'Male' ? 'Male' : 'Female'
  const voiceUri = typeof audioIn.voiceUri === 'string' ? audioIn.voiceUri : ''
  const ttsIn = raw && typeof raw === 'object' && raw.tts && typeof raw.tts === 'object'
    ? raw.tts
    : {}
  return {
    theme,
    fontSize,
    language,
    emailsPerPage,
    audio: {
      speed,
      voiceMode,
      voiceUri,
    },
    tts: {
      pauseEnabled: !!ttsIn.pauseEnabled,
      pauseSeconds: normalizePauseSeconds(ttsIn.pauseSeconds),
    },
  }
}

/**
 * Prefer UI value when non-empty; otherwise use environment (see .env SMTP_*).
 * 非空优先用界面值，否则用环境变量（.env 中的 SMTP_*）。
 */
function pickStr(uiVal, envVal) {
  const u = uiVal != null ? String(uiVal).trim() : ''
  if (u) return u
  const e = envVal != null ? String(envVal).trim() : ''
  return e || ''
}

/**
 * Merge renderer partial SMTP config with process.env (password SMTP path).
 * 合并渲染进程传入的 SMTP 片段与 process.env（密码发信路径）。
 * @param {object} [partial] - from renderer: { host, port, secure, auth: { user, pass } }
 */
function resolveSmtpConfig(partial) {
  const p = partial && typeof partial === 'object' ? partial : {}
  const auth = p.auth && typeof p.auth === 'object' ? p.auth : {}
  const host = pickStr(p.host, process.env.SMTP_HOST)
  const user = pickStr(auth.user, process.env.SMTP_USER)
  const pass = pickStr(auth.pass, process.env.SMTP_PASS)

  let port = p.port
  if (port === '' || port === undefined || port === null) {
    const n = parseInt(process.env.SMTP_PORT || '465', 10)
    port = Number.isFinite(n) ? n : 465
  } else {
    const n = typeof port === 'number' ? port : parseInt(String(port), 10)
    port = Number.isFinite(n) ? n : 465
  }

  let secure
  if (typeof p.secure === 'boolean') {
    secure = p.secure
  } else {
    const v = process.env.SMTP_SECURE
    secure = v === undefined || v === '' ? true : !['false', '0', 'no'].includes(String(v).toLowerCase())
  }

  const missing = []
  if (!host) missing.push('SMTP server (host)')
  if (!user) missing.push('SMTP username (user)')
  if (!pass) missing.push('SMTP password or app password (pass)')

  const defaultFrom = pickStr(process.env.SMTP_FROM, user)

  return {
    smtp: { host, port, secure, auth: { user, pass } },
    missing,
    defaultFrom,
  }
}

app.on('will-quit', () => {
  stopTextExtractionServer()
})

/** Create the main BrowserWindow (Vite dev URL or packaged index.html). / 创建主窗口 */
const createWindow = () => {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    fullscreen: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: false,
    }
  });

  if (isDev) {
    win.loadURL(`http://127.0.0.1:${DEV_SERVER_PORT}`)
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(__dirname, '..', '..', 'dist', 'renderer', 'index.html'))
  }
}

app.whenReady().then(async () => {
  try {
    await startTextExtractionServer()
  } catch (err) {
    console.error('[main] Text extraction (html2text) auto-start failed:', err.message)
  }

  try {
    initializeScheduler();

    // Hook up the background task to read unread emails when scheduled
    setScheduledCallback(async (taskOpts = {}) => {
      try {
        const mode = taskOpts.mode || 'Unread Only';
        let filterBy = 'unread';
        if (mode === 'All Emails') filterBy = 'all';
        else if (mode === 'Starred Only') filterBy = 'starred';

        const email = resolveDefaultGoogleEmail();
        if (!email) {
          console.warn('[main] No default Google account for scheduled reading.');
          return;
        }
        await ensureGoogleSession(email);
        let messages = [];
        if (filterBy === 'all') {
          const res = await fetchRecentGmailMessages({
            page: 1,
            pageSize: 20,
            folder: 'inbox',
            accountEmail: email
          });
          messages = res.messages || [];
        } else {
          const res = await searchGmailMessages({
            query: '',
            folder: 'inbox',
            accountEmail: email,
            limit: 20,
            filterBy
          });
          messages = res.messages || [];
        }
        if (messages && messages.length > 0) {
          // Add mailboxEmail to each message so the frontend can identify the account
          const enrichedMessages = messages.map(m => ({
            ...m,
            mailboxEmail: email
          }));

          console.log(`[main] Scheduled reading: Found ${enrichedMessages.length} messages. Triggering frontend...`);
          // Buffer the messages in case the frontend isn't ready yet
          global.pendingScheduledMessages = enrichedMessages;

          BrowserWindow.getAllWindows().forEach((win) => {
            if (!win.isDestroyed()) {
              // Simulate a user interaction to bypass Chromium's Web Speech API user-gesture requirement
              // The Web Speech API strictly requires a transient user activation to output audio.
              win.webContents.sendInputEvent({ type: 'mouseDown', x: 1, y: 1, button: 'left', clickCount: 1 });
              win.webContents.sendInputEvent({ type: 'mouseUp', x: 1, y: 1, button: 'left', clickCount: 1 });

              win.webContents.send('start-scheduled-reading', enrichedMessages);
            }
          });
        } else {
          console.log('[main] Scheduled reading: No unread emails found.');
        }
      } catch (e) {
        console.error('[main] Scheduled reading failed:', e);
      }
    });
  } catch (err) {
    console.error('[main] initializeScheduler failed (non-fatal):', err);
  }

  // Handle frontend requests for pending scheduled messages
  ipcMain.handle('get-pending-scheduled-reading', () => {
    const msgs = global.pendingScheduledMessages;
    global.pendingScheduledMessages = null; // Clear it after reading
    return msgs;
  });

  // Register IMAP notification callback / 注册 IMAP 通知回调
  setGmailNotifyCallback((data) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('mail:nav-update', data);
      }
    });
  });

  // Renderer logging relay
  ipcMain.on('log-to-main', (event, level, ...args) => {
    if (level === 'error') console.error('[Renderer Error]', ...args);
    else if (level === 'warn') console.warn('[Renderer Warn]', ...args);
    else console.log('[Renderer Log]', ...args);
  });

  ipcMain.handle('get-saved-tasks', () => getSavedTasks());
  ipcMain.on('schedule-task', (_event, timeString) => handleScheduleTask(timeString));
  ipcMain.on('clear-schedule', () => clearScheduleTask());

  ipcMain.handle('settings:get-ui', () => {
    try {
      return { status: 'ok', data: normalizeUiSettings(uiSettingsStore.store) }
    } catch (err) {
      console.error('[IPC] settings:get-ui failed:', err)
      return { status: 'error', error: err.message }
    }
  })

  ipcMain.handle('settings:set-ui', (_event, partial = {}) => {
    try {
      const current = normalizeUiSettings(uiSettingsStore.store)
      const next = normalizeUiSettings({
        ...current,
        ...(partial && typeof partial === 'object' ? partial : {}),
        tts: {
          ...current.tts,
          ...((partial && typeof partial === 'object' && partial.tts && typeof partial.tts === 'object')
            ? partial.tts
            : {}),
        },
      })
      uiSettingsStore.store = next
      return { status: 'ok', data: next }
    } catch (err) {
      console.error('[IPC] settings:set-ui failed:', err)
      return { status: 'error', error: err.message }
    }
  })

  ipcMain.handle('auth:google-login', async () => {
    try {
      const tokens = await startGoogleOAuthFlow()
      const account = (await ensureGmailAccountInfo()) || getLinkedGmailAccount()
      if (account?.email) {
        try {
          await closeImapClient(account.email)
        } catch (_) {
          /* ignore */
        }
        initGmailClient(account.email)
      }
      return {
        status: 'ok',
        hasToken: !!tokens,
        email: account?.email ?? null,
        name: account?.name ?? null,
        picture: account?.picture ?? null,
      }
    } catch (err) {
      console.error('[IPC] auth:google-login failed:', err)
      return { status: 'error', error: err.message }
    }
  })

  /**
   * Return linked Google profile from stored tokens (e.g. when route state is missing).
   * 进入收件箱后若路由未带 state，可从本地 token 补全邮箱与头像。
   */
  ipcMain.handle('auth:google-account', async () => {
    try {
      const account = (await ensureGmailAccountInfo()) || getLinkedGmailAccount()
      if (!account?.email) {
        return { status: 'error', error: 'No linked Google account' }
      }
      return {
        status: 'ok',
        email: account.email,
        name: account.name ?? null,
        picture: account.picture ?? null,
      }
    } catch (err) {
      console.error('[IPC] auth:google-account failed:', err)
      return { status: 'error', error: err.message }
    }
  })

  /** All Google inboxes with stored OAuth tokens (for multi-account UI restore). */
  ipcMain.handle('auth:google-accounts-list', async () => {
    try {
      const accounts = listGoogleAccounts()
      return { status: 'ok', accounts: Array.isArray(accounts) ? accounts : [] }
    } catch (err) {
      console.error('[IPC] auth:google-accounts-list failed:', err)
      return { status: 'error', error: err.message, accounts: [] }
    }
  })

  ipcMain.handle('auth:yahoo-login', async () => {
    try {
      const tokens = await startYahooOAuthFlow()
      const account = getLinkedYahooAccount()
      return { status: 'ok', hasToken: !!tokens, email: account ? account.email : null }
    } catch (err) {
      console.error('[IPC] auth:yahoo-login failed:', err)
      return { status: 'error', error: err.message }
    }
  })

  ipcMain.handle('mail:gmail-fetch', async (_event, { page, pageSize, folder, accountEmail } = {}) => {
    try {
      const resolved =
        accountEmail && String(accountEmail).trim()
          ? String(accountEmail).trim()
          : resolveDefaultGoogleEmail()
      if (!resolved) throw new Error('No Google account selected.')
      await ensureGoogleSession(resolved)
      const { messages, pagination, debug, inboxUnreadTotal } = await fetchRecentGmailMessages({
        page,
        pageSize,
        folder,
        accountEmail: resolved,
      })
      return { status: 'ok', messages, pagination, debug, inboxUnreadTotal }
    } catch (err) {
      console.error('[IPC] mail:gmail-fetch failed:', err)
      return { status: 'error', error: err.message }
    }
  })

  ipcMain.handle('mail:gmail-search', async (_event, { query, folder, accountEmail, limit, filterBy } = {}) => {
    try {
      const resolved =
        accountEmail && String(accountEmail).trim()
          ? String(accountEmail).trim()
          : resolveDefaultGoogleEmail()
      if (!resolved) throw new Error('No Google account selected.')
      await ensureGoogleSession(resolved)
      const { messages, matchedUidCount, truncated } = await searchGmailMessages({
        query,
        folder,
        accountEmail: resolved,
        limit,
        filterBy,
      })
      return { status: 'ok', messages, matchedUidCount, truncated }
    } catch (err) {
      console.error('[IPC] mail:gmail-search failed:', err)
      return { status: 'error', error: err.message }
    }
  })

  ipcMain.handle('mail:gmail-fetch-body', async (_event, { uid, folder, accountEmail } = {}) => {
    try {
      if (!uid) throw new Error('uid is required')
      const resolved =
        accountEmail && String(accountEmail).trim()
          ? String(accountEmail).trim()
          : resolveDefaultGoogleEmail()
      if (!resolved) throw new Error('No Google account selected.')
      await ensureGoogleSession(resolved)
      const body = await fetchGmailMessageBody(uid, folder, resolved)
      return { status: 'ok', ...body }
    } catch (err) {
      console.error('[IPC] mail:gmail-fetch-body failed:', err)
      return { status: 'error', error: err.message }
    }
  })

  ipcMain.handle('mail:gmail-download-attachment', async (event, { uid, folder, accountEmail, attachmentName } = {}) => {
    try {
      if (!uid) throw new Error('uid is required')
      if (!attachmentName || !String(attachmentName).trim()) throw new Error('attachmentName is required')
      const resolved =
        accountEmail && String(accountEmail).trim()
          ? String(accountEmail).trim()
          : resolveDefaultGoogleEmail()
      if (!resolved) throw new Error('No Google account selected.')
      await ensureGoogleSession(resolved)

      const attachment = await fetchGmailAttachmentContent(uid, folder || 'inbox', resolved, attachmentName)
      const defaultPath = path.join(app.getPath('downloads'), attachment.filename || String(attachmentName))
      const ownerWindow =
        BrowserWindow.fromWebContents(event.sender) ||
        BrowserWindow.getFocusedWindow() ||
        BrowserWindow.getAllWindows()[0] ||
        null
      const saveResult = await dialog.showSaveDialog(ownerWindow ?? undefined, {
        title: 'Save attachment',
        defaultPath,
      })
      if (saveResult.canceled || !saveResult.filePath) {
        return { status: 'cancelled' }
      }

      await fs.writeFile(saveResult.filePath, attachment.content)
      return { status: 'ok', filePath: saveResult.filePath, contentType: attachment.contentType }
    } catch (err) {
      console.error('[IPC] mail:gmail-download-attachment failed:', err)
      return { status: 'error', error: err.message }
    }
  })

  ipcMain.handle('mail:gmail-update-flags', async (_event, { uid, folder, add, remove, accountEmail } = {}) => {
    try {
      if (!uid) throw new Error('uid is required')
      const resolved =
        accountEmail && String(accountEmail).trim()
          ? String(accountEmail).trim()
          : resolveDefaultGoogleEmail()
      if (!resolved) throw new Error('No Google account selected.')
      await ensureGoogleSession(resolved)
      const result = await updateGmailMessageFlags(uid, folder, { add, remove }, resolved)
      return { status: 'ok', ...result }
    } catch (err) {
      console.error('[IPC] mail:gmail-update-flags failed:', err)
      return { status: 'error', error: err.message }
    }
  })

  /**
   * Move a Gmail message between folders (delete = move to trash;
   * restore = move from trash back to inbox).
   * 在 Gmail 文件夹间移动邮件（删除 = 移到 trash；恢复 = trash → inbox）。
   */
  ipcMain.handle('mail:gmail-move', async (_event, { uid, fromFolder, toFolder, accountEmail } = {}) => {
    try {
      if (!uid) throw new Error('uid is required')
      const resolved =
        accountEmail && String(accountEmail).trim()
          ? String(accountEmail).trim()
          : resolveDefaultGoogleEmail()
      if (!resolved) throw new Error('No Google account selected.')
      await ensureGoogleSession(resolved)
      const result = await moveGmailMessage(uid, fromFolder, toFolder, resolved)
      return { status: 'ok', ...result }
    } catch (err) {
      console.error('[IPC] mail:gmail-move failed:', err)
      return { status: 'error', error: err.message }
    }
  })

  /**
   * Permanently delete a Gmail message (e.g. delete forever from trash).
   * 永久删除一封 Gmail 邮件（例如在 Trash 中彻底删除）。
   */
  ipcMain.handle('mail:gmail-expunge', async (_event, { uid, folder, accountEmail } = {}) => {
    try {
      if (!uid) throw new Error('uid is required')
      const resolved =
        accountEmail && String(accountEmail).trim()
          ? String(accountEmail).trim()
          : resolveDefaultGoogleEmail()
      if (!resolved) throw new Error('No Google account selected.')
      await ensureGoogleSession(resolved)
      const result = await expungeGmailMessage(uid, folder || 'trash', resolved)
      return { status: 'ok', ...result }
    } catch (err) {
      console.error('[IPC] mail:gmail-expunge failed:', err)
      return { status: 'error', error: err.message }
    }
  })

  ipcMain.handle('voice:extract-email', async (_event, payload = {}) => {
    try {
      const html =
        typeof payload === 'string'
          ? payload
          : typeof payload?.html === 'string'
            ? payload.html
            : ''
      if (!html || typeof html !== 'string') throw new Error('html is required')
      const meta = typeof payload === 'string' || !payload || typeof payload !== 'object' ? {} : { ...payload }
      delete meta.html
      const result = await processEmailHtml(html, meta)
      return { status: 'ok', ...result }
    } catch (err) {
      console.error('[IPC] voice:extract-email failed:', err)
      return { status: 'error', error: err.message }
    }
  })

  ipcMain.handle('voice:speak-from-html', async (_event, { html, voice, speed } = {}) => {
    try {
      if (!html || typeof html !== 'string') throw new Error('html is required')
      const result = await speakFromHtml({ html, voice, speed })
      return { status: 'ok', ...result }
    } catch (err) {
      console.error('[IPC] voice:speak-from-html failed:', err)
      return { status: 'error', error: err.message }
    }
  })

  ipcMain.handle('voice:speak-email', async (_event, { email, voice, speed } = {}) => {
    try {
      if (!email || typeof email !== 'object') throw new Error('email object is required')
      const result = await speakEmailData(email, { voice, speed })
      return { status: 'ok', ...result }
    } catch (err) {
      console.error('[IPC] voice:speak-email failed:', err)
      return { status: 'error', error: err.message }
    }
  })

  ipcMain.handle('voice:speak-unread', async (_event, { emails, voice, speed } = {}) => {
    try {
      const result = await speakUnreadEmails(Array.isArray(emails) ? emails : [], { voice, speed })
      return { status: 'ok', ...result }
    } catch (err) {
      console.error('[IPC] voice:speak-unread failed:', err)
      return { status: 'error', error: err.message }
    }
  })

  ipcMain.handle('voice:control', async (_event, { action } = {}) => {
    try {
      const result = await ttsControl(action)
      return { status: 'ok', ...result }
    } catch (err) {
      console.error('[IPC] voice:control failed:', err)
      return { status: 'error', error: err.message }
    }
  })

  ipcMain.handle('voice:get-voices', async () => {
    try {
      const result = await getTtsVoices()
      return { status: 'ok', ...result }
    } catch (err) {
      console.error('[IPC] voice:get-voices failed:', err)
      return { status: 'error', error: err.message }
    }
  })

  ipcMain.handle('voice:get-preferences', async () => {
    try {
      const result = await getTtsPreferences()
      return { status: 'ok', ...result }
    } catch (err) {
      console.error('[IPC] voice:get-preferences failed:', err)
      return { status: 'error', error: err.message }
    }
  })

  ipcMain.handle('voice:set-preferences', async (_event, { voice, speed, pauseEnabled, pauseSeconds } = {}) => {
    try {
      const result = await setTtsPreferences({ voice, speed, pauseEnabled, pauseSeconds })
      return { status: 'ok', ...result }
    } catch (err) {
      console.error('[IPC] voice:set-preferences failed:', err)
      return { status: 'error', error: err.message }
    }
  })

  /**
   * @param {{ smtp?: object, mail: object, useGoogleOAuth?: boolean }} payload
   * If useGoogleOAuth, send via Gmail SMTP XOAUTH2 using the current Google session (no app password).
   * useGoogleOAuth 为 true 时，用当前 Google 登录态走 Gmail SMTP XOAUTH2（无需应用密码）。
   */
  ipcMain.handle('mail:smtp-send', async (_event, payload) => {
    try {
      const { smtp: partialSmtp, mail: mailIn, useGoogleOAuth } = payload || {}
      if (!mailIn || typeof mailIn !== 'object') throw new Error('mail options are required')

      const mail = { ...mailIn }

      if (useGoogleOAuth) {
        const googleAccountEmail =
          (payload && payload.googleAccountEmail && String(payload.googleAccountEmail).trim()) ||
          resolveDefaultGoogleEmail()
        if (!googleAccountEmail) {
          throw new Error('No Google account selected for OAuth send.')
        }
        await ensureGoogleSession(googleAccountEmail)
        const smtp = await getGmailSmtpTransportOptions(googleAccountEmail)
        const fromStr = mail.from != null ? String(mail.from).trim() : ''
        if (!fromStr) {
          const acc = getLinkedGmailAccount(googleAccountEmail)
          if (acc?.email) {
            mail.from = `"Audio Emailer" <${acc.email}>`
          }
        }
        const info = await smtpSendMail({ smtp, mail })
        return { status: 'ok', messageId: info.messageId, response: info.response }
      }

      const { smtp, missing, defaultFrom } = resolveSmtpConfig(
        partialSmtp && typeof partialSmtp === 'object' ? partialSmtp : {}
      )
      if (missing.length) {
        return {
          status: 'error',
          error: `Missing: ${missing.join(', ')}. Open the compose “SMTP (test)” section or set SMTP_HOST, SMTP_USER, SMTP_PASS (and optionally SMTP_PORT, SMTP_FROM) in the project .env file.`,
          missingFields: missing,
        }
      }
      const fromStr = mail.from != null ? String(mail.from).trim() : ''
      if (!fromStr && defaultFrom) {
        mail.from = defaultFrom.includes('<')
          ? defaultFrom
          : `"Audio Emailer" <${defaultFrom}>`
      }
      const info = await smtpSendMail({ smtp, mail })
      return { status: 'ok', messageId: info.messageId, response: info.response }
    } catch (err) {
      console.error('[IPC] mail:smtp-send failed:', err)
      return { status: 'error', error: err.message }
    }
  })

  ipcMain.handle('mail:smtp-verify', async (_event, partialSmtp) => {
    try {
      const p = partialSmtp && typeof partialSmtp === 'object' ? partialSmtp : {}
      if (p.useGoogleOAuth) {
        const googleAccountEmail =
          (p.googleAccountEmail && String(p.googleAccountEmail).trim()) || resolveDefaultGoogleEmail()
        if (!googleAccountEmail) throw new Error('No Google account selected for OAuth verify.')
        await ensureGoogleSession(googleAccountEmail)
        const smtp = await getGmailSmtpTransportOptions(googleAccountEmail)
        await verifySmtp(smtp)
        return { status: 'ok' }
      }

      const { smtp, missing } = resolveSmtpConfig(p)
      if (missing.length) {
        return {
          status: 'error',
          error: `Missing: ${missing.join(', ')}. Fill in the compose SMTP section or configure SMTP_* in .env.`,
          missingFields: missing,
        }
      }
      await verifySmtp(smtp)
      return { status: 'ok' }
    } catch (err) {
      console.error('[IPC] mail:smtp-verify failed:', err)
      return { status: 'error', error: err.message }
    }
  })

  // ── Gmail remote drafts ───────────────────────────────────────────────────
  // Gmail 远程草稿
  ipcMain.handle('mail:gmail-drafts-list', async (_event, { maxResults, accountEmail } = {}) => {
    try {
      const resolved =
        accountEmail && String(accountEmail).trim()
          ? String(accountEmail).trim()
          : resolveDefaultGoogleEmail()
      if (!resolved) throw new Error('No Google account selected.')
      await ensureGoogleSession(resolved)
      const { drafts } = await listGmailDrafts({ maxResults, accountEmail: resolved })
      return { status: 'ok', drafts }
    } catch (err) {
      console.error('[IPC] mail:gmail-drafts-list failed:', err)
      return { status: 'error', error: err.message }
    }
  })

  ipcMain.handle('mail:gmail-drafts-create', async (_event, payload = {}) => {
    try {
      const resolved =
        payload?.accountEmail && String(payload.accountEmail).trim()
          ? String(payload.accountEmail).trim()
          : resolveDefaultGoogleEmail()
      if (!resolved) throw new Error('No Google account selected.')
      await ensureGoogleSession(resolved)
      const draft = await createGmailDraft({ ...payload, accountEmail: resolved })
      return { status: 'ok', draft }
    } catch (err) {
      console.error('[IPC] mail:gmail-drafts-create failed:', err)
      return { status: 'error', error: err.message }
    }
  })

  ipcMain.handle('mail:gmail-drafts-update', async (_event, { draftId, ...payload } = {}) => {
    try {
      if (!draftId) throw new Error('draftId is required')
      const resolved =
        payload?.accountEmail && String(payload.accountEmail).trim()
          ? String(payload.accountEmail).trim()
          : resolveDefaultGoogleEmail()
      if (!resolved) throw new Error('No Google account selected.')
      await ensureGoogleSession(resolved)
      const draft = await updateGmailDraft(draftId, { ...payload, accountEmail: resolved })
      return { status: 'ok', draft }
    } catch (err) {
      console.error('[IPC] mail:gmail-drafts-update failed:', err)
      return { status: 'error', error: err.message }
    }
  })

  ipcMain.handle('mail:gmail-drafts-delete', async (_event, { draftId, accountEmail } = {}) => {
    try {
      if (!draftId) throw new Error('draftId is required')
      const resolved =
        accountEmail && String(accountEmail).trim()
          ? String(accountEmail).trim()
          : resolveDefaultGoogleEmail()
      if (!resolved) throw new Error('No Google account selected.')
      await ensureGoogleSession(resolved)
      await deleteGmailDraft(draftId, resolved)
      return { status: 'ok' }
    } catch (err) {
      console.error('[IPC] mail:gmail-drafts-delete failed:', err)
      return { status: 'error', error: err.message }
    }
  })

  ipcMain.handle('mail:gmail-drafts-send', async (_event, { draftId, accountEmail } = {}) => {
    try {
      if (!draftId) throw new Error('draftId is required')
      const resolved =
        accountEmail && String(accountEmail).trim()
          ? String(accountEmail).trim()
          : resolveDefaultGoogleEmail()
      if (!resolved) throw new Error('No Google account selected.')
      await ensureGoogleSession(resolved)
      const result = await sendGmailDraft(draftId, resolved)
      return { status: 'ok', ...result }
    } catch (err) {
      console.error('[IPC] mail:gmail-drafts-send failed:', err)
      return { status: 'error', error: err.message }
    }
  })

  // ── Logout ────────────────────────────────────────────────────────────────
  // 登出：撤销 token、清理本地凭证与 IMAP 连接
  ipcMain.handle('auth:logout', async (_event, { provider } = {}) => {
    const results = { google: null, yahoo: null, imap: null }
    try {
      await closeImapClient()
        .then(r => { results.imap = r })
        .catch(err => { results.imap = { closed: false, error: err.message } })

      if (!provider || provider === 'google' || provider === 'all') {
        try {
          results.google = await logoutGoogle()
        } catch (err) {
          results.google = { revoked: false, error: err.message }
        }
      }

      if (!provider || provider === 'yahoo' || provider === 'all') {
        try {
          results.yahoo = await logoutYahoo()
        } catch (err) {
          results.yahoo = { clearedEmail: null, error: err.message }
        }
      }

      // Clear Electron's browser session cookies to ensure the OAuth provider's session
      // is completely revoked and the user is prompted for credentials next time.
      try {
        const { session } = require('electron')
        await session.defaultSession.clearStorageData({ storages: ['cookies'] })
      } catch (err) {
        console.warn('[IPC] Failed to clear session cookies:', err.message)
      }

      return { status: 'ok', ...results }
    } catch (err) {
      console.error('[IPC] auth:logout failed:', err)
      return { status: 'error', error: err.message, ...results }
    }
  })

  // Load UI only after IPC is registered (avoid "No handler" if initGmailClient was slow).
  createWindow()

  void initGmailClient(resolveDefaultGoogleEmail()).catch(err => {
    console.warn('[main] initGmailClient (background):', err.message)
  })
});

app.on('window-all-closed', () => {
  app.quit()
});
