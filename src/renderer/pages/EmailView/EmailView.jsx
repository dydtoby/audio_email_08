import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import './style.css'

import {
  injectReadAlongMarkup,
  injectReadAlongMarkupFromPlainText,
  findWordIndexForChar,
  plainEmailTextToHtml,
} from '../../utils/emailReadAlongMarkup'
import {
  formatDate,
  toSortTimestamp,
  parseMailboxFromListId,
  parseUidTailFromListId,
  imapUidForGmailListRow,
  getEmailRecordKey,
  isProbablyHtml,
  buildFromFieldForTextExtraction,
} from '../../utils/emailUtils'
import {
  getDefaultAudioButtonPosition,
  normalizePauseSeconds,
  PAUSE_SECONDS_DEFAULT,
} from '../../utils/voiceUtils'

import {
  MailIcon, RefreshIcon,
  HeadphonesIcon, StarOutlineIcon, StarFilledIcon,
  CloseIcon, VoiceIcon, MinimizeIcon, MaximizeIcon,
  SendIcon, TrashIcon, CheckIcon, AttachmentIcon,
} from '../../components/icons'
import { TopBar } from './TopBar'
import { Sidebar } from './Sidebar'
import { AddEmailAccount } from './AddEmailAccount'
import { ScheduledReading } from './ScheduledReading'
import { Setting } from './Setting'
import { Compose } from './Compose'
import { ReaderActionBar } from './ReaderActionBar'
import { AudioControlBar } from './AudioControlBar'
import { MailPagination } from './MailPagination'
import {
  buildForwardBody,
  buildForwardSubject,
  buildReplyBody,
  buildReplySubject,
  createLocalDraftFromCompose,
} from './emailDrafts'

import {
  speedToRate,
  resolveSpeechVoice,
  computeReadAlongBodyPauseStarts,
  findNextSentenceStart,
} from '../../utils/voiceUtils'

// ── helpers ──────────────────────────────────────────────────────────────────

/** Match text_extraction AttachmentProcessor._build_spoken_name for read-aloud when only UI `name` exists. */
function buildSpokenLabelFromFilename(name) {
  if (!name || typeof name !== 'string') return ''
  const base = name.replace(/^.*[/\\]/, '')
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  const spoken = stem.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  const words = spoken.split(/\s+/).filter(Boolean)
  if (!words.length) return base.trim()
  if (words[0].length < 7 && words.length > 1) return `${words[0]} ${words[1]}`
  return words[0]
}

/** Prefer spoken_name (IPC / JSON); otherwise derive a short label from filename. */
function resolveAttachmentReadLabel(x) {
  if (x == null || x === '') return ''
  if (typeof x === 'string') return x.trim()
  if (typeof x === 'object') {
    const spoken = String(x.spoken_name ?? x.spokenName ?? '').trim()
    if (spoken) return spoken
    return buildSpokenLabelFromFilename(String(x.name ?? x.original_name ?? ''))
  }
  return String(x).trim()
}

/**
 * Read order (matches the spoken parts of output_email.json):
 *   receiver, sender, subject, date, body,
 *   attachments[*].spoken_name,
 *   links[*].spoken_name.
 *
 * `images` is intentionally NOT read aloud. Attachments: prefer `spoken_name`.
 * Links: prefer `spoken_name`; if missing, derive from text/label (skip data: URLs).
 */
function _spokenOnly(item) {
  if (!item || typeof item !== 'object') return ''
  return String(item.spoken_name || '').trim()
}

function _linkSpokenForPipeline(item) {
  if (!item || typeof item !== 'object') return ''
  const sn = String(item.spoken_name || '').trim()
  if (sn) return sn
  const url = String(item.url || '')
  if (url.startsWith('data:')) return ''
  const title = String(item.text || item.label || '').trim()
  if (title) return `link is ${title}`
  return ''
}

function buildReadAlongFromPipelineEmailData(emailData) {
  if (!emailData || typeof emailData !== 'object') {
    return { prefix: '', suffix: '' }
  }
  const header = []
  if (String(emailData.receiver || '').trim()) header.push(String(emailData.receiver).trim())
  if (String(emailData.sender || '').trim()) header.push(String(emailData.sender).trim())
  if (String(emailData.subject || '').trim()) header.push(String(emailData.subject).trim())
  if (String(emailData.date || '').trim()) {
    const d = String(emailData.date).trim()
    const low = d.toLowerCase()
    header.push(low.startsWith('sent on') || low.startsWith('date ') ? d : `Date ${d}`)
  }
  const prefix = header.length > 0 ? header.join('. ') + '. ' : ''

  let suffix = ''
  const attSpoken = (emailData.attachments || []).map(_spokenOnly).filter(Boolean)
  if (attSpoken.length > 0) {
    suffix += '\n\nAttachments: ' + attSpoken.join('. ') + '.'
  }
  const linkSpoken = (emailData.links || []).map(_linkSpokenForPipeline).filter(Boolean)
  if (linkSpoken.length > 0) {
    suffix += '\n\nLinks: ' + linkSpoken.join('. ') + '.'
  }
  // images are intentionally not read aloud.

  return { prefix, suffix }
}

/** Local-only compose ids from createLocalDraftFromCompose; Gmail API draft ids never use this prefix. */
function isLocalComposeDraftId(draftId) {
  return draftId != null && String(draftId).startsWith('draft-')
}

/** Map Gmail API draft (from main process) to the list row shape used by EmailView / handleEditDraft. */
/** User-facing hint when listGmailDrafts returns GCP / OAuth errors (e.g. Gmail API disabled for the project). */
function summariseGmailDraftListError(message) {
  const s = String(message || '')
  if (/Gmail API has not been used|it is disabled|gmail\.googleapis\.com\/overview/i.test(s)) {
    return '请在 Google Cloud Console 中为当前 OAuth 客户端所在项目启用「Gmail API」：打开 API 和服务 → 启用 API 和服务 → 搜索「Gmail API」→ 启用。启用后等待几分钟再重试。详细链接见下方技术详情。'
  }
  return s
}

function mapRemoteGmailDraftToUi(gmailDraft, scopeKey, mailboxEmail) {
  const toArr = Array.isArray(gmailDraft?.to) ? gmailDraft.to : []
  return {
    id: String(gmailDraft.id),
    fromName: 'Draft',
    fromEmail: mailboxEmail || '',
    to: toArr,
    subject: gmailDraft.subject || '(No subject)',
    preview: gmailDraft.preview || gmailDraft.snippet || '',
    body: String(gmailDraft.body || ''),
    date: gmailDraft.date || 'Draft',
    timeAgo: 'Draft',
    unread: false,
    starred: false,
    attachments: [],
    isDraft: true,
    scopeKey: scopeKey || 'primary',
    remoteGmailDraft: true,
    mailboxEmail: mailboxEmail || null,
  }
}

const attachmentIconSrc = './icons/Attachment.svg'
const SPEECH_UTTERANCE_PITCH = 1
const MAIL_PAGE_SIZE = 20

/**
 * Sentence pause only inside [pauseSentenceBodyStart, pauseSentenceBodyEnd) (mail body).
 * Prefix (subject / sender) is one chunk; no pause before body starts.
 * @param {{ pauseSentenceBodyStart?: number, pauseSentenceBodyEnd?: number, pauseSentenceStartsGlobal?: number[] }} session
 */
function resolveReadAlongPauseSliceEnd(session, full, sliceStart, pauseEnabled) {
  if (!pauseEnabled) return full.length
  const b0 = session.pauseSentenceBodyStart ?? 0
  const b1 = session.pauseSentenceBodyEnd ?? full.length
  const globalStarts = session.pauseSentenceStartsGlobal
  if (!Array.isArray(globalStarts)) return full.length

  if (sliceStart < b0) {
    return Math.min(b0, full.length)
  }
  if (sliceStart >= b1) {
    return full.length
  }
  const next = findNextSentenceStart(sliceStart, globalStarts)
  if (next !== null && next > sliceStart && next <= b1) {
    return next
  }
  return Math.min(b1, full.length)
}

function getPageCount(totalItems, pageSize = MAIL_PAGE_SIZE) {
  return Math.max(1, Math.ceil(totalItems / pageSize))
}

function getClampedAudioButtonPosition(position, viewportWidth, viewportHeight, buttonSize = 76) {
  const margin = 18
  const maxX = Math.max(margin, viewportWidth - buttonSize - margin)
  const maxY = Math.max(margin, viewportHeight - buttonSize - margin)

  return {
    x: Math.min(Math.max(position.x, margin), maxX),
    y: Math.min(Math.max(position.y, margin), maxY),
  }
}

function ttsPrefsPayloadFromIpc(res) {
  if (!res || typeof res !== 'object') return null
  const d = res.data
  if (
    d &&
    typeof d === 'object' &&
    (
      typeof d.voice === 'string' ||
      typeof d.speed === 'string' ||
      typeof d.pauseEnabled === 'boolean' ||
      d.pauseSeconds !== undefined
    )
  ) {
    return {
      voice: d.voice,
      speed: d.speed,
      pauseEnabled: d.pauseEnabled,
      pauseSeconds: d.pauseSeconds,
    }
  }
  if (
    typeof res.voice === 'string' ||
    typeof res.speed === 'string' ||
    typeof res.pauseEnabled === 'boolean' ||
    res.pauseSeconds !== undefined
  ) {
    return {
      voice: res.voice,
      speed: res.speed,
      pauseEnabled: res.pauseEnabled,
      pauseSeconds: res.pauseSeconds,
    }
  }
  return null
}


// ── HtmlEmailFrame ──────────────────────────────────────────────────────────
// Renders an HTML email inside a sandboxed iframe to isolate its CSS from the
// app. Auto-resizes to the content height so there's no double scrollbar.
// Forwarded ref + onIframeLoad enable read-along (per-word highlighting).
const HtmlEmailFrame = forwardRef(function HtmlEmailFrame({ html, onIframeLoad, currentWordIndex }, ref) {
  const [height, setHeight] = useState(400)

  const srcdoc = html + `<script>
    (function resize() {
      var h = document.documentElement.scrollHeight || document.body.scrollHeight;
      window.parent.postMessage({ type: 'email-frame-height', height: h }, '*');
    })();
    window.addEventListener('load', function() {
      var h = document.documentElement.scrollHeight || document.body.scrollHeight;
      window.parent.postMessage({ type: 'email-frame-height', height: h }, '*');
    });
    window.addEventListener('message', function(e) {
      if (e.data && e.data.type === 'highlight-word') {
        var wordIndex = e.data.wordIndex;
        document.querySelectorAll('.tts-word--current').forEach(function(el) {
          el.classList.remove('tts-word--current');
        });
        if (wordIndex >= 0) {
          var span = document.querySelector('[data-tts-i="' + wordIndex + '"]');
          if (span) {
            span.classList.add('tts-word--current');
            span.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        }
      }
    });
  <\/script>`

  useEffect(() => {
    function onMessage(e) {
      if (e.data && e.data.type === 'email-frame-height') {
        setHeight(e.data.height + 32)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  useEffect(() => {
    if (ref.current && ref.current.contentWindow) {
      ref.current.contentWindow.postMessage({ type: 'highlight-word', wordIndex: currentWordIndex }, '*')
    }
  }, [currentWordIndex, ref])

  return (
    <iframe
      ref={ref}
      srcDoc={srcdoc}
      onLoad={(e) => {
        const target = e.currentTarget;
        setTimeout(() => onIframeLoad?.(target), 0);
      }}
      sandbox="allow-popups allow-popups-to-escape-sandbox allow-scripts"
      style={{
        width: '100%',
        height: height,
        minHeight: '100%',
        border: 'none',
        display: 'block',
        background: '#fff',
        flex: 1,
      }}
      title="Email content"
    />
  )
})

/** Lower-case email key so IMAP `googleAcct` matches `accountEmail` / `emailsByScope` keys. */
function gmailUnreadMapKey(email) {
  return String(email || '').trim().toLowerCase()
}

function parseInboxUnreadTotal(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, Math.trunc(raw))
  const n = Number(raw)
  if (Number.isFinite(n)) return Math.max(0, Math.trunc(n))
  return null
}

// ── EmailView ─────────────────────────────────────────────────────────────────
export default function EmailView() {
  const location = useLocation()
  const navigate = useNavigate()
  const composeAttachmentInputRef = useRef(null)
  const composeImageInputRef = useRef(null)
  const composeBodyRef = useRef(null)
  const voiceMenuRef = useRef(null)
  const floatingAudioBtnRef = useRef(null)
  const emailIframeRef = useRef(null)
  const pendingSpeakRef = useRef(false)
  /** Monotonic request id for Gmail page fetches; stale responses are ignored. */
  const selectedEmailCacheRef = useRef(null)
  const gmailFetchReqSeqRef = useRef(0)
  /** Track in-flight non-silent Gmail fetches for stable loading state. */
  const gmailForegroundFetchCountRef = useRef(0)
  const audioDragStateRef = useRef({
    pointerId: null,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    moved: false,
  })
  const handleReadThisEmailRef = useRef(null)
  const selectEmailRef = useRef(null)
  const setMailPageRef = useRef(null)
  const effectiveCurrentPageRef = useRef(1)
  const effectiveTotalPagesRef = useRef(1)
  const uiSettingsHydratedRef = useRef(false)
  const playQueueRef = useRef(null)
  const readAlongUtteranceStartCharRef = useRef(0)
  const readAlongLastWordIdxRef = useRef(0)
  const readAlongSessionRef = useRef(null)
  const readAlongPauseTimerRef = useRef(null)
  const pendingQueuePlayRef = useRef(false)
  const readAlongPauseSynthOnUtteranceStartRef = useRef(false)
  const readAlongAudioPrefsRef = useRef(null)
  const startReadAlongSpeechRef = useRef(null)

  const { provider, email: accountEmail } = location.state || {}
  const effectiveProvider = provider || 'demo'
  const isGoogleProvider = effectiveProvider === 'google'
  const isDemoProvider = effectiveProvider === 'demo'

  const [emailsByScope, setEmailsByScope] = useState({})
  /** Per Google account: inbox UNSEEN from IMAP STATUS (full mailbox), not current page slice. */
  const [gmailInboxUnreadByAccount, setGmailInboxUnreadByAccount] = useState({})
  const [loading, setLoading] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [bodyCache, setBodyCache] = useState({})
  const [search, setSearch] = useState('')
  /** Gmail IMAP server search: when `emails` is non-null and matches `query`+`folder`, list uses `emails`. */
  const [gmailSearch, setGmailSearch] = useState({
    query: '',
    tab: 'All',
    folder: '',
    emails: null,
    loading: false,
    error: null,
    truncated: false,
    matchedUidCount: 0,
  })
  const [activeTab, setActiveTab] = useState('All')
  const [bulkSelected, setBulkSelected] = useState(new Set())
  const [bulkSelectedEmails, setBulkSelectedEmails] = useState({})
  const [pageInputError, setPageInputError] = useState(false)
  const [linkedAccounts, setLinkedAccounts] = useState([])
  const [scheduledTasks, setScheduledTasks] = useState([])
  const [isComposeOpen, setIsComposeOpen] = useState(false)
  const [isComposeMinimised, setIsComposeMinimised] = useState(false)
  const [composeForm, setComposeForm] = useState({ to: '', subject: '', body: '' })
  const [composeAttachments, setComposeAttachments] = useState([])
  const draftAttachmentsRef = useRef({})
  const [composeSending, setComposeSending] = useState(false)
  const [composeSendError, setComposeSendError] = useState('')
  const [showAddAccount, setShowAddAccount] = useState(false)
  const [showScheduledReading, setShowScheduledReading] = useState(false)
  const [emailsPerPage, setEmailsPerPage] = useState(20)
  const [draftsByScope, setDraftsByScope] = useState({})
  /** Set when Gmail drafts.list fails (e.g. Gmail API disabled in GCP project). */
  const [gmailDraftsSyncError, setGmailDraftsSyncError] = useState(null)
  const [editingDraftId, setEditingDraftId] = useState(null)
  const [editingDraftScope, setEditingDraftScope] = useState(null)
  const [deleteInProgress, setDeleteInProgress] = useState(false)
  const [theme, setTheme] = useState('dark')
  const [showSettings, setShowSettings] = useState(false)
  const [fontSize, setFontSize] = useState('medium')
  const [language, setLanguage] = useState('en-US')


  /** Google account used for compose / Gmail draft API (aligns with handleComposeSend). */
  function getComposeGoogleAccountEmail() {
    const scope = editingDraftScope
    if (scope && linkedAccounts.some(a => a.email === scope && a.provider === 'google')) {
      return scope
    }
    if (isGoogleProvider && accountEmail) {
      return accountEmail
    }
    return linkedAccounts.find(a => a.provider === 'google')?.email || null
  }

  function setEmailsForScope(scopeKey, emailsArray) {
    setEmailsByScope(prev => ({ ...prev, [scopeKey]: emailsArray }))
  }
  function updateEmailInAllScopes(recordKey, updater) {
    setEmailsByScope(prev => {
      const result = {}
      for (const [scope, scopeEmails] of Object.entries(prev)) {
        result[scope] = scopeEmails.map(item =>
          getEmailRecordKey(item) === String(recordKey) ? updater(item) : item
        )
      }
      return result
    })
  }

  function removeEmailFromAllScopes(recordKey) {
    setEmailsByScope(prev => {
      const result = {}
      for (const [scope, scopeEmails] of Object.entries(prev)) {
        result[scope] = (scopeEmails || []).filter(item => getEmailRecordKey(item) !== String(recordKey))
      }
      return result
    })
  }

  function removeEmailFromGmailSearchResults(recordKey) {
    setGmailSearch(prev => {
      if (prev.emails == null) return prev
      return { ...prev, emails: prev.emails.filter(e => getEmailRecordKey(e) !== String(recordKey)) }
    })
  }

  function updateEmailInGmailSearchResults(recordKey, updater) {
    setGmailSearch(prev => {
      if (!prev || !Array.isArray(prev.emails)) return prev
      return {
        ...prev,
        emails: prev.emails.map(item =>
          getEmailRecordKey(item) === String(recordKey) ? updater(item) : item
        ),
      }
    })
  }

  function setDraftsForScope(scopeKey, updater) {
    const resolvedScope = scopeKey || accountEmail || 'primary'
    setDraftsByScope(prev => {
      const currentDrafts = prev[resolvedScope] || []
      const nextDrafts = typeof updater === 'function' ? updater(currentDrafts) : updater
      return { ...prev, [resolvedScope]: nextDrafts }
    })
  }

  function removeDraftFromScope(scopeKey, draftId) {
    if (!draftId) return
    const resolvedScope = scopeKey || accountEmail || 'primary'
    setDraftsForScope(resolvedScope, currentDrafts =>
      currentDrafts.filter(item => String(item.id) !== String(draftId))
    )
  }

  /** Remove a draft id from every scope bucket (compose scope key can mismatch the Gmail account bucket). */
  function removeDraftByIdEverywhere(draftId) {
    if (!draftId) return
    setDraftsByScope(prev => {
      const next = { ...prev }
      for (const key of Object.keys(next)) {
        next[key] = (next[key] || []).filter(item => String(item.id) !== String(draftId))
      }
      return next
    })
  }

  /** Google account to use for Gmail draft API from a list/reader draft row. */
  function resolveGoogleAccountEmailForDraft(draft) {
    if (!draft) return null
    const mb = String(draft.mailboxEmail || '').trim()
    if (mb) {
      const lower = mb.toLowerCase()
      const matchesLinkedOrPrimary =
        (isGoogleProvider &&
          accountEmail &&
          String(accountEmail).trim().toLowerCase() === lower) ||
        linkedAccounts.some(
          a => a.provider === 'google' && String(a.email || '').trim().toLowerCase() === lower
        )
      if (matchesLinkedOrPrimary) return mb
    }
    const sk = draft.scopeKey
    if (sk && linkedAccounts.some(a => a.email === sk && a.provider === 'google')) return sk
    if (isGoogleProvider && accountEmail && sk === accountEmail) return accountEmail
    if (isGoogleProvider && accountEmail) return accountEmail
    return linkedAccounts.find(a => a.provider === 'google')?.email || null
  }

  function handleAddAccountSave({ email, provider }) {
    const trimmed = String(email || '').trim()
    if (!trimmed) {
      window.alert('Sign-in did not return an email address. Try again or check your network and OAuth configuration.')
      return
    }
    const norm = trimmed.toLowerCase()
    if (accountEmail && norm === String(accountEmail).trim().toLowerCase()) {
      window.alert('This address is already your primary account. To add another inbox, sign in with a different Google or Yahoo address.')
      return
    }
    if (linkedAccounts.some(a => String(a.email || '').trim().toLowerCase() === norm)) {
      window.alert('This account is already linked.')
      return
    }
    const COLORS = ['#ef56bc', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6']
    const color = COLORS[Math.floor(Math.random() * COLORS.length)]
    setLinkedAccounts(prev => [...prev, { id: Date.now(), email: trimmed, provider, color }])
    if (provider === 'google') fetchGmail({ scopeKey: trimmed })
    // TODO: Yahoo fetch — waiting for backend API (fetch emails after binding a Yahoo account)
  }

  /** Which linked Google address IMAP/Gmail API should use for the current or given scope. */
  function resolveGmailAccountEmail({ scopeKey } = {}) {
    if (scopeKey) {
      const linkedGoogle = linkedAccounts.some(a => a.email === scopeKey && a.provider === 'google')
      const primaryGoogle = Boolean(isGoogleProvider && accountEmail && scopeKey === accountEmail)
      if (linkedGoogle || primaryGoogle) return scopeKey
      return null
    }
    const scope = activeFolder.scope
    if (scope !== 'all') {
      if (linkedAccounts.some(a => a.email === scope && a.provider === 'google')) return scope
      if (isGoogleProvider && accountEmail && scope === accountEmail) return scope
      return null
    }
    if (isGoogleProvider && accountEmail) return accountEmail
    return linkedAccounts.find(a => a.provider === 'google')?.email || null
  }

  function resolveGoogleAccountEmailForRow(emailRow) {
    const mb = emailRow?.mailboxEmail && String(emailRow.mailboxEmail).trim()
    if (mb) return mb
    const parsedMb = parseMailboxFromListId(emailRow?.id)
    if (parsedMb) return parsedMb
    const scope = activeFolder.scope
    if (scope !== 'all') {
      if (linkedAccounts.some(a => a.email === scope && a.provider === 'google')) return scope
      if (isGoogleProvider && accountEmail && scope === accountEmail) return accountEmail
    }
    return resolveGmailAccountEmail({})
  }

  /** All Google IMAP identities to query when searching (deduped). In ALL ACCOUNTS, includes primary + every linked Google inbox. */
  function listGmailImapAccountEmails() {
    const out = []
    const add = (e) => {
      const t = String(e || '').trim()
      if (!t) return
      const lower = t.toLowerCase()
      if (!out.some(x => String(x).toLowerCase() === lower)) out.push(t)
    }
    if (activeFolder.scope !== 'all') {
      const one = resolveGmailAccountEmail({})
      if (one) add(one)
      return out
    }
    if (isGoogleProvider && accountEmail) add(accountEmail)
    for (const a of linkedAccounts) {
      if (a.provider === 'google' && a.email) add(a.email)
    }
    if (!out.length) {
      const fb = linkedAccounts.find(x => x.provider === 'google')?.email
      if (fb) add(fb)
    }
    return out
  }

  const [isAudioBarOpen, setIsAudioBarOpen] = useState(false)
  const [isAudioPaused, setIsAudioPaused] = useState(false)
  const [selectedVoice, setSelectedVoice] = useState('Female')
  /** When empty, use Auto (Female/Male) heuristic; otherwise a SpeechSynthesisVoice.voiceURI. */
  const [selectedVoiceUri, setSelectedVoiceUri] = useState('')
  const [speechVoices, setSpeechVoices] = useState([])
  const [isVoiceMenuOpen, setIsVoiceMenuOpen] = useState(false)
  const [selectedSpeed, setSelectedSpeed] = useState('Normal')
  const [pauseEnabled, setPauseEnabled] = useState(false)
  const [pauseSeconds, setPauseSeconds] = useState(PAUSE_SECONDS_DEFAULT)
  const pauseEnabledRef = useRef(false)
  const pauseSecondsRef = useRef(PAUSE_SECONDS_DEFAULT)
  const selectedSpeedRef = useRef('Normal')
  const hasMovedAudioButtonRef = useRef(false)
  const [audioButtonPosition, setAudioButtonPosition] = useState(() => getDefaultAudioButtonPosition())
  const [readAlongMode, setReadAlongMode] = useState(null)
  const [readAlongNonce, setReadAlongNonce] = useState(0)
  const [audioQueueProgress, setAudioQueueProgress] = useState(null)
  // Backend integration note:
  // These pagination values are UI state for the footer controls and are the
  // main place to connect real server-driven paging later.
  const [paginationState, setPaginationState] = useState({
    currentPage: 1,
    totalPages: 1,
    totalItems: 0,
    goToPage: '',
  })

  // activeFolder drives which folder is selected and what data to show.
  // { scope: 'all' | accountEmail, folder: 'inbox' | 'sent' | 'drafts' | 'trash' }
  const [activeFolder, setActiveFolder] = useState({ scope: 'all', folder: 'inbox' })
  const isInboxFolder = activeFolder.folder === 'inbox'
  const isDraftFolder = activeFolder.folder === 'drafts'

  const fetchRemoteGmailDrafts = useCallback(async () => {
    if (!window.electronAPI?.listGmailDrafts) return
    setGmailDraftsSyncError(null)
    const errorLines = []
    try {
      const scope = activeFolder.scope
      const accounts = []
      if (scope === 'all') {
        if (isGoogleProvider && accountEmail) accounts.push(String(accountEmail).trim())
        for (const a of linkedAccounts) {
          if (a.provider === 'google' && a.email) {
            const em = String(a.email).trim()
            if (em && !accounts.some(x => String(x).toLowerCase() === em.toLowerCase())) accounts.push(em)
          }
        }
        if (!accounts.length) {
          const fb = linkedAccounts.find(x => x.provider === 'google')?.email
          if (fb) accounts.push(String(fb).trim())
        }
      } else if (linkedAccounts.some(a => a.email === scope && a.provider === 'google')) {
        accounts.push(String(scope).trim())
      } else if (isGoogleProvider && accountEmail && scope === accountEmail) {
        accounts.push(String(accountEmail).trim())
      }

      for (const acct of accounts) {
        const res = await window.electronAPI.listGmailDrafts(80, acct)
        if (res?.status === 'ok') {
          const mapped = (res.drafts || []).map(d => mapRemoteGmailDraftToUi(d, acct, acct))
          setDraftsForScope(acct, prev => {
            const prevArr = Array.isArray(prev) ? prev : []
            const locals = prevArr.filter(d => d?.isDraft && isLocalComposeDraftId(d.id))
            const remoteIds = new Set(mapped.map(m => String(m.id)))
            const keepLocals = locals.filter(l => !remoteIds.has(String(l.id)))
            return [...mapped, ...keepLocals]
          })
        } else {
          const msg = res?.error || 'Unknown error'
          console.warn('[EmailView] listGmailDrafts failed, keeping existing drafts:', msg, acct)
          errorLines.push(`${acct}: ${msg}`)
        }
      }
      setGmailDraftsSyncError(errorLines.length ? errorLines.join('\n') : null)
    } catch (err) {
      console.error('[EmailView] fetchRemoteGmailDrafts:', err)
      setGmailDraftsSyncError(err?.message || String(err))
    }
  }, [activeFolder.scope, accountEmail, isGoogleProvider, linkedAccounts])

  // ── Data fetching ──────────────────────────────────────────────────────────

  // Initial load on mount
  useEffect(() => {
    setPaginationState(prev => ({ ...prev, currentPage: 1, totalPages: 1, totalItems: 0, goToPage: '' }))
    if (isGoogleProvider) fetchGmail({ page: 1 })
    else loadLocalEmails(isDemoProvider ? 'test_emails.json' : 'emails.json')
  }, [effectiveProvider])

  // Re-fetch (or clear) when the selected folder changes.
  useEffect(() => {
    const scope = activeFolder.scope
    const isPrimaryGoogleScope = isGoogleProvider &&
      (scope === 'all' || scope === (accountEmail || 'primary'))
    const isLinkedGoogleScope = linkedAccounts.some(
      a => a.provider === 'google' && a.email === scope
    )
    const isAllScope = scope === 'all'
    const hasAnyGoogle = isGoogleProvider || linkedAccounts.some(a => a.provider === 'google')

    setPaginationState(prev => ({ ...prev, currentPage: 1, totalPages: 1, totalItems: 0, goToPage: '' }))
    setActiveTab('All')

    if (activeFolder.folder === 'drafts') {
      if (isPrimaryGoogleScope || isLinkedGoogleScope || (isAllScope && hasAnyGoogle)) {
        fetchRemoteGmailDrafts()
      } else if (isAllScope) {
        loadLocalEmails(isDemoProvider ? 'test_emails.json' : 'emails.json')
      } else {
        const isLinkedYahooScope = linkedAccounts.some(a => a.email === scope && a.provider === 'yahoo')
        const isPrimaryYahooScope = !isGoogleProvider && !isDemoProvider && scope === (accountEmail || 'primary')
        if (isLinkedYahooScope || isPrimaryYahooScope) {
          // TODO: Yahoo fetch — waiting for backend API (fetch emails when switching to a Yahoo scope)
        }
        setEmailsForScope(scope, [])
      }
      return
    }

    if (isPrimaryGoogleScope || isLinkedGoogleScope || (isAllScope && hasAnyGoogle)) {
      fetchGmail({ page: 1 })
    } else if (isAllScope) {
      loadLocalEmails(isDemoProvider ? 'test_emails.json' : 'emails.json')
    } else {
      const isLinkedYahooScope = linkedAccounts.some(a => a.email === scope && a.provider === 'yahoo')
      const isPrimaryYahooScope = !isGoogleProvider && !isDemoProvider && scope === (accountEmail || 'primary')
      if (isLinkedYahooScope || isPrimaryYahooScope) {
        // TODO: Yahoo fetch — waiting for backend API (fetch emails when switching to a Yahoo scope)
      }
      setEmailsForScope(scope, [])
    }
  }, [activeFolder, linkedAccounts, fetchRemoteGmailDrafts])

  // Drop Gmail server-search hits when switching mailbox or account scope (search text can stay).
  useEffect(() => {
    setGmailSearch({
      query: '',
      tab: 'All',
      folder: '',
      emails: null,
      loading: false,
      error: null,
      truncated: false,
      matchedUidCount: 0,
    })
  }, [activeFolder.scope, activeFolder.folder])

  useEffect(() => {
    if (!search.trim() && activeTab === 'All') {
      setGmailSearch({
        query: '',
        tab: 'All',
        folder: '',
        emails: null,
        loading: false,
        error: null,
        truncated: false,
        matchedUidCount: 0,
      })
    }
  }, [search, activeTab])

  useEffect(() => {
    if (!window.electronAPI?.onMailUpdate) return
    const unsubscribe = window.electronAPI.onMailUpdate((data) => {
      console.log('[EmailView] IMAP event received:', data)
      const hasGoogle =
        isGoogleProvider || linkedAccounts.some(a => a.provider === 'google')
      // Must refresh the *current* folder: this handler closes over `fetchGmail` /
      // `activeFolder`. If deps omit `activeFolder`, after switching to Trash we
      // would still refetch Inbox here and overwrite list UIDs while the UI stays
      // on Trash — then fetchGmailBody(uid, 'trash', …) fails with "UID not found".
      if (hasGoogle) fetchGmail({ silent: true, page: paginationState.currentPage })
    })
    return () => unsubscribe && unsubscribe()
  }, [
    isGoogleProvider,
    linkedAccounts,
    paginationState.currentPage,
    activeFolder.scope,
    activeFolder.folder,
  ])

  useEffect(() => {
    // Keep the toggle pinned to bottom-right until the user intentionally drags it.
    setAudioButtonPosition(getDefaultAudioButtonPosition())

    function handleResize() {
      if (!hasMovedAudioButtonRef.current) {
        setAudioButtonPosition(getDefaultAudioButtonPosition())
        return
      }

      setAudioButtonPosition(prev =>
        getClampedAudioButtonPosition(
          prev || getDefaultAudioButtonPosition(),
          window.innerWidth,
          window.innerHeight
        )
      )
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    if (!isVoiceMenuOpen) return

    function handlePointerDown(event) {
      if (!voiceMenuRef.current?.contains(event.target)) {
        setIsVoiceMenuOpen(false)
      }
    }

    function handleEscape(event) {
      if (event.key === 'Escape') {
        setIsVoiceMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isVoiceMenuOpen])

  // 从主进程 secure store 恢复已绑定的 Google 收件箱（OAuth 已持久化；此前仅内存 linkedAccounts 导致重启后丢失）
  useEffect(() => {
    if (isDemoProvider) return
    if (!window.electronAPI?.listGoogleAccounts) return
    let cancelled = false
    const COLORS = ['#ef56bc', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6']
    const primaryNorm =
      isGoogleProvider && accountEmail ? String(accountEmail).trim().toLowerCase() : ''

    ;(async () => {
      try {
        const res = await window.electronAPI.listGoogleAccounts()
        if (cancelled || !res || res.status !== 'ok' || !Array.isArray(res.accounts)) return

        const fromStore = res.accounts
          .map((row) => (row && row.email ? String(row.email).trim() : ''))
          .filter(Boolean)
          .filter((em) => {
            if (!primaryNorm) return true
            return em.toLowerCase() !== primaryNorm
          })
          .map((email, i) => ({
            id: `google-store:${email.toLowerCase()}`,
            email,
            provider: 'google',
            color: COLORS[i % COLORS.length],
          }))

        setLinkedAccounts((prev) => {
          const seen = new Set(fromStore.map((a) => String(a.email).toLowerCase()))
          const yahooKeep = prev.filter(
            (a) =>
              a.provider === 'yahoo' &&
              a.email &&
              !seen.has(String(a.email).trim().toLowerCase())
          )
          for (const y of yahooKeep) seen.add(String(y.email).trim().toLowerCase())
          return [...fromStore, ...yahooKeep]
        })
      } catch (err) {
        console.error('[EmailView] listGoogleAccounts hydrate failed:', err)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [accountEmail, isGoogleProvider, isDemoProvider])

  // 初始化：从持久化存储读取计划列表
  useEffect(() => {
    if (window.api?.getSavedTasks) {
      window.api.getSavedTasks()
        .then(data => {
          if (Array.isArray(data)) setScheduledTasks(data)
        })
        .catch(err => console.error('Failed to load scheduled tasks:', err))
    }
  }, [])

  // 持久化：每次 scheduledTasks 变化时写入持久化存储
  useEffect(() => {
    // TODO: 后端需实现 window.api.setUserData(key, value) → 写入 Electron userData 目录下的持久化文件
    // 实现后替换为：
    // window.api.setUserData('scheduledPlans', scheduledTasks)
  }, [scheduledTasks])

  // 应用主题到 body
  useEffect(() => {
    document.body.setAttribute('data-theme', theme)
  }, [theme])

  // emailsPerPage 变化时重置到第1页
  useEffect(() => {
    setPaginationState(prev => ({ ...prev, currentPage: 1 }))
  }, [emailsPerPage])

  // Restore UI settings from Electron Store on first paint.
  useEffect(() => {
    if (!window.electronAPI?.getUiSettings) {
      uiSettingsHydratedRef.current = true
      return undefined
    }
    let cancelled = false
      ; (async () => {
        try {
          const res = await window.electronAPI.getUiSettings()
          if (cancelled) return
          const ui = res?.data
          if (!ui || typeof ui !== 'object') return
          if (ui.theme === 'light' || ui.theme === 'dark') setTheme(ui.theme)
          if (['small', 'medium', 'large'].includes(ui.fontSize)) setFontSize(ui.fontSize)
          if (typeof ui.language === 'string' && ui.language.trim()) setLanguage(ui.language)
          if ([20, 50, 100].includes(Number(ui.emailsPerPage))) setEmailsPerPage(Number(ui.emailsPerPage))
          const audio = ui.audio
          if (audio && typeof audio === 'object') {
            const rawSp = String(audio.speed || '').trim().toLowerCase()
            if (rawSp === 'slow' || rawSp === 'fast' || rawSp === 'normal') {
              setSelectedSpeed(rawSp === 'slow' ? 'Slow' : rawSp === 'fast' ? 'Fast' : 'Normal')
            }
            if (audio.voiceMode === 'Female' || audio.voiceMode === 'Male') {
              setSelectedVoice(audio.voiceMode)
            }
            if (typeof audio.voiceUri === 'string') {
              setSelectedVoiceUri(audio.voiceUri)
            }
          }
          const tts = ui.tts
          if (!tts || typeof tts !== 'object') return
          if (typeof tts.pauseEnabled === 'boolean') setPauseEnabled(tts.pauseEnabled)
          if (tts.pauseSeconds !== undefined) setPauseSeconds(normalizePauseSeconds(tts.pauseSeconds))
        } catch (err) {
          console.warn('[EmailView] restore ui settings failed:', err?.message || err)
        } finally {
          if (!cancelled) uiSettingsHydratedRef.current = true
        }
      })()
    return () => {
      cancelled = true
    }
  }, [])

  // Keep a stable list of available Web Speech voices for the voice menu.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return undefined
    const synth = window.speechSynthesis
    const refreshVoices = () => {
      const list = synth.getVoices() || []
      setSpeechVoices(
        list.map(v => ({
          voiceURI: v.voiceURI,
          name: v.name,
          lang: v.lang || '',
        }))
      )
    }
    synth.addEventListener('voiceschanged', refreshVoices)
    refreshVoices()
    return () => synth.removeEventListener('voiceschanged', refreshVoices)
  }, [])

  useEffect(() => {
    pauseEnabledRef.current = pauseEnabled
  }, [pauseEnabled])
  useEffect(() => {
    pauseSecondsRef.current = normalizePauseSeconds(pauseSeconds)
  }, [pauseSeconds])

  useEffect(() => {
    selectedSpeedRef.current = selectedSpeed
  }, [selectedSpeed])

  useEffect(() => {
    if (!window.electronAPI?.setUiSettings || !uiSettingsHydratedRef.current) return
    window.electronAPI
      .setUiSettings({
        theme,
        fontSize,
        language,
        emailsPerPage,
        audio: {
          speed: selectedSpeed,
          voiceMode: selectedVoice,
          voiceUri: selectedVoiceUri,
        },
        tts: {
          pauseEnabled,
          pauseSeconds: normalizePauseSeconds(pauseSeconds),
        },
      })
      .catch(err => console.warn('[EmailView] save ui settings failed:', err?.message || err))
  }, [theme, fontSize, language, emailsPerPage, selectedSpeed, selectedVoice, selectedVoiceUri, pauseEnabled, pauseSeconds])

  // Cancel any ongoing utterance + clear highlight when the selected email changes.
  useEffect(() => {
    window.speechSynthesis?.cancel()
    if (readAlongPauseTimerRef.current) {
      clearTimeout(readAlongPauseTimerRef.current)
      readAlongPauseTimerRef.current = null
    }
    emailIframeRef.current?.contentWindow?.postMessage({ type: 'highlight-word', wordIndex: -1 }, '*')
    setReadAlongMode(null)
    if (readAlongSessionRef.current) readAlongSessionRef.current = null
    readAlongUtteranceStartCharRef.current = 0
    readAlongLastWordIdxRef.current = 0
    pendingSpeakRef.current = false
  }, [selectedId])

  function syncReadAlongResumeOffsetFromLastWord() {
    const session = readAlongSessionRef.current
    const w = session?.wordOffsets
    if (!w?.length) return
    const li = Math.max(0, Math.min(readAlongLastWordIdxRef.current, w.length - 1))
    const row = w[li]
    if (row && typeof row.charStart === 'number') {
      readAlongUtteranceStartCharRef.current = row.charStart
    }
  }


  async function fetchGmail({ silent = false, scopeKey = null, page: pageArg } = {}) {
    const reqSeq = ++gmailFetchReqSeqRef.current
    if (!silent) {
      gmailForegroundFetchCountRef.current += 1
      setLoading(true)
    }
    try {
      const pageNum = pageArg ?? paginationState.currentPage ?? 1
      const folder = activeFolder.folder

      // ALL ACCOUNTS: fetch the same folder for every Google inbox (Sent/Trash/Inbox, etc.).
      // Previously only the primary mailbox was queried, so linked accounts kept stale rows.
      if (!scopeKey && activeFolder.scope === 'all') {
        const accounts = listGmailImapAccountEmails()
        if (!accounts.length || !window.electronAPI?.fetchGmailMessages) return
        const perPage = emailsPerPage
        const results = await Promise.all(
          accounts.map(acct =>
            window.electronAPI.fetchGmailMessages(pageNum, perPage, folder, acct)
          )
        )
        let maxTotalPages = 1
        let lastPage = pageNum
        let mergedTotalItems = 0
        for (let i = 0; i < accounts.length; i++) {
          const acct = accounts[i]
          const result = results[i]
          if (result?.status === 'ok') {
            const normalized = normaliseGmail(result.messages || [], acct)
            setEmailsForScope(acct, normalized)
            maxTotalPages = Math.max(maxTotalPages, result.pagination?.totalPages || 1)
            lastPage = result.pagination?.page || lastPage
            mergedTotalItems += Number(result.pagination?.total || 0)
            const inboxUnread = parseInboxUnreadTotal(result.inboxUnreadTotal)
            if (inboxUnread != null) {
              setGmailInboxUnreadByAccount(prev => ({
                ...prev,
                [gmailUnreadMapKey(acct)]: inboxUnread,
              }))
            }
          } else {
            setEmailsForScope(acct, [])
          }
        }
        if (reqSeq === gmailFetchReqSeqRef.current) {
          const totalItems = Math.max(0, mergedTotalItems)
          setPaginationState(prev => ({
            ...prev,
            currentPage: lastPage,
            totalPages: Math.max(getPageCount(totalItems), 1),
            totalItems,
          }))
        }
        return
      }

      const googleAcct = resolveGmailAccountEmail({ scopeKey: scopeKey || undefined })
      if (!googleAcct) {
        return
      }
      const result = await window.electronAPI?.fetchGmailMessages(
        pageNum,
        emailsPerPage,
        folder,
        googleAcct
      )
      if (result?.status === 'ok') {
        const effectiveKey = scopeKey ||
          (activeFolder.scope !== 'all'
            ? activeFolder.scope
            : (isGoogleProvider ? accountEmail : linkedAccounts.find(a => a.provider === 'google')?.email))
        const normalized = normaliseGmail(result.messages || [], effectiveKey || googleAcct)
        if (reqSeq === gmailFetchReqSeqRef.current) {
          if (effectiveKey) setEmailsForScope(effectiveKey, normalized)
        }
        const inboxUnread = parseInboxUnreadTotal(result.inboxUnreadTotal)
        if (inboxUnread != null && reqSeq === gmailFetchReqSeqRef.current) {
          setGmailInboxUnreadByAccount(prev => ({
            ...prev,
            [gmailUnreadMapKey(googleAcct)]: inboxUnread,
          }))
        }
        if (reqSeq === gmailFetchReqSeqRef.current) {
          setPaginationState(prev => ({
            ...prev,
            currentPage: result.pagination?.page || pageNum,
            totalPages: Math.max(result.pagination?.totalPages || 1, 1),
            totalItems: Math.max(0, Number(result.pagination?.total || 0)),
          }))
        }
      }
    } catch (err) {
      console.error('fetchGmail failed:', err)
    } finally {
      if (!silent) {
        gmailForegroundFetchCountRef.current = Math.max(0, gmailForegroundFetchCountRef.current - 1)
        if (gmailForegroundFetchCountRef.current === 0) setLoading(false)
      }
    }
  }

  async function loadLocalEmails(fileName = 'emails.json') {
    setLoading(true)
    try {
      const result = await window.api?.loadEmails(fileName)
      const scopeKey = activeFolder.scope
      const fixtureEmails = Array.isArray(result) ? result : (Array.isArray(result?.emails) ? result.emails : [])
      const fixtureDrafts = Array.isArray(result?.drafts) ? result.drafts : []
      const draftScopeKey = accountEmail || (scopeKey !== 'all' ? scopeKey : 'primary')

      // Backend handoff:
      // local fixture loading already supports a separate `drafts` collection.
      // A remote drafts API can plug in here by normalising provider drafts into
      // the same shape and storing them in `draftsByScope` per account.
      setEmailsForScope(scopeKey, fixtureEmails)
      if (fixtureDrafts.length > 0 || !Array.isArray(result)) {
        setDraftsForScope(draftScopeKey, fixtureDrafts)
      }
    } catch (err) {
      console.error('loadLocalEmails failed:', err)
    } finally {
      setLoading(false)
    }
  }

  function normaliseGmail(msgs, mailboxEmail) {
    const mbArg = mailboxEmail ? String(mailboxEmail).trim() : ''
    return msgs.map((m, i) => {
      const mb = mbArg || (m.accountEmail && String(m.accountEmail).trim()) || ''
      const uid = m.uid ?? i
      const row = {
        id: mb ? `${mb.toLowerCase()}::${uid}` : String(uid),
        uid,
        fromName: m.from || 'Unknown',
        fromEmail: m.from || '',
        subject: m.subject || '(No subject)',
        preview: m.snippet || '',
        body: m.body || m.snippet || '',
        date: formatDate(m.date),
        timeAgo: formatDate(m.date),
        rawDate: m.date || null,
        sortTs: toSortTimestamp(m.date),
        unread: !m.flags?.includes('\\Seen'),
        starred: !!m.flags?.includes('\\Flagged'),
        attachments: [],
        mailboxEmail: mb || null,
      }
      return row
    })
  }

  // ── Derived state ──────────────────────────────────────────────────────────

  const emails = activeFolder.scope === 'all'
    ? Object
      .values(emailsByScope)
      .flat()
      .slice()
      .sort((a, b) => {
        const ta = Number(a?.sortTs) || toSortTimestamp(a?.rawDate || a?.date)
        const tb = Number(b?.sortTs) || toSortTimestamp(b?.rawDate || b?.date)
        return tb - ta
      })
    : emailsByScope[activeFolder.scope] || []
  const drafts = activeFolder.scope === 'all'
    ? Object.values(draftsByScope).flat()
    : draftsByScope[activeFolder.scope] || []
  const activeScopeIsGmail =
    (activeFolder.scope === accountEmail && isGoogleProvider) ||
    (activeFolder.scope === 'all' &&
      (isGoogleProvider || linkedAccounts.some(a => a.provider === 'google'))) ||
    linkedAccounts.some(a => a.email === activeFolder.scope && a.provider === 'google')

  const qTrim = search.trim()
  const gmailSearchListActive =
    activeScopeIsGmail &&
    !isDraftFolder &&
    gmailSearch.tab === activeTab &&
    gmailSearch.query === qTrim &&
    gmailSearch.folder === activeFolder.folder &&
    gmailSearch.emails !== null &&
    !gmailSearch.loading

  const visibleEmails = isDraftFolder
    ? drafts
    : gmailSearchListActive
      ? gmailSearch.emails
      : emails
  const gmailServerFilteredListActive =
    gmailSearchListActive && activeScopeIsGmail && !isDraftFolder

  // Debounced IMAP search/filter across the whole current mailbox (Gmail only).
  useEffect(() => {
    if (!activeScopeIsGmail || isDraftFolder) return undefined
    const q = search.trim()
    const tabFilterMap = {
      All: 'all',
      Unread: 'unread',
      Read: 'read',
      Starred: 'starred',
    }
    const activeTabFilter = tabFilterMap[activeTab] || 'all'
    const needsServerFilter = activeTabFilter !== 'all'
    if (!q && !needsServerFilter) return undefined

    let cancelled = false
    const folder = activeFolder.folder
    const t = window.setTimeout(async () => {
      if (cancelled) return
      const accounts = listGmailImapAccountEmails()
      if (!accounts.length || !window.electronAPI?.searchGmailMessages) {
        setGmailSearch({
          query: q,
          tab: activeTab,
          folder,
          emails: [],
          loading: false,
          error: 'Search is unavailable.',
          truncated: false,
          matchedUidCount: 0,
        })
        return
      }

      setGmailSearch(prev => ({
        ...prev,
        loading: true,
        error: null,
        query: q,
        tab: activeTab,
        folder,
      }))

      try {
        const multi = accounts.length > 1
        // For tab filters (Unread/Read/Starred), load all matches from server (no cap),
        // then keep UI pagination locally so results are not limited to a fixed top slice.
        const perCap = needsServerFilter
          ? 0
          : (multi ? Math.max(35, Math.floor(210 / accounts.length)) : 150)
        const results = await Promise.all(
          accounts.map(acct => window.electronAPI.searchGmailMessages(q, folder, acct, perCap, activeTabFilter))
        )
        if (cancelled) return

        const okResults = results.filter(r => r?.status === 'ok')
        if (!okResults.length) {
          const errMsg = results.map(r => r?.error).find(Boolean) || 'Search failed.'
          setGmailSearch({
            query: q,
            tab: activeTab,
            folder,
            emails: [],
            loading: false,
            error: errMsg,
            truncated: false,
            matchedUidCount: 0,
          })
          return
        }

        let matchedUidCount = 0
        let truncated = false
        const mergedPairs = []
        for (let i = 0; i < accounts.length; i++) {
          const acct = accounts[i]
          const r = results[i]
          if (r?.status !== 'ok') continue
          matchedUidCount += Number(r.matchedUidCount) || 0
          truncated = truncated || !!r.truncated
          for (const m of r.messages || []) {
            mergedPairs.push({ m, acct })
          }
        }
        mergedPairs.sort((a, b) => {
          const da = new Date(a.m.date).getTime()
          const db = new Date(b.m.date).getTime()
          return db - da
        })
        const normalized = mergedPairs.map(({ m, acct }) => normaliseGmail([m], acct)[0])

        setGmailSearch({
          query: q,
          tab: activeTab,
          folder,
          emails: normalized,
          loading: false,
          error: null,
          truncated,
          matchedUidCount,
        })
      } catch (err) {
        if (!cancelled) {
          console.error('searchGmailMessages failed:', err)
          setGmailSearch({
            query: q,
            tab: activeTab,
            folder,
            emails: [],
            loading: false,
            error: err?.message || 'Search failed.',
            truncated: false,
            matchedUidCount: 0,
          })
        }
      }
    }, 350)

    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [
    search,
    activeTab,
    activeFolder.folder,
    activeFolder.scope,
    activeScopeIsGmail,
    isDraftFolder,
    accountEmail,
    isGoogleProvider,
    linkedAccounts,
  ])

  function scopeUsesGmailServerUnread(scope) {
    if (!scope) return false
    const sk = gmailUnreadMapKey(scope)
    if (linkedAccounts.some(a => a.provider === 'google' && gmailUnreadMapKey(a.email) === sk)) return true
    if (isGoogleProvider && accountEmail && gmailUnreadMapKey(accountEmail) === sk) return true
    return false
  }

  const unreadByScope = (() => {
    const out = {}
    for (const [scope, scopeEmails] of Object.entries(emailsByScope)) {
      const serverUnread = gmailInboxUnreadByAccount[gmailUnreadMapKey(scope)]
      if (scopeUsesGmailServerUnread(scope) && typeof serverUnread === 'number') {
        out[scope] = serverUnread
      } else {
        out[scope] = (scopeEmails || []).filter(e => e.unread).length
      }
    }
    if (isGoogleProvider && accountEmail) {
      const srv = gmailInboxUnreadByAccount[gmailUnreadMapKey(accountEmail)]
      if (typeof srv === 'number' && out[accountEmail] === undefined) {
        out[accountEmail] = srv
      }
    }
    for (const acc of linkedAccounts) {
      if (acc.provider === 'google') {
        const srv = gmailInboxUnreadByAccount[gmailUnreadMapKey(acc.email)]
        if (typeof srv === 'number' && out[acc.email] === undefined) {
          out[acc.email] = srv
        }
      }
    }
    return out
  })()

  const totalUnread = Object.values(unreadByScope).reduce((sum, n) => sum + n, 0)

  // Show real emails only when inbox is selected (backend only supports inbox)
  const scopeKey = accountEmail || 'primary'
  const linkedEmails = new Set(linkedAccounts.map(a => a.email))
  const supportedFolders = ['inbox', 'sent', 'trash', 'drafts', 'spam', 'starred', 'all']
  const showRealEmails =
    supportedFolders.includes(activeFolder.folder) &&
    (activeFolder.scope === 'all' ||
      activeFolder.scope === scopeKey ||
      linkedEmails.has(activeFolder.scope))

  const filtered = visibleEmails.filter(e => {
    const q = search.toLowerCase()
    const matchSearch =
      !q ||
      gmailSearchListActive ||
      (e.fromName || '').toLowerCase().includes(q) ||
      (e.subject || '').toLowerCase().includes(q) ||
      (e.preview || '').toLowerCase().includes(q)

    const matchTab =
      isDraftFolder ||
      activeTab === 'All' ||
      (activeTab === 'Unread' && e.unread) ||
      (activeTab === 'Read' && !e.unread) ||
      (activeTab === 'Starred' && e.starred)

    return matchSearch && matchTab
  })

  const localTotalPages = getPageCount(filtered.length, emailsPerPage)
  const effectiveTotalPages = gmailServerFilteredListActive
    ? localTotalPages
    : isDraftFolder && activeScopeIsGmail
      ? localTotalPages
      : activeScopeIsGmail && activeFolder.scope === 'all' && activeTab === 'All'
        ? getPageCount(Math.max(0, Number(paginationState.totalItems || 0)), emailsPerPage)
        : activeScopeIsGmail
          ? paginationState.totalPages
          : localTotalPages
  const effectiveCurrentPage = Math.min(paginationState.currentPage, effectiveTotalPages)
  effectiveCurrentPageRef.current = effectiveCurrentPage
  effectiveTotalPagesRef.current = effectiveTotalPages
  const effectiveEmailCount =
    activeScopeIsGmail && !isDraftFolder && activeTab === 'All' && !gmailServerFilteredListActive
      ? Math.max(0, Number(paginationState.totalItems || 0))
      : filtered.length
  const pagedFiltered =
    activeScopeIsGmail &&
      !isDraftFolder &&
      !gmailServerFilteredListActive
      ? filtered
      : filtered.slice((effectiveCurrentPage - 1) * emailsPerPage, effectiveCurrentPage * emailsPerPage)

  const selectedEmail =
    filtered.find(e => getEmailRecordKey(e) === String(selectedId)) ||
    (selectedId && selectedEmailCacheRef.current &&
      getEmailRecordKey(selectedEmailCacheRef.current) === String(selectedId)
      ? selectedEmailCacheRef.current
      : null)

  useEffect(() => {
    if (activeScopeIsGmail) return

    setPaginationState(prev => {
      const nextPage = Math.min(prev.currentPage, localTotalPages)
      if (prev.currentPage === nextPage && prev.totalPages === localTotalPages) return prev
      return { ...prev, currentPage: nextPage, totalPages: localTotalPages }
    })
  }, [activeScopeIsGmail, localTotalPages])
  const senderInitials = (selectedEmail?.fromName || 'Unknown Sender')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() || '')
    .join('') || 'U'

  useLayoutEffect(() => {
    handleReadThisEmailRef.current = handleReadThisEmail
    selectEmailRef.current = selectEmail
    setMailPageRef.current = setMailPage
  }, [handleReadThisEmail, selectEmail, setMailPage])

  // ── Read-along (per-word highlight) ────────────────────────────────────────

  const getBaseBodyHtmlForReadAlong = useCallback(() => {
    if (!selectedEmail) return ''
    const cacheKey = getEmailRecordKey(selectedEmail)
    const cached = bodyCache[cacheKey]

    if (isGoogleProvider) {
      if (!cached || cached.loading || cached.error) return ''
      const html = cached.html || (isProbablyHtml(cached.text) ? cached.text : null)
      if (html) return html
      return plainEmailTextToHtml(cached.text || '')
    }

    if (isProbablyHtml(selectedEmail.body)) {
      return selectedEmail.body
    }
    return plainEmailTextToHtml(selectedEmail.body || '')
  }, [selectedEmail, bodyCache, isGoogleProvider])

  const startReadAlongSpeech = useCallback(() => {
    const session = readAlongSessionRef.current
    if (!session?.utteranceText?.trim()) return

    const synth = window.speechSynthesis
    if (!synth) return

    const full = session.utteranceText
    const sliceStart = Math.max(0, Math.min(readAlongUtteranceStartCharRef.current ?? 0, full.length))
    let sliceEnd = full.length
    if (pauseEnabledRef.current) {
      sliceEnd = resolveReadAlongPauseSliceEnd(session, full, sliceStart, true)
    }
    const textSlice = full.slice(sliceStart, sliceEnd)
    if (!String(textSlice).trim()) {
      readAlongUtteranceStartCharRef.current = 0
      readAlongLastWordIdxRef.current = 0
      return
    }

    synth.cancel()
    if (readAlongPauseTimerRef.current) {
      clearTimeout(readAlongPauseTimerRef.current)
      readAlongPauseTimerRef.current = null
    }

    const deferPauseOnStart = readAlongPauseSynthOnUtteranceStartRef.current
    readAlongPauseSynthOnUtteranceStartRef.current = false

    const u = new SpeechSynthesisUtterance(textSlice)
    u.pitch = SPEECH_UTTERANCE_PITCH
    u.lang = typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en-US'
    const voice = resolveSpeechVoice(selectedVoiceUri, selectedVoice)
    if (voice) u.voice = voice
    u.rate = speedToRate(selectedSpeedRef.current)

    if (deferPauseOnStart) {
      u.onstart = () => {
        try {
          synth.pause()
        } catch (e) {
          console.warn('[EmailView] speechSynthesis.pause (deferred after prefs change):', e)
        }
      }
    }

    const bodyStart = session.pauseSentenceBodyStart ?? 0
    const bodyEnd = session.pauseSentenceBodyEnd ?? Infinity
    if (session.wordOffsets?.length) {
      if (sliceStart < bodyStart || sliceStart >= bodyEnd) {
        readAlongLastWordIdxRef.current = 0
        emailIframeRef.current?.contentWindow?.postMessage({ type: 'highlight-word', wordIndex: -1 }, '*')
      }
    }

    u.onboundary = e => {
      const offs = readAlongSessionRef.current?.wordOffsets
      if (!offs?.length) return
      if (typeof e.charIndex !== 'number') return
      const globalChar = sliceStart + e.charIndex
      const sess = readAlongSessionRef.current
      const b0 = sess?.pauseSentenceBodyStart ?? 0
      const b1 = sess?.pauseSentenceBodyEnd ?? Infinity
      if (globalChar < b0 || globalChar >= b1) return
      const idx = findWordIndexForChar(globalChar, offs)
      if (idx < 0) return
      readAlongLastWordIdxRef.current = idx
      emailIframeRef.current?.contentWindow?.postMessage({ type: 'highlight-word', wordIndex: idx }, '*')
    }

    u.onend = () => {
      const endChar = sliceEnd
      if (pauseEnabledRef.current && endChar < full.length) {
        readAlongUtteranceStartCharRef.current = endChar
        const bodyStart = session.pauseSentenceBodyStart ?? 0
        const bodyEnd = session.pauseSentenceBodyEnd ?? full.length
        const skipDelayAfterPrefix =
          bodyStart > 0 && endChar === bodyStart
        const skipDelayAfterBodyIntoAttachment =
          endChar === bodyEnd && endChar < full.length
        const delayMs =
          skipDelayAfterPrefix || skipDelayAfterBodyIntoAttachment
            ? 0
            : Math.max(0, normalizePauseSeconds(pauseSecondsRef.current) * 1000)
        readAlongPauseTimerRef.current = setTimeout(() => {
          readAlongPauseTimerRef.current = null
          startReadAlongSpeechRef.current?.()
        }, delayMs)
      } else {
        emailIframeRef.current?.contentWindow?.postMessage({ type: 'highlight-word', wordIndex: -1 }, '*')
        readAlongUtteranceStartCharRef.current = 0
        readAlongLastWordIdxRef.current = 0
        const queue = playQueueRef.current
        if (queue && !queue.awaitingNextPage && queue.index + 1 < queue.emails.length) {
          queue.index += 1
          syncAudioQueueProgress(queue)
          pendingQueuePlayRef.current = true
          selectEmailRef.current?.(queue.emails[queue.index])
        } else if (queue?.mode === 'unread' &&
                   queue && queue.index + 1 < queue.total &&
                   effectiveCurrentPageRef.current < effectiveTotalPagesRef.current) {
          playQueueRef.current = {
            ...queue,
            awaitingNextPage: true,
          }
          setMailPageRef.current?.(effectiveCurrentPageRef.current + 1)
        } else {
          playQueueRef.current = null
          syncAudioQueueProgress(null)
          setIsAudioPaused(true)
        }
      }
    }

    u.onerror = ev => {
      const err = String(ev?.error || '')
      if (/cancel|interrupt/i.test(err)) return
      emailIframeRef.current?.contentWindow?.postMessage({ type: 'highlight-word', wordIndex: -1 }, '*')
      readAlongUtteranceStartCharRef.current = 0
      readAlongLastWordIdxRef.current = 0
      setIsAudioPaused(true)
    }

    synth.speak(u)
    setIsAudioPaused(deferPauseOnStart)
  }, [selectedVoice, selectedVoiceUri])

  useEffect(() => { startReadAlongSpeechRef.current = startReadAlongSpeech }, [startReadAlongSpeech])

  useEffect(() => {
    if (!pendingQueuePlayRef.current) return
    const queue = playQueueRef.current
    if (!queue || queue.awaitingNextPage) return
    const expected = queue.emails[queue.index]
    if (!expected) return
    if (String(selectedId) !== String(getEmailRecordKey(expected))) return
    if (isGoogleProvider && imapUidForGmailListRow(expected) != null) {
      const cached = bodyCache[getEmailRecordKey(expected)]
      if (!cached || cached.loading || cached.error) return
    }
    pendingQueuePlayRef.current = false
    handleReadThisEmailRef.current?.()
  }, [selectedId, bodyCache, isGoogleProvider])

  useEffect(() => {
    const queue = playQueueRef.current
    if (!queue?.awaitingNextPage) return
    if (loading) return
    const unreadEmails = pagedFiltered.filter(e => e.unread)
    if (unreadEmails.length === 0) {
      // 本页无未读 — 继续翻下一页；所有页扫完则停止
      if (effectiveCurrentPageRef.current < effectiveTotalPagesRef.current) {
        setMailPageRef.current?.(effectiveCurrentPageRef.current + 1)
      } else {
        playQueueRef.current = null
        syncAudioQueueProgress(null)
        setIsAudioPaused(true)
      }
      return
    }
    playQueueRef.current = {
      ...queue,
      emails: [...queue.emails, ...unreadEmails],
      index: queue.index + 1,
      mode: 'unread',
      awaitingNextPage: false,
      total: queue.total,
    }
    syncAudioQueueProgress(playQueueRef.current)
    pendingQueuePlayRef.current = true
    selectEmailRef.current?.(playQueueRef.current.emails[playQueueRef.current.index])
  }, [pagedFiltered, loading])

  // Apply Speed/Voice chip changes to an active read-along without clicking "Read this mail" again.
  useEffect(() => {
    const cur = {
      speed: selectedSpeed,
      voice: selectedVoice,
      uri: selectedVoiceUri,
      pauseEnabled,
      pauseSeconds: normalizePauseSeconds(pauseSeconds),
    }
    const prev = readAlongAudioPrefsRef.current
    readAlongAudioPrefsRef.current = cur
    if (!prev) return

    const changed =
      prev.speed !== cur.speed ||
      prev.voice !== cur.voice ||
      prev.uri !== cur.uri ||
      prev.pauseEnabled !== cur.pauseEnabled ||
      prev.pauseSeconds !== cur.pauseSeconds
    if (!changed) return
    if (!readAlongSessionRef.current?.utteranceText?.trim()) return

    const synth = window.speechSynthesis
    if (!synth) return

    const speaking = synth.speaking || synth.pending
    const paused = typeof synth.paused === 'boolean' && synth.paused
    const waitingBetweenSentences = !!readAlongPauseTimerRef.current
    if (!speaking && !paused && !waitingBetweenSentences) return

    const schedule = typeof queueMicrotask === 'function' ? queueMicrotask : fn => setTimeout(fn, 0)

    if (waitingBetweenSentences && !speaking && !paused) {
      clearTimeout(readAlongPauseTimerRef.current)
      readAlongPauseTimerRef.current = null
      schedule(() => {
        startReadAlongSpeech()
      })
      return
    }

    syncReadAlongResumeOffsetFromLastWord()
    emailIframeRef.current?.contentWindow?.postMessage({ type: 'highlight-word', wordIndex: -1 }, '*')
    synth.cancel()

    if (paused) {
      readAlongPauseSynthOnUtteranceStartRef.current = true
      setIsAudioPaused(true)
      schedule(() => {
        startReadAlongSpeech()
      })
      return
    }

    schedule(() => {
      startReadAlongSpeech()
    })
  }, [selectedSpeed, selectedVoice, selectedVoiceUri, pauseEnabled, pauseSeconds, startReadAlongSpeech])

  const handleEmailIframeLoad = useCallback(() => {
    if (!pendingSpeakRef.current) return
    if (!readAlongSessionRef.current?.utteranceText) return
    pendingSpeakRef.current = false
    startReadAlongSpeech()
  }, [startReadAlongSpeech, readAlongSessionRef])

  // ── Handlers ───────────────────────────────────────────────────────────────

  function toggleBulk(id, checked, email) {
    setBulkSelected(prev => {
      const next = new Set(prev)
      checked ? next.add(String(id)) : next.delete(String(id))
      return next
    })
    setBulkSelectedEmails(prev => {
      if (checked) return { ...prev, [String(id)]: email }
      const next = { ...prev }
      delete next[String(id)]
      return next
    })
  }

  function handleEditDraft(draft) {
    // Backend handoff:
    // when provider drafts are fetched, clicking a draft should pass the remote
    // draft identifier into `editingDraftId` so save/send/discard can call the
    // correct update or delete endpoint instead of creating a new local draft.
    setSelectedId(null)
    setEditingDraftId(draft.id)
    setEditingDraftScope(
      draft.mailboxEmail ||
      (draft.scopeKey && linkedAccounts.some(a => a.email === draft.scopeKey && a.provider === 'google')
        ? draft.scopeKey
        : null) ||
      draft.scopeKey ||
      getDefaultComposeScopeKey()
    )
    setComposeForm({
      to: Array.isArray(draft.to) ? draft.to.join(', ') : (draft.to || ''),
      subject: draft.subject === '(No subject)' ? '' : (draft.subject || ''),
      body: draft.body || '',
    })
    setComposeAttachments(draftAttachmentsRef.current[draft.id] || [])
    openCompose()

    window.setTimeout(() => {
      composeBodyRef.current?.focus()
      composeBodyRef.current?.setSelectionRange(0, 0)
    }, 0)
  }

  async function selectEmail(email) {
    selectedEmailCacheRef.current = email
    const recordKey = getEmailRecordKey(email)
    console.log(`[EmailView] Selecting email: ${recordKey}`)
    if (email.isDraft || isDraftFolder) {
      handleEditDraft(email)
      return
    }
    setSelectedId(recordKey)
    setIsAudioPaused(true)
    const wasUnread = !!email.unread
    updateEmailInAllScopes(recordKey, item => ({ ...item, unread: false }))

    const markGmailAsReadOnServerIfNeeded = () => {
      if (!wasUnread) return
      const googleAcct = resolveGoogleAccountEmailForRow(email)
      if (!googleAcct) return
      const uidForImap = imapUidForGmailListRow(email)
      window.electronAPI
        .updateGmailFlags(uidForImap, activeFolder.folder, { add: ['\\Seen'] }, googleAcct)
        .catch(err => console.error('[EmailView] Failed to mark as read:', err))
      if (activeFolder.folder === 'inbox') {
        const unreadKey = gmailUnreadMapKey(googleAcct)
        setGmailInboxUnreadByAccount(prev => {
          if (typeof prev[unreadKey] !== 'number') return prev
          const next = Math.max(0, prev[unreadKey] - 1)
          return { ...prev, [unreadKey]: next }
        })
      }
    }

    const googleAcctBody = resolveGoogleAccountEmailForRow(email)
    if (!googleAcctBody) {
      return
    }
    const cachedBody = bodyCache[recordKey]
    if (cachedBody?.loading) return
    if (cachedBody?.html || cachedBody?.text) {
      markGmailAsReadOnServerIfNeeded()
      return
    }

    setBodyCache(prev => ({ ...prev, [recordKey]: { loading: true } }))
    try {
      const uidForImap = imapUidForGmailListRow(email)
      const folderToUse = email.folder || activeFolder.folder
      const result = await window.electronAPI.fetchGmailBody(
        uidForImap,
        folderToUse,
        googleAcctBody
      )
      if (result?.status === 'ok') {
        const fetchedAttachments = Array.isArray(result.attachments)
          ? result.attachments.map((att) => ({
            name: att?.name || 'attachment',
            size: att?.size || '',
          }))
          : []
        setBodyCache(prev => ({
          ...prev,
          [recordKey]: {
            loading: false,
            text: result.text,
            html: result.html,
            attachments: fetchedAttachments,
          },
        }))
        if (fetchedAttachments.length > 0) {
          updateEmailInAllScopes(recordKey, item => ({ ...item, attachments: fetchedAttachments }))
          updateEmailInGmailSearchResults(recordKey, item => ({ ...item, attachments: fetchedAttachments }))
        }
        markGmailAsReadOnServerIfNeeded()
      } else {
        setBodyCache(prev => ({ ...prev, [recordKey]: { loading: false, error: result?.error || 'Failed to load body' } }))
      }
    } catch (err) {
      console.error('[EmailView] fetchGmailBody threw:', err)
      setBodyCache(prev => ({ ...prev, [recordKey]: { loading: false, error: err.message } }))
    }
  }

  function handleRefresh() {
    if (isDraftFolder) return

    if (activeScopeIsGmail) {
      fetchGmail({ page: effectiveCurrentPage })
    } else {
      // TODO: Yahoo fetch — waiting for backend API (fetch emails on refresh for Yahoo scope)
      loadLocalEmails(isDemoProvider ? 'test_emails.json' : 'emails.json')
    }
  }

  async function handleDownloadAttachment(file) {
    console.log('[EmailView] download click:', file)
    if (!file?.name) {
      console.warn('[EmailView] download cancelled: no file name')
      return
    }
    const email = selectedEmail
    if (!email) {
      console.warn('[EmailView] download cancelled: no selected email')
      return
    }
    const downloader = window.electronAPI?.downloadGmailAttachment
    if (typeof downloader !== 'function') {
      console.warn(
        '[EmailView] electronAPI.downloadGmailAttachment is missing. Restart Electron so preload reloads.'
      )
      window.alert('Download not available yet. Please restart the app and try again.')
      return
    }
    const googleAcct = resolveGoogleAccountEmailForRow(email)
    if (!googleAcct) {
      console.warn('[EmailView] download cancelled: cannot resolve Google account for email', email)
      window.alert('No Google account linked for this email. Please sign in with Google first.')
      return
    }

    try {
      const uidForImap = imapUidForGmailListRow(email)
      const attachmentName = String(file.original_name || file.name || '').trim()
      console.log('[EmailView] download invoking IPC', {
        uidForImap,
        folder: activeFolder.folder,
        googleAcct,
        attachmentName,
      })
      const res = await downloader(
        uidForImap,
        activeFolder.folder,
        googleAcct,
        attachmentName
      )
      console.log('[EmailView] download IPC result:', res)
      if (res?.status === 'error') {
        console.error('[EmailView] download attachment failed:', res.error)
        window.alert(`Download failed: ${res.error || 'unknown error'}`)
      }
    } catch (err) {
      console.error('[EmailView] download attachment threw:', err)
      window.alert(`Download failed: ${err?.message || err}`)
    }
  }

  function toggleAudioBar() {
    setIsAudioBarOpen(prev => !prev)
  }

  function getAudioButtonBounds() {
    const rect = floatingAudioBtnRef.current?.getBoundingClientRect()
    return {
      width: rect?.width || 76,
      height: rect?.height || 76,
      margin: 18,
    }
  }

  function resetAudioDragState() {
    audioDragStateRef.current = {
      pointerId: null,
      startX: 0,
      startY: 0,
      originX: 0,
      originY: 0,
      moved: false,
    }
  }

  function handleAudioButtonPointerDown(event) {
    if (audioButtonPosition == null) return

    audioDragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: audioButtonPosition.x,
      originY: audioButtonPosition.y,
      moved: false,
    }

    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handleAudioButtonPointerMove(event) {
    const dragState = audioDragStateRef.current
    if (dragState.pointerId !== event.pointerId) return

    const deltaX = event.clientX - dragState.startX
    const deltaY = event.clientY - dragState.startY
    const nextX = dragState.originX + deltaX
    const nextY = dragState.originY + deltaY
    const movedEnough = Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4

    if (movedEnough && !dragState.moved) {
      hasMovedAudioButtonRef.current = true
      audioDragStateRef.current = { ...dragState, moved: true }
    }

    const { width, height, margin } = getAudioButtonBounds()
    const maxX = Math.max(margin, window.innerWidth - width - margin)
    const maxY = Math.max(margin, window.innerHeight - height - margin)

    setAudioButtonPosition({
      x: Math.min(Math.max(nextX, margin), maxX),
      y: Math.min(Math.max(nextY, margin), maxY),
    })
  }

  function handleAudioButtonPointerUp(event) {
    const dragState = audioDragStateRef.current
    if (dragState.pointerId !== event.pointerId) return

    event.currentTarget.releasePointerCapture(event.pointerId)

    if (!dragState.moved) {
      toggleAudioBar()
    }

    resetAudioDragState()
  }

  function handleAudioButtonPointerCancel(event) {
    const dragState = audioDragStateRef.current
    if (dragState.pointerId !== event.pointerId) return

    resetAudioDragState()
  }

  function toggleVoiceMenu() {
    setIsVoiceMenuOpen(prev => !prev)
  }

  function selectSpeedOption(speed) {
    setSelectedSpeed(speed)
  }

  function selectVoiceOption(opt) {
    if (opt?.type === 'auto') {
      setSelectedVoice(opt.gender || 'Female')
      setSelectedVoiceUri('')
    } else if (opt?.type === 'voice' && opt.voiceURI) {
      setSelectedVoiceUri(opt.voiceURI)
    }
    setIsVoiceMenuOpen(false)
  }


  function toggleAudioPaused() {
    const synth = window.speechSynthesis
    if (!synth) {
      setIsAudioPaused(p => !p)
      return
    }

    const hasSession = !!readAlongSessionRef.current?.utteranceText?.trim()
    const supportsPause = typeof synth.pause === 'function' && typeof synth.resume === 'function'
    const isSynthPaused = supportsPause && typeof synth.paused === 'boolean' && synth.paused

    // Read-along: user clicked pause during the inter-sentence delay — cancel the pending timer and stay paused.
    if (hasSession && !isAudioPaused && !synth.speaking && !synth.pending && readAlongPauseTimerRef.current) {
      clearTimeout(readAlongPauseTimerRef.current)
      readAlongPauseTimerRef.current = null
      setIsAudioPaused(true)
      return
    }

    // Read-along: engine idle but UI paused — replay from saved offset (pause / end / cancel).
    if (hasSession && !synth.speaking && !synth.pending && isAudioPaused) {
      if (emailIframeRef.current?.contentDocument) {
        startReadAlongSpeech()
        setIsAudioPaused(false)
      }
      return
    }

    if (hasSession && supportsPause && synth.speaking && !isSynthPaused) {
      try {
        synth.pause()
      } catch (e) {
        console.warn('[EmailView] speechSynthesis.pause failed:', e)
      }
      syncReadAlongResumeOffsetFromLastWord()
      setIsAudioPaused(true)
      return
    }

    if (hasSession && supportsPause && isSynthPaused) {
      try {
        synth.resume()
      } catch (e) {
        console.warn('[EmailView] speechSynthesis.resume failed:', e)
      }
      setIsAudioPaused(false)
      return
    }

    setIsAudioPaused(p => !p)
  }

  // Read-along: Web Speech utterance + iframe word spans stay aligned via
  // injectReadAlongMarkup. Primary path: mail HTML → Main IPC → Flask html2text →
  // plain body → injectReadAlongMarkupFromPlainText → SpeechSynthesis.
  // Fallback: client-side injectReadAlongMarkup(base) if IPC missing or extract fails.
  // 启动逐字高亮：优先经 extractEmailFromHtml（后端 html2text）得到正文，再注入
  // tts-word；失败则退回对原始 HTML 的直接注入。
  async function handleReadThisEmail() {
    if (!selectedEmail) return
    if (!playQueueRef.current || playQueueRef.current.total < 2) {
      setAudioQueueProgress(null)
    }
    const base = getBaseBodyHtmlForReadAlong()
    if (!base.trim()) {
      console.warn('[EmailView] Read aloud: body not ready or empty')
      return
    }

    let html = ''
    let bodyText = ''
    let wordOffsets = []
    /** @type {{ attachments?: Array<{ spoken_name?: string, original_name?: string }> } | null} */
    let ipcEmailData = null

    const extract = window.electronAPI?.extractEmailFromHtml
    const extractPayload = {
      html: base,
      from: buildFromFieldForTextExtraction(selectedEmail),
      to: String(
        selectedEmail.to || selectedEmail.mailboxEmail || accountEmail || '',
      ).trim(),
      subject: String(selectedEmail.subject || '')
        .replace(/^\(No subject\)$/i, '')
        .trim(),
      date: String(selectedEmail.rawDate || selectedEmail.date || '').trim(),
      uid: selectedEmail.uid,
      attachment: selectedEmail.attachments,
      attachments: selectedEmail.attachments,
    }

    // Always render the original email HTML in the iframe (preserve layout, fonts,
    // images). Read-along word spans are injected into the original HTML via
    // injectReadAlongMarkup(base). The pipeline result is used ONLY for the
    // utterance metadata (receiver / sender / subject / date) and the
    // attachments / links / images spoken_name suffix — never to replace the
    // visual body with html2text plain text.
    {
      const injected = injectReadAlongMarkup(base)
      html = injected.html
      bodyText = injected.utteranceText
      wordOffsets = injected.wordOffsets
    }

    if (typeof extract === 'function') {
      try {
        const res = await extract(extractPayload)
        if (res?.status === 'ok' && res.email_data && typeof res.email_data === 'object') {
          ipcEmailData = res.email_data
          console.info(
            '[EmailView] read-along: 使用 pipeline / output_email.json 结构（receiver→sender→subject→date→body→attachments→links；images 不朗读）',
            {
              hasReceiver: !!ipcEmailData.receiver,
              hasSender: !!ipcEmailData.sender,
              hasSubject: !!ipcEmailData.subject,
              date: ipcEmailData.date || '',
              attachments: (ipcEmailData.attachments || []).length,
              links: (ipcEmailData.links || []).length,
            },
          )
        } else if (res?.status === 'error') {
          console.warn(
            '[EmailView] extractEmailFromHtml 失败（仍按原邮件 HTML 朗读，但元数据 / spoken_name 顺序缺失）:',
            res.error,
            '请确认已启动 text_extraction（默认 http://127.0.0.1:5000/process-email）。',
          )
        }
      } catch (err) {
        console.warn(
          '[EmailView] html2text / pipeline 请求异常（仍按原邮件 HTML 朗读，但元数据 / spoken_name 顺序缺失）:',
          err,
          '请确认已启动 text_extraction（默认 http://127.0.0.1:5000）。',
        )
      }
    } else {
      console.warn(
        '[EmailView] extractEmailFromHtml 不可用：当前环境未暴露 electronAPI（或非 Electron），无法使用 pipeline / output_email.json 元数据。',
      )
    }

    if (!bodyText.trim()) return

    let readSuffix = ''
    let prefix = ''

    if (ipcEmailData) {
      const built = buildReadAlongFromPipelineEmailData(ipcEmailData)
      prefix = built.prefix
      readSuffix = built.suffix
    } else {
      const uiLabels = (selectedEmail.attachments || []).map(resolveAttachmentReadLabel).filter(Boolean)
      const cacheKey = getEmailRecordKey(selectedEmail)
      const cachedAtt = bodyCache[cacheKey]?.attachments
      const cacheLabels = Array.isArray(cachedAtt)
        ? cachedAtt.map(resolveAttachmentReadLabel).filter(Boolean)
        : []
      const attForSuffix = uiLabels.length > 0 ? uiLabels : cacheLabels
      if (attForSuffix.length > 0) {
        readSuffix = '\n\nAttachments: ' + attForSuffix.join(', ') + '.'
      }
      const senderPrefix = selectedEmail.fromName ? 'From ' + selectedEmail.fromName + '. ' : ''
      prefix = (selectedEmail.subject ? selectedEmail.subject + '. ' : '') + senderPrefix
    }
    const utteranceText = prefix + bodyText + readSuffix
    const shiftedWordOffsets = prefix.length > 0
      ? wordOffsets.map(w => ({ ...w, charStart: w.charStart + prefix.length, charEnd: w.charEnd + prefix.length }))
      : wordOffsets

    const prefixLen = prefix.length
    const pauseSentenceBodyStart = prefixLen
    const pauseSentenceBodyEnd = prefixLen + bodyText.length
    const pauseSentenceStartsGlobal = computeReadAlongBodyPauseStarts(bodyText).map(s => prefixLen + s)
    const emailKey = getEmailRecordKey(selectedEmail)
    readAlongUtteranceStartCharRef.current = 0
    readAlongLastWordIdxRef.current = 0
    readAlongSessionRef.current = {
      utteranceText,
      wordOffsets: shiftedWordOffsets,
      pauseSentenceBodyStart,
      pauseSentenceBodyEnd,
      pauseSentenceStartsGlobal,
    }
    pendingSpeakRef.current = true
    setReadAlongNonce(n => n + 1)
    setReadAlongMode({ emailKey, markedHtml: html, utteranceText, wordOffsets: shiftedWordOffsets })
    setIsAudioBarOpen(true)
    setIsAudioPaused(false)
  }

  // Backend integration note:
  // This is the reader-panel star action hook. Replace or extend this local
  // optimistic toggle with the real starred API call.
  function handleToggleSelectedEmailStar(emailArg) {
    const emailToToggle =
      emailArg && typeof emailArg === 'object' && (emailArg.uid != null || emailArg.id != null)
        ? emailArg
        : selectedEmail
    if (!emailToToggle) return

    const recordKey = getEmailRecordKey(emailToToggle)
    const isCurrentlyStarred = !!emailToToggle.starred

    updateEmailInAllScopes(recordKey, email => ({ ...email, starred: !isCurrentlyStarred }))

    const googleAcct = resolveGoogleAccountEmailForRow(emailToToggle)
    if (googleAcct && window.electronAPI?.updateGmailFlags) {
      const changes = isCurrentlyStarred ? { remove: ['\\Flagged'] } : { add: ['\\Flagged'] }
      const uidForImap = imapUidForGmailListRow(emailToToggle)
      window.electronAPI
        .updateGmailFlags(uidForImap, activeFolder.folder, changes, googleAcct)
        .catch(err => console.error('[EmailView] Failed to toggle star:', err))
    }
    if (isCurrentlyStarred && gmailSearchListActive && activeTab === 'Starred') {
      removeEmailFromGmailSearchResults(recordKey)
    }
  }

  async function deleteDraftByRow(draft) {
    if (!draft || deleteInProgress) return
    if (!window.confirm('Delete this draft?')) return
    setDeleteInProgress(true)
    try {
      const googleAcct = resolveGoogleAccountEmailForDraft(draft)
      const id = draft.id
      if (googleAcct && id && !isLocalComposeDraftId(id) && window.electronAPI?.deleteGmailDraft) {
        const res = await window.electronAPI.deleteGmailDraft(String(id), googleAcct)
        if (res?.status !== 'ok') throw new Error(res?.error || 'Failed to delete draft on server.')
      }
      if (String(editingDraftId) === String(id)) {
        resetComposeEditor()
        closeCompose()
      }
      removeDraftByIdEverywhere(id)
      const recordKey = getEmailRecordKey(draft)
      setBodyCache(prev => {
        const next = { ...prev }
        delete next[recordKey]
        return next
      })
      setBulkSelected(prev => {
        const n = new Set(prev)
        n.delete(String(id))
        return n
      })
      if (String(selectedId) === String(recordKey)) setSelectedId(null)
    } catch (err) {
      console.error('[EmailView] deleteDraftByRow:', err)
      window.alert(err?.message || 'Failed to delete draft.')
    } finally {
      setDeleteInProgress(false)
    }
  }

  async function handleDeleteSelectedEmail() {
    if (!selectedEmail || deleteInProgress) return
    if (selectedEmail.isDraft) {
      await deleteDraftByRow(selectedEmail)
      return
    }

    const recordKey = getEmailRecordKey(selectedEmail)
    const uid = imapUidForGmailListRow(selectedEmail)

    const finishLocalRemove = () => {
      removeEmailFromAllScopes(recordKey)
      removeEmailFromGmailSearchResults(recordKey)
      setBodyCache(prev => {
        const next = { ...prev }
        delete next[recordKey]
        return next
      })
      setBulkSelected(prev => {
        const n = new Set(prev)
        n.delete(String(selectedEmail.id))
        return n
      })
      setSelectedId(null)
      window.speechSynthesis?.cancel()
      const _queue7a = playQueueRef.current
      if (_queue7a && getEmailRecordKey(_queue7a.emails[_queue7a.index] ?? {}) === recordKey) {
        if (_queue7a.index + 1 < _queue7a.emails.length) {
          _queue7a.index += 1
          syncAudioQueueProgress(_queue7a)
          pendingQueuePlayRef.current = true
          selectEmailRef.current?.(_queue7a.emails[_queue7a.index])
        } else {
          playQueueRef.current = null
          syncAudioQueueProgress(null)
          pendingQueuePlayRef.current = false
        }
      }
      setReadAlongMode(null)
      readAlongSessionRef.current = null
    }

    if (activeScopeIsGmail) {
      if (uid == null || !window.electronAPI?.moveGmailMessage) {
        window.alert('Delete is not available for this message.')
        return
      }
      const googleAcct = resolveGoogleAccountEmailForRow(selectedEmail)
      if (!googleAcct) {
        window.alert('No Google account is associated with this message.')
        return
      }
      const folder = activeFolder.folder
      const inTrash = folder === 'trash'

      if (inTrash) {
        if (!window.confirm('Permanently delete this message? This cannot be undone.')) return
        if (!window.electronAPI.expungeGmailMessage) {
          window.alert('Permanent delete is not available.')
          return
        }
        setDeleteInProgress(true)
        try {
          const res = await window.electronAPI.expungeGmailMessage(uid, 'trash', googleAcct)
          if (res?.status !== 'ok') throw new Error(res?.error || 'Failed to delete message.')
          finishLocalRemove()
        } catch (err) {
          console.error('[EmailView] expungeGmailMessage:', err)
          window.alert(err?.message || 'Failed to delete message.')
        } finally {
          setDeleteInProgress(false)
        }
        return
      }

      setDeleteInProgress(true)
      try {
        const res = await window.electronAPI.moveGmailMessage(uid, folder, 'trash', googleAcct)
        if (res?.status !== 'ok') throw new Error(res?.error || 'Could not move message to Trash.')
        if (folder === 'inbox' && selectedEmail.unread) {
          const unreadKey = gmailUnreadMapKey(googleAcct)
          setGmailInboxUnreadByAccount(prev => {
            if (typeof prev[unreadKey] !== 'number') return prev
            return { ...prev, [unreadKey]: Math.max(0, prev[unreadKey] - 1) }
          })
        }
        finishLocalRemove()
      } catch (err) {
        console.error('[EmailView] moveGmailMessage:', err)
        window.alert(err?.message || 'Failed to delete message.')
      } finally {
        setDeleteInProgress(false)
      }
      return
    }

    if (!window.confirm('Remove this message from the list? (Demo / offline mail is not deleted on a server.)')) return
    finishLocalRemove()
  }

  // Backend integration note:
  // These handlers now drive both local pagination and Gmail page requests.
  function setMailPage(nextPage) {
    const clampedPage = Math.min(Math.max(nextPage, 1), effectiveTotalPages)

    setPaginationState(prev => ({
      ...prev,
      currentPage: clampedPage,
      goToPage: '',
    }))

    if (activeScopeIsGmail && !gmailServerFilteredListActive) {
      fetchGmail({ page: clampedPage })
    }
  }

  function handlePreviousPage() {
    setMailPage(effectiveCurrentPage - 1)
  }

  function handleNextPage() {
    setMailPage(effectiveCurrentPage + 1)
  }

  function handleGoToPageChange(value) {
    setPageInputError(false)
    setPaginationState(prev => ({
      ...prev,
      goToPage: value.replace(/[^\d]/g, '').slice(0, 3),
    }))
  }

  function handleGoToPageSubmit() {
    const parsedPage = Number.parseInt(paginationState.goToPage, 10)
    if (!Number.isFinite(parsedPage) || parsedPage < 1 || parsedPage > effectiveTotalPages) {
      setPageInputError(true)
      return
    }
    setPageInputError(false)
    setMailPage(parsedPage)
  }

  function syncAudioQueueProgress(queueArg = playQueueRef.current) {
    const queue = queueArg
    if (!queue || typeof queue.total !== 'number' || queue.total < 2) {
      setAudioQueueProgress(null)
      return
    }

    const current = Math.max(1, Math.min(queue.total, Math.max(queue.index, 0) + 1))
    setAudioQueueProgress({ current, total: queue.total })
  }

  function resetQueuePlaybackState() {
    window.speechSynthesis?.cancel()
    if (readAlongPauseTimerRef.current) {
      clearTimeout(readAlongPauseTimerRef.current)
      readAlongPauseTimerRef.current = null
    }
    emailIframeRef.current?.contentWindow?.postMessage({ type: 'highlight-word', wordIndex: -1 }, '*')
    readAlongUtteranceStartCharRef.current = 0
    readAlongLastWordIdxRef.current = 0
    pendingSpeakRef.current = false
    setReadAlongMode(null)
    readAlongSessionRef.current = null
  }

  function jumpToQueueIndex(targetIndex) {
    const queue = playQueueRef.current
    if (!queue || typeof queue.total !== 'number' || queue.total < 2) return

    const clampedIndex = Math.max(0, Math.min(targetIndex, queue.total - 1))
    if (clampedIndex === queue.index && String(selectedId) === String(getEmailRecordKey(queue.emails[clampedIndex] || {}))) {
      resetQueuePlaybackState()
      setIsAudioPaused(false)
      handleReadThisEmailRef.current?.()
      return
    }

    if (queue.emails[clampedIndex]) {
      queue.index = clampedIndex
      queue.awaitingNextPage = false
      syncAudioQueueProgress(queue)
      pendingQueuePlayRef.current = true
      resetQueuePlaybackState()
      setIsAudioPaused(false)
      selectEmailRef.current?.(queue.emails[clampedIndex])
      return
    }

    if (queue.mode === 'unread' && clampedIndex >= queue.emails.length && effectiveCurrentPageRef.current < effectiveTotalPagesRef.current) {
      queue.awaitingNextPage = true
      syncAudioQueueProgress({ ...queue, index: clampedIndex, awaitingNextPage: true })
      setIsAudioPaused(false)
      setMailPageRef.current?.(effectiveCurrentPageRef.current + 1)
    }
  }

  function handleQueuePrevious() {
    const queue = playQueueRef.current
    if (!queue || queue.index <= 0) return
    jumpToQueueIndex(queue.index - 1)
  }

  function handleQueueNext() {
    const queue = playQueueRef.current
    if (!queue || typeof queue.total !== 'number' || queue.index >= queue.total - 1) return
    jumpToQueueIndex(queue.index + 1)
  }

  function speakUnreadEmails(externalEmails) {
    // ── Scheduled / external emails ──
    if (Array.isArray(externalEmails) && externalEmails.length > 0) {
      console.log('[EmailView] Scheduled reading: starting queue with', externalEmails.length, 'emails')
      playQueueRef.current = {
        emails: externalEmails,
        index: 0,
        mode: 'scheduled',
        awaitingNextPage: false,
        total: externalEmails.length,
      }
      syncAudioQueueProgress(playQueueRef.current)
      pendingQueuePlayRef.current = true
      selectEmail(externalEmails[0])
      setIsAudioBarOpen(true)
      return
    }

    if (bulkSelected.size > 0) {
      // Play These Emails
      const emails = [...bulkSelected].map(id => bulkSelectedEmails[id]).filter(Boolean)
      if (emails.length === 0) return
      playQueueRef.current = {
        emails,
        index: 0,
        mode: 'selected',
        awaitingNextPage: false,
        total: emails.length,
      }
      syncAudioQueueProgress(playQueueRef.current)
      if (String(selectedId) === String(getEmailRecordKey(emails[0]))) {
        // 第一封已展开 — 直接触发，不依赖 selectedId 变化
        handleReadThisEmail()
      } else {
        pendingQueuePlayRef.current = true
        selectEmail(emails[0])
      }
    } else {
      // Play All Unread
      const unreadOnPage = pagedFiltered.filter(e => e.unread)
      if (unreadOnPage.length > 0) {
        playQueueRef.current = {
          emails: unreadOnPage,
          index: 0,
          mode: 'unread',
          awaitingNextPage: false,
          total: Math.max(unreadOnPage.length, unreadCount || 0),
        }
        syncAudioQueueProgress(playQueueRef.current)
        if (String(selectedId) === String(getEmailRecordKey(unreadOnPage[0]))) {
          handleReadThisEmail()
        } else {
          pendingQueuePlayRef.current = true
          selectEmail(unreadOnPage[0])
        }
      } else {
        // 当前页无未读 — 从第 1 页开始扫描
        if (effectiveTotalPages <= 1) return
        playQueueRef.current = {
          emails: [],
          index: -1,
          mode: 'unread',
          awaitingNextPage: true,
          total: Math.max(2, unreadCount || 0),
        }
        syncAudioQueueProgress(playQueueRef.current)
        setMailPage(effectiveCurrentPage === 1 ? 2 : 1)
      }
    }
  }

  // ── IPC: Scheduled reading listener ──────────────────────────────────────
  useEffect(() => {
    if (!window.electronAPI) return

    // 1. Check for buffered messages from before we started listening
    if (window.electronAPI.getPendingScheduledReading) {
      window.electronAPI.getPendingScheduledReading().then(messages => {
        if (messages && messages.length > 0) {
          console.log('[EmailView] Found buffered scheduled reading:', messages.length, 'messages')
          speakUnreadEmails(messages)
        }
      }).catch(err => console.error('[EmailView] getPendingScheduledReading error:', err))
    }

    // 2. Listen for future scheduled readings from the main process
    if (window.electronAPI.onScheduledReading) {
      const unsubscribe = window.electronAPI.onScheduledReading((messages) => {
        console.log('[EmailView] Received scheduled reading event:', messages?.length, 'messages')
        speakUnreadEmails(messages)
      })
      return unsubscribe
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleBulkDelete() {
    if (bulkSelected.size === 0 || deleteInProgress) return
    const toDelete = [...bulkSelected].map(id => bulkSelectedEmails[id]).filter(Boolean)
    if (toDelete.length === 0) return

    const folder = activeFolder.folder
    const inTrash = folder === 'trash'
    const n = toDelete.length
    const confirmMsg = inTrash
      ? `Permanently delete ${n} message${n === 1 ? '' : 's'}? This cannot be undone.`
      : `Delete ${n} selected email${n === 1 ? '' : 's'}?`
    if (!window.confirm(confirmMsg)) return

    setDeleteInProgress(true)
    const removeOne = email => {
      const recordKey = getEmailRecordKey(email)
      removeEmailFromAllScopes(recordKey)
      removeEmailFromGmailSearchResults(recordKey)
      setBodyCache(prev => { const next = { ...prev }; delete next[recordKey]; return next })
      if (String(selectedId) === String(recordKey)) {
        setSelectedId(null)
        window.speechSynthesis?.cancel()
        const _queue7b = playQueueRef.current
        if (_queue7b && getEmailRecordKey(_queue7b.emails[_queue7b.index] ?? {}) === recordKey) {
          if (_queue7b.index + 1 < _queue7b.emails.length) {
            _queue7b.index += 1
            syncAudioQueueProgress(_queue7b)
            pendingQueuePlayRef.current = true
            selectEmailRef.current?.(_queue7b.emails[_queue7b.index])
          } else {
            playQueueRef.current = null
            syncAudioQueueProgress(null)
            pendingQueuePlayRef.current = false
          }
        }
        setReadAlongMode(null)
        readAlongSessionRef.current = null
      }
    }

    try {
      for (const email of toDelete) {
        if (email.isDraft) {
          const googleAcct = resolveGoogleAccountEmailForDraft(email)
          const id = email.id
          if (googleAcct && id && !isLocalComposeDraftId(id) && window.electronAPI?.deleteGmailDraft) {
            await window.electronAPI.deleteGmailDraft(String(id), googleAcct)
          }
          removeDraftByIdEverywhere(id)
          removeOne(email)
          continue
        }
        if (!activeScopeIsGmail) {
          removeOne(email)
          continue
        }
        const uid = imapUidForGmailListRow(email)
        const googleAcct = resolveGoogleAccountEmailForRow(email)
        if (uid == null || !googleAcct) continue
        if (inTrash && window.electronAPI?.expungeGmailMessage) {
          const res = await window.electronAPI.expungeGmailMessage(uid, 'trash', googleAcct)
          if (res?.status === 'ok') removeOne(email)
        } else if (window.electronAPI?.moveGmailMessage) {
          const res = await window.electronAPI.moveGmailMessage(uid, folder, 'trash', googleAcct)
          if (res?.status === 'ok') {
            if (folder === 'inbox' && email.unread) {
              const unreadKey = gmailUnreadMapKey(googleAcct)
              setGmailInboxUnreadByAccount(prev => {
                if (typeof prev[unreadKey] !== 'number') return prev
                return { ...prev, [unreadKey]: Math.max(0, prev[unreadKey] - 1) }
              })
            }
            removeOne(email)
          }
        }
      }
      setBulkSelected(new Set())
      setBulkSelectedEmails({})
    } catch (err) {
      console.error('[EmailView] handleBulkDelete:', err)
      window.alert(err?.message || 'Failed to delete some messages.')
    } finally {
      setDeleteInProgress(false)
    }
  }

  function getDefaultComposeScopeKey() {
    return activeFolder.scope !== 'all' ? activeFolder.scope : (accountEmail || 'primary')
  }

  function resetComposeEditor() {
    setComposeForm({ to: '', subject: '', body: '' })
    setComposeAttachments([])
    setComposeSendError('')
    setEditingDraftId(null)
    setEditingDraftScope(null)
  }

  async function saveComposeDraft() {
    const scopeKey = editingDraftScope || getDefaultComposeScopeKey()
    const hasContent = [composeForm.to, composeForm.subject, composeForm.body]
      .some(value => String(value || '').trim())

    if (!editingDraftId && !hasContent) return

    const googleAcct = getComposeGoogleAccountEmail()
    const draftsStoreKey = googleAcct || scopeKey
    let draft = createLocalDraftFromCompose({
      id: editingDraftId,
      form: composeForm,
      accountEmail,
      scopeKey: draftsStoreKey,
      attachmentsMeta: composeAttachments.map(f => ({ name: f.name, size: f.size, type: f.type })),
    })

    if (googleAcct && window.electronAPI?.createGmailDraft && hasContent) {
      try {
        const apiPayload = {
          accountEmail: googleAcct,
          to: composeForm.to,
          subject: (composeForm.subject || '').trim() || '(No subject)',
          body: composeForm.body || '',
        }
        let norm = null
        if (editingDraftId && !isLocalComposeDraftId(editingDraftId)) {
          const res = await window.electronAPI.updateGmailDraft(String(editingDraftId), apiPayload)
          if (res?.status !== 'ok') throw new Error(res?.error || 'Draft update failed')
          norm = res.draft
        } else {
          const res = await window.electronAPI.createGmailDraft(apiPayload)
          if (res?.status !== 'ok') throw new Error(res?.error || 'Draft create failed')
          norm = res.draft
        }
        if (norm) {
          draft = mapRemoteGmailDraftToUi(norm, draftsStoreKey, googleAcct)
          setEditingDraftId(draft.id)
        }
      } catch (err) {
        console.warn('[EmailView] Remote draft save failed, keeping local copy:', err?.message || err)
      }
    }

    const prevId = editingDraftId
    if (prevId && String(prevId) !== String(draft.id)) {
      delete draftAttachmentsRef.current[prevId]
    }
    if (composeAttachments.length > 0) {
      draftAttachmentsRef.current[draft.id] = composeAttachments
    }
    setDraftsForScope(draftsStoreKey, currentDrafts => {
      const filtered = prevId
        ? currentDrafts.filter(item => String(item.id) !== String(prevId))
        : currentDrafts
      const exists = filtered.some(item => String(item.id) === String(draft.id))
      if (exists) {
        return filtered.map(item => (String(item.id) === String(draft.id) ? draft : item))
      }
      return [draft, ...filtered]
    })
  }

  function openCompose() {
    setIsComposeOpen(true)
    setIsComposeMinimised(false)
    setComposeSendError('')
  }

  function openComposeForNewDraft() {
    resetComposeEditor()
    setEditingDraftScope(getDefaultComposeScopeKey())
    setIsComposeOpen(true)
    setIsComposeMinimised(false)
  }

  // Backend integration note:
  // Reply uses the existing compose UI. If backend reply metadata or threading
  // support is added, this is the frontend handoff point.
  function handleReply(email) {
    setComposeAttachments([])
    setEditingDraftId(null)
    setEditingDraftScope(getDefaultComposeScopeKey())
    setComposeForm({
      to: email?.fromEmail || '',
      subject: buildReplySubject(email?.subject),
      body: buildReplyBody(email, isProbablyHtml),
    })
    setIsComposeOpen(true)
    setIsComposeMinimised(false)
    setComposeSendError('')

    window.setTimeout(() => {
      composeBodyRef.current?.focus()
      composeBodyRef.current?.setSelectionRange(0, 0)
    }, 0)
  }

  // Backend integration note:
  // Forward also reuses the compose UI. Connect any backend-specific forwarding
  // metadata here rather than in the button component.
  function handleForward(email) {
    setComposeAttachments([])
    setEditingDraftId(null)
    setEditingDraftScope(getDefaultComposeScopeKey())
    setComposeForm({
      to: '',
      subject: buildForwardSubject(email?.subject),
      body: buildForwardBody(email, isProbablyHtml),
    })
    setIsComposeOpen(true)
    setIsComposeMinimised(false)
    setComposeSendError('')

    window.setTimeout(() => {
      composeBodyRef.current?.focus()
      composeBodyRef.current?.setSelectionRange(0, 0)
    }, 0)
  }

  function closeCompose() {
    setIsComposeOpen(false)
    setIsComposeMinimised(false)
  }

  async function handleCloseCompose() {
    try {
      await saveComposeDraft()
    } catch (err) {
      console.error('[EmailView] saveComposeDraft:', err)
    }
    closeCompose()
    resetComposeEditor()
  }

  function toggleComposeMinimised() {
    setIsComposeMinimised(prev => !prev)
  }

  function updateComposeField(field, value) {
    setComposeForm(prev => ({ ...prev, [field]: value }))
  }

  async function handleComposeSend() {
    const to = composeForm.to.trim()
    if (!to) {
      setComposeSendError('Add at least one recipient.')
      return
    }

    const api = window.electronAPI
    if (!api?.sendSmtpMail) {
      setComposeSendError('Mail send is unavailable — check preload / restart the app.')
      return
    }

    const composeGoogle =
      (editingDraftScope &&
        linkedAccounts.some(a => a.email === editingDraftScope && a.provider === 'google'))
        ? editingDraftScope
        : (isGoogleProvider && accountEmail ? accountEmail : resolveGmailAccountEmail({}))

    if (
      editingDraftId &&
      !isLocalComposeDraftId(editingDraftId) &&
      composeGoogle &&
      api?.sendGmailDraft &&
      api?.updateGmailDraft &&
      composeAttachments.length === 0
    ) {
      setComposeSending(true)
      setComposeSendError('')
      try {
        const up = await api.updateGmailDraft(String(editingDraftId), {
          accountEmail: composeGoogle,
          to: composeForm.to,
          subject: composeForm.subject.trim() || '(No subject)',
          body: composeForm.body,
        })
        if (up?.status !== 'ok') throw new Error(up?.error || 'Failed to update draft before send.')
        const sendRes = await api.sendGmailDraft(String(editingDraftId), composeGoogle)
        if (sendRes?.status !== 'ok') throw new Error(sendRes?.error || 'Failed to send draft.')
        removeDraftByIdEverywhere(editingDraftId)
        resetComposeEditor()
        closeCompose()
      } catch (err) {
        setComposeSendError(err?.message || String(err))
      } finally {
        setComposeSending(false)
      }
      return
    }

    setComposeSending(true)
    setComposeSendError('')
    try {
      const mail = {
        to,
        subject: composeForm.subject.trim() || '(no subject)',
        text: composeForm.body,
      }
      if (composeAttachments.length > 0) {
        mail.attachments = await Promise.all(
          composeAttachments.map(async (file) => ({
            filename: file.name,
            content: new Uint8Array(await file.arrayBuffer()),
            contentType: file.type || 'application/octet-stream',
          }))
        )
      }

      const oauthEmail = composeGoogle || (isGoogleProvider ? accountEmail : null)
      const result = oauthEmail
        ? await api.sendSmtpMail({
          useGoogleOAuth: true,
          mail,
          googleAccountEmail: oauthEmail,
        })
        : await api.sendSmtpMail({ smtp: {}, mail })

      if (result?.status === 'ok') {
        if (editingDraftId && !isLocalComposeDraftId(editingDraftId) && oauthEmail && api.deleteGmailDraft) {
          api.deleteGmailDraft(String(editingDraftId), oauthEmail).catch(() => { })
        }
        removeDraftByIdEverywhere(editingDraftId)
        resetComposeEditor()
        closeCompose()
      } else {
        setComposeSendError(result?.error || 'Failed to send.')
      }
    } catch (err) {
      setComposeSendError(err?.message || String(err))
    } finally {
      setComposeSending(false)
    }
  }

  async function discardComposeDraft() {
    const id = editingDraftId
    const googleAcct = getComposeGoogleAccountEmail()
    if (googleAcct && id && !isLocalComposeDraftId(id) && window.electronAPI?.deleteGmailDraft) {
      try {
        const res = await window.electronAPI.deleteGmailDraft(String(id), googleAcct)
        if (res?.status !== 'ok') throw new Error(res?.error || 'Failed to delete draft on server.')
      } catch (err) {
        console.error('[EmailView] deleteGmailDraft:', err)
        window.alert(err?.message || 'Could not delete the remote draft.')
        return
      }
    }
    delete draftAttachmentsRef.current[id]
    removeDraftByIdEverywhere(id)
    resetComposeEditor()
    closeCompose()
  }

  function handleComposeAttachmentClick() {
    composeAttachmentInputRef.current?.click()
  }

  function handleComposeAttachmentSelected(event) {
    const files = Array.from(event.target.files || [])
    if (files.length) setComposeAttachments(prev => [...prev, ...files])
    event.target.value = ''
  }

  function handleComposeImageClick() {
    composeImageInputRef.current?.click()
  }

  function handleComposeImageSelected(event) {
    const files = Array.from(event.target.files || [])
    if (files.length) setComposeAttachments(prev => [...prev, ...files])
    event.target.value = ''
  }

  function handleRemoveComposeAttachment(index) {
    setComposeAttachments(prev => prev.filter((_, i) => i !== index))
  }

  // Dynamic mail-list title based on active folder
  const folderTitle = activeFolder.folder.charAt(0).toUpperCase() + activeFolder.folder.slice(1)
  const showGmailSearchLoading =
    activeScopeIsGmail && !isDraftFolder && !!search.trim() && gmailSearch.loading
  const audioTitle = selectedEmail?.fromName || 'Audio Preview'
  const audioSubtitle = selectedEmail?.subject || 'Select an email to preview aloud'
  const audioProgressLabel = audioQueueProgress
    ? `${audioQueueProgress.current}/${audioQueueProgress.total}`
    : ''
  const voiceChipLabel = selectedVoiceUri
    ? speechVoices.find(v => v.voiceURI === selectedVoiceUri)?.name || 'System voice'
    : `Auto (${selectedVoice})`
  const tabOptions =
    isDraftFolder ? [] :
      isInboxFolder ? ['All', 'Unread', 'Read', 'Starred'] :
        ['All', 'Starred']
  const unreadCount = (() => {
    if (isInboxFolder && activeScopeIsGmail) {
      if (activeFolder.scope !== 'all') {
        const n = gmailInboxUnreadByAccount[gmailUnreadMapKey(activeFolder.scope)]
        if (typeof n === 'number') return n
      } else {
        const allGoogleEmails = [
          ...(isGoogleProvider && accountEmail ? [accountEmail] : []),
          ...linkedAccounts.filter(a => a.provider === 'google').map(a => a.email),
        ]
        const total = allGoogleEmails.reduce((sum, em) => {
          const n = gmailInboxUnreadByAccount[gmailUnreadMapKey(em)]
          return sum + (typeof n === 'number' ? n : 0)
        }, 0)
        if (allGoogleEmails.length > 0) return total
      }
    }
    return filtered.filter(e => e.unread).length
  })()

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="app-window" data-fontsize={fontSize}>
      {/* ── Topbar ── */}
      <TopBar
        accountEmail={accountEmail}
        effectiveProvider={effectiveProvider}
        linkedAccounts={linkedAccounts}
        setLinkedAccounts={setLinkedAccounts}
        onLogout={async () => {
          try {
            if (window.electronAPI && window.electronAPI.logout) {
              await window.electronAPI.logout('all')
            }
          } catch (e) {
            console.error('Logout error:', e)
          }
          navigate('/', { replace: true })
        }}
        onAddAccount={() => setShowAddAccount(true)}
        theme={theme}
        onThemeChange={setTheme}
      />

      {/* ── Body ── */}
      <div className="main-layout">
        {/* ── Sidebar ── */}
        <Sidebar
          emails={emails}
          accountEmail={accountEmail}
          effectiveProvider={effectiveProvider}
          isDemoProvider={isDemoProvider}
          linkedAccounts={linkedAccounts}
          activeFolder={activeFolder}
          onFolderChange={setActiveFolder}
          search={search}
          onSearchChange={setSearch}
          searchBusy={showGmailSearchLoading}
          openCompose={openComposeForNewDraft}
          totalUnread={totalUnread}
          unreadByScope={unreadByScope}
          onOpenScheduledReading={() => setShowScheduledReading(true)}
          isScheduledReadingOpen={showScheduledReading}
          onOpenSettings={() => setShowSettings(true)}
        />

        {/* ── Mail List ── */}
        <section className="mail-list-panel">
          <div className="mail-list-header">
            <div>
              <div className="mail-list-title">{folderTitle}</div>
              {gmailSearchListActive && gmailSearch.truncated && (
                <div className="mail-list-search-hint" style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                  Showing the newest {gmailSearch.emails?.length ?? 0} of {gmailSearch.matchedUidCount} matches in this folder
                </div>
              )}
            </div>
            <button
              id="refreshBtn"
              className="icon-btn refresh-btn"
              aria-label="Refresh"
              onClick={handleRefresh}
              disabled={loading}
            >
              {loading ? '…' : <RefreshIcon size={16} />}
            </button>
          </div>

          {tabOptions.length > 0 && (
            <div className="mail-tabs">
              {tabOptions.map(tab => (
                <button
                  key={tab}
                  type="button"
                  className={`tab${activeTab === tab ? ' active' : ''}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>
          )}

          {/* Action bar: Inbox always shows; other folders only when items are selected */}
          {(isInboxFolder || bulkSelected.size > 0) && (
            <div className="mail-action-bar">
              {/* Inbox with no selection: Play All Unread */}
              {isInboxFolder && bulkSelected.size === 0 && (
                <button
                  type="button"
                  className="mail-play-btn"
                  id="readSelectedBtn"
                  onClick={speakUnreadEmails}
                >
                  <HeadphonesIcon size={16} color="var(--mail-action-btn-text)" />
                  <span>Play All Unread ({unreadCount})</span>
                </button>
              )}
              {bulkSelected.size > 0 && (
                <div className="mail-action-group">
                  {/* Inbox/Send/Trash: show Play; Drafts: hide Play */}
                  {!isDraftFolder && (
                    <button
                      type="button"
                      className="mail-play-these-btn"
                      onClick={speakUnreadEmails}
                    >
                      <HeadphonesIcon size={16} color="var(--mail-action-btn-text)" />
                      <span>Play These Emails ({bulkSelected.size})</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="mail-clear-btn"
                    id="clearSelectionBtn"
                    onClick={() => { setBulkSelected(new Set()); setBulkSelectedEmails({}) }}
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    className="mail-delete-btn"
                    aria-label="Delete selected emails"
                    disabled={deleteInProgress}
                    onClick={handleBulkDelete}
                  >
                    <TrashIcon size={16} color="white" />
                  </button>
                </div>
              )}
            </div>
          )}

          <div id="mailItems" className="mail-items">
            {!showRealEmails && isDemoProvider && (
              <div className="mail-item static-message">Coming soon — no backend support yet for this folder.</div>
            )}
            {showRealEmails && (
              <>
                {loading && (
                  <div className="mail-item static-message">Loading emails…</div>
                )}
                {showGmailSearchLoading && (
                  <div className="mail-item static-message">Searching mailbox…</div>
                )}
                {isDraftFolder && gmailDraftsSyncError && (
                  <div
                    className="mail-item static-message"
                    style={{
                      textAlign: 'left',
                      whiteSpace: 'pre-wrap',
                      borderLeft: '3px solid var(--danger, #dc2626)',
                      paddingLeft: 12,
                    }}
                    role="alert"
                  >
                    <strong>无法从 Gmail 同步草稿</strong>
                    <p style={{ margin: '8px 0 0', fontSize: 13, lineHeight: 1.45 }}>
                      {summariseGmailDraftListError(gmailDraftsSyncError)}
                    </p>
                    <details style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>
                      <summary style={{ cursor: 'pointer' }}>技术详情（含 Console 链接）</summary>
                      <pre
                        style={{
                          margin: '8px 0 0',
                          padding: 8,
                          background: 'rgba(0,0,0,0.06)',
                          borderRadius: 6,
                          overflow: 'auto',
                          maxHeight: 180,
                          fontSize: 11,
                        }}
                      >
                        {gmailDraftsSyncError}
                      </pre>
                    </details>
                  </div>
                )}
                {!loading && !showGmailSearchLoading && gmailSearch.error && search.trim() && activeScopeIsGmail && !isDraftFolder && (
                  <div className="mail-item static-message">{gmailSearch.error}</div>
                )}
                {!loading && !showGmailSearchLoading && filtered.length === 0 && !gmailSearch.error && !gmailDraftsSyncError && (
                  <div className="mail-item static-message">
                    {isDraftFolder
                      ? 'No drafts yet. Start a compose and close it to save a draft.'
                      : 'No emails found.'}
                  </div>
                )}
                {!loading && !showGmailSearchLoading && pagedFiltered.map(email => {
                  const isSelected = String(selectedId) === getEmailRecordKey(email)
                  const isChecked = bulkSelected.has(String(email.id))
                  return (
                    <article
                      key={email.id}
                      className={`mail-item${isSelected ? ' selected' : ''}${isChecked ? ' selected-for-bulk' : ''}${email.unread ? ' unread' : ' read'}`}
                      style={{ position: 'relative' }}
                      onClick={() => selectEmail(email)}
                    >
                      {email.unread && <div className="mail-unread-bar" />}

                      <div className="mail-item-body">
                        <label className="mail-checkbox-wrap" onClick={e => e.stopPropagation()}>
                          <div className={`mail-checkbox-box${isChecked ? ' checked' : ''}`}>
                            {isChecked && <CheckIcon size={10} color={theme === 'dark' ? 'white' : '#3538cd'} />}
                          </div>
                          <input
                            className="mail-checkbox-hidden"
                            type="checkbox"
                            checked={isChecked}
                            onChange={e => toggleBulk(email.id, e.target.checked, email)}
                          />
                        </label>

                        <div className="mail-item-content">
                          <div className="mail-row mail-row--top">
                            {email.unread && <span className="mail-unread-dot" />}
                            <span className="mail-sender">{email.fromName || 'Unknown Sender'}</span>
                            <span className="mail-time">{email.timeAgo || (email.date ? formatDate(email.date) : '')}</span>
                          </div>
                          <div className="mail-row mail-row--subject">
                            <span className="mail-subject">{email.subject || '(No subject)'}</span>
                            <div className="mail-row-icons">
                              {email.attachments?.length > 0 && (
                                <AttachmentIcon size={12} color="var(--mail-icon-color)" />
                              )}
                              {isDraftFolder ? (
                                <button
                                  type="button"
                                  className="mail-icon-btn"
                                  aria-label="Delete draft"
                                  aria-busy={deleteInProgress || undefined}
                                  disabled={deleteInProgress}
                                  onClick={e => {
                                    e.stopPropagation()
                                    void deleteDraftByRow(email)
                                  }}
                                >
                                  <TrashIcon size={12} />
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className={`mail-icon-btn${email.starred ? ' starred' : ''}`}
                                  aria-label={email.starred ? 'Unstar email' : 'Star email'}
                                  onClick={e => {
                                    e.stopPropagation()
                                    handleToggleSelectedEmailStar(email)
                                  }}
                                >
                                  {email.starred ? <StarFilledIcon size={12} /> : <StarOutlineIcon size={12} />}
                                </button>
                              )}
                            </div>
                          </div>
                          <p className="mail-preview">{email.preview || ''}</p>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </>
            )}
          </div>

          <MailPagination
            emailCount={effectiveEmailCount}
            currentPage={effectiveCurrentPage}
            totalPages={effectiveTotalPages}
            goToPage={paginationState.goToPage}
            disabled={loading}
            inputError={pageInputError}
            onPreviousPage={handlePreviousPage}
            onNextPage={handleNextPage}
            onGoToPageChange={handleGoToPageChange}
            onGoToPageSubmit={handleGoToPageSubmit}
          />
        </section>

        {/* ── Reader Panel ── */}
        <section id="readerPanel" className="reader-panel">
          {!selectedEmail ? (
            <>
              <div className="empty-state">
                <div>
                  <div className="empty-icon"><MailIcon size={48} color="var(--muted)" /></div>
                  <p>{isDraftFolder ? 'Select a draft to edit' : 'Select an email to read'}</p>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="reader-content">
                <div className="reader-header">
                  <h1 className="reader-subject">{selectedEmail.subject || '(No subject)'}</h1>
                  <ReaderActionBar
                    email={selectedEmail}
                    senderInitials={senderInitials}
                    onReply={() => handleReply(selectedEmail)}
                    onForward={() => handleForward(selectedEmail)}
                    onReadThisEmail={handleReadThisEmail}
                    onToggleStar={handleToggleSelectedEmailStar}
                    onDelete={handleDeleteSelectedEmail}
                    deleteDisabled={deleteInProgress}
                  />
                </div>

                <div className="reader-body-card">
                  <div className="reader-body">
                    {(() => {
                      const cacheKey = getEmailRecordKey(selectedEmail)
                      const cached = bodyCache[cacheKey]
                      const emailKey = getEmailRecordKey(selectedEmail)
                      const readAlongForThis =
                        readAlongMode && readAlongMode.emailKey === emailKey ? readAlongMode : null
                      const iframeKey = readAlongForThis ? `${emailKey}-ra-${readAlongNonce}` : `email-${emailKey}`

                      if (isGoogleProvider) {
                        if (!cached || cached.loading) {
                          const previewText = (selectedEmail?.preview || '').trim()
                          return (
                            <div style={{ padding: '0 32px' }}>
                              {previewText ? (
                                <p className="mail-preview" style={{ marginBottom: 12, opacity: 0.88 }}>
                                  {previewText}
                                </p>
                              ) : null}
                              <p style={{ color: 'var(--muted)', fontStyle: 'italic' }}>Loading message…</p>
                            </div>
                          )
                        }
                        if (cached.error) {
                          return <p style={{ color: 'var(--danger)' }}>Could not load message: {cached.error}</p>
                        }
                        const html = cached.html || (isProbablyHtml(cached.text) ? cached.text : null)
                        if (html) {
                          const frameHtml = readAlongForThis?.markedHtml ?? html
                          return (
                            <HtmlEmailFrame
                              key={iframeKey}
                              ref={emailIframeRef}
                              html={frameHtml}
                              onIframeLoad={handleEmailIframeLoad}
                            />
                          )
                        }
                        if (readAlongForThis) {
                          return (
                            <HtmlEmailFrame
                              key={iframeKey}
                              ref={emailIframeRef}
                              html={readAlongForThis.markedHtml}
                              onIframeLoad={handleEmailIframeLoad}
                            />
                          )
                        }
                        return (
                          <div>
                            {(cached.text || '').split('\n\n').map((para, i) => <p key={i}>{para}</p>)}
                          </div>
                        )
                      }

                      if (isProbablyHtml(selectedEmail.body)) {
                        const frameHtml = readAlongForThis?.markedHtml ?? selectedEmail.body
                        return (
                          <HtmlEmailFrame
                            key={iframeKey}
                            ref={emailIframeRef}
                            html={frameHtml}
                            onIframeLoad={handleEmailIframeLoad}
                          />
                        )
                      }
                      if (readAlongForThis) {
                        return (
                          <HtmlEmailFrame
                            key={iframeKey}
                            ref={emailIframeRef}
                            html={readAlongForThis.markedHtml}
                            onIframeLoad={handleEmailIframeLoad}
                          />
                        )
                      }
                      return (
                        <div>
                          {(selectedEmail.body || '').split('\n\n').map((para, i) => <p key={i}>{para}</p>)}
                        </div>
                      )
                    })()}
                  </div>
                  {(() => {
                    const cacheKey = getEmailRecordKey(selectedEmail)
                    const cachedAttachments = bodyCache[cacheKey]?.attachments
                    const attachments =
                      selectedEmail.attachments?.length > 0
                        ? selectedEmail.attachments
                        : Array.isArray(cachedAttachments)
                          ? cachedAttachments
                          : []
                    if (attachments.length === 0) return null
                    return (
                      <section className="reader-attachments">
                        <h4>Attachments</h4>
                        <div className="attachment-list">
                          {attachments.map((f, i) => (
                            <button
                              key={i}
                              type="button"
                              className="attachment-pill"
                              onClick={() => handleDownloadAttachment(f)}
                              title={`Download ${f?.original_name || f?.name || 'attachment'}`}
                            >
                              <img
                                src={attachmentIconSrc}
                                alt=""
                                className="attachment-pill-icon"
                                aria-hidden="true"
                              />
                              <span className="attachment-pill-name">
                                {f.original_name || f.name || 'attachment'}
                              </span>
                              {f.size ? <span className="attachment-pill-size">({f.size})</span> : null}
                            </button>
                          ))}
                        </div>
                      </section>
                    )
                  })()}
                </div>
              </div>
            </>
          )}

          <button
            ref={floatingAudioBtnRef}
            className={`floating-audio-btn${isAudioBarOpen ? ' floating-audio-btn--active' : ''}`}
            aria-label={isAudioBarOpen ? 'Hide audio controls' : 'Show audio controls'}
            aria-expanded={isAudioBarOpen}
            onPointerDown={handleAudioButtonPointerDown}
            onPointerMove={handleAudioButtonPointerMove}
            onPointerUp={handleAudioButtonPointerUp}
            onPointerCancel={handleAudioButtonPointerCancel}
            style={
              audioButtonPosition
                ? {
                  left: `${audioButtonPosition.x}px`,
                  top: `${audioButtonPosition.y}px`,
                }
                : undefined
            }
          >
            <VoiceIcon size={24} color="white" />
          </button>

          <AudioControlBar
            isOpen={isAudioBarOpen}
            title={audioTitle}
            subtitle={audioSubtitle}
            progressLabel={audioProgressLabel}
            isPaused={isAudioPaused}
            onTogglePaused={toggleAudioPaused}
            onGoPrevious={handleQueuePrevious}
            onGoNext={handleQueueNext}
            canGoPrevious={!!audioQueueProgress && audioQueueProgress.current > 1}
            canGoNext={!!audioQueueProgress && audioQueueProgress.current < audioQueueProgress.total}
            canTogglePlayback={!!selectedEmail}
            selectedSpeed={selectedSpeed}
            onSelectSpeed={selectSpeedOption}
            voiceChipLabel={voiceChipLabel}
            speechVoices={speechVoices}
            selectedVoiceUri={selectedVoiceUri}
            selectedVoiceGender={selectedVoice}
            isVoiceMenuOpen={isVoiceMenuOpen}
            voiceMenuRef={voiceMenuRef}
            onToggleVoiceMenu={toggleVoiceMenu}
            onSelectVoice={selectVoiceOption}
          />

          <Compose
            isOpen={isComposeOpen}
            isMinimised={isComposeMinimised}
            composeForm={composeForm}
            composeSending={composeSending}
            composeSendError={composeSendError}
            senderEmail={getComposeGoogleAccountEmail() || accountEmail || ''}
            composeBodyRef={composeBodyRef}
            composeAttachmentInputRef={composeAttachmentInputRef}
            composeImageInputRef={composeImageInputRef}
            onToggleMinimised={toggleComposeMinimised}
            onClose={handleCloseCompose}
            onUpdateField={updateComposeField}
            onSend={handleComposeSend}
            onAttachmentClick={handleComposeAttachmentClick}
            onAttachmentSelected={handleComposeAttachmentSelected}
            onImageClick={handleComposeImageClick}
            onImageSelected={handleComposeImageSelected}
            onDiscard={discardComposeDraft}
            editingDraftId={editingDraftId}
            attachments={composeAttachments}
            onRemoveAttachment={handleRemoveComposeAttachment}
          />
        </section>
      </div>

      {showAddAccount &&
        createPortal(
          <AddEmailAccount
            onClose={() => setShowAddAccount(false)}
            onSave={handleAddAccountSave}
          />,
          document.body
        )}
      {showScheduledReading && (
        <ScheduledReading
          tasks={scheduledTasks}
          setTasks={setScheduledTasks}
          onClose={() => setShowScheduledReading(false)}
        />
      )}
      {showSettings && (
        <Setting
          theme={theme}
          onThemeChange={setTheme}
          fontSize={fontSize}
          onFontSizeChange={setFontSize}
          language={language}
          onLanguageChange={setLanguage}
          emailsPerPage={emailsPerPage}
          onEmailsPerPageChange={setEmailsPerPage}
          ttsSpeed={selectedSpeed}
          onSpeedChange={setSelectedSpeed}
          speechVoices={speechVoices}
          selectedVoiceUri={selectedVoiceUri}
          ttsVoice={selectedVoiceUri || selectedVoice}
          onVoiceChange={val =>
            val === 'Female' || val === 'Male'
              ? selectVoiceOption({ type: 'auto', gender: val })
              : selectVoiceOption({ type: 'voice', voiceURI: val })
          }
          pauseEnabled={pauseEnabled}
          onPauseEnabledChange={setPauseEnabled}
          pauseSeconds={pauseSeconds}
          onPauseSecondsApply={secs => setPauseSeconds(normalizePauseSeconds(secs))}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  )
}
