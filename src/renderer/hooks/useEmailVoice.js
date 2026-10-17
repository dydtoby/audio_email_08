import { useCallback, useEffect, useRef } from 'react'
import { useVoice } from './useVoice'
import {
  injectReadAlongMarkup,
  findWordIndexForChar,
  plainEmailTextToHtml,
} from '../utils/emailReadAlongMarkup'
import {
  computeSentenceStarts,
  findNextSentenceStart,
  normalizePauseSeconds,
} from '../utils/voiceUtils'
import { buildFromFieldForTextExtraction } from '../utils/emailUtils'

/**
 * Read order (matches the spoken parts of output_email.json):
 *   receiver, sender, subject, date, body,
 *   attachments[*].spoken_name, links[*].spoken_name.
 * `images` is intentionally NOT read aloud. Attachments: `spoken_name`.
 * Links: `spoken_name` or derive from text/label (skip data: URLs).
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
function buildPipelineReadAlongAffixes(emailData) {
  if (!emailData || typeof emailData !== 'object') return { prefix: '', suffix: '' }
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
  const att = (emailData.attachments || []).map(_spokenOnly).filter(Boolean)
  if (att.length > 0) suffix += '\n\nAttachments: ' + att.join('. ') + '.'
  const lk = (emailData.links || []).map(_linkSpokenForPipeline).filter(Boolean)
  if (lk.length > 0) suffix += '\n\nLinks: ' + lk.join('. ') + '.'
  // images are intentionally not read aloud.

  return { prefix, suffix }
}

export function useEmailVoice({
  iframeRef,
  selectedEmail,
  isGoogleProvider,
  resolveGoogleAccountEmailForRow,
  imapUidForGmailListRow,
  getEmailRecordKey,
  fetchGmailBody,
  selectEmail,
  bodyCache,
  setBodyCache,
  onReadAlongReady,
  onQueueComplete,
  pagedFiltered,
  bulkSelected,
  bulkSelectedEmails,
  loading,
}) {
  const voice = useVoice()
  const {
    playQueue,
    setPlayQueue,
    setIsAudioPaused,
    setIsAudioBarOpen,
    setCurrentWordIndex,
    setReadAlongUtteranceStartChar,
    readAlongSessionRef,
    pendingQueuePlayRef,
    startSpeech,
    stop,
  } = voice

  // Latest values for the IPC listener to avoid re-registering
  const stateRef = useRef({ pagedFiltered, bulkSelected, bulkSelectedEmails })
  useEffect(() => {
    stateRef.current = { pagedFiltered, bulkSelected, bulkSelectedEmails }
  }, [pagedFiltered, bulkSelected, bulkSelectedEmails])

  const getBaseBodyHtmlForReadAlong = useCallback(() => {
    if (!selectedEmail) return ''
    const cacheKey = getEmailRecordKey(selectedEmail)
    const cached = bodyCache[cacheKey]

    if (isGoogleProvider) {
      if (!cached || cached.loading || cached.error) return ''
      // Basic check for HTML
      const isProbablyHtml = (text) => {
        if (!text) return false
        const trimmed = text.trim()
        return trimmed.toLowerCase().includes('<html>') || (trimmed.startsWith('<') && trimmed.includes('>'))
      }
      const html = cached.html || (isProbablyHtml(cached.text) ? cached.text : null)
      if (html) return html
      return plainEmailTextToHtml(cached.text || '')
    }

    const html = selectedEmail.body
    if (html && (html.toLowerCase().includes('<html>') || (html.startsWith('<') && html.includes('>')))) {
      return html
    }
    return plainEmailTextToHtml(selectedEmail.body || '')
  }, [selectedEmail, bodyCache, isGoogleProvider, getEmailRecordKey])

  const startReadAlongSpeech = useCallback(() => {
    const session = readAlongSessionRef.current
    if (!session?.utteranceText?.trim()) return

    const { pauseEnabled, pauseSeconds } = voice
    const full = session.utteranceText
    const sliceStart = Math.max(0, Math.min(voice.readAlongUtteranceStartChar ?? 0, full.length))
    let sliceEnd = full.length
    let chunked = false

    if (pauseEnabled || full.length - sliceStart > 3000) {
      const nextStart = findNextSentenceStart(sliceStart, session.sentenceStarts)
      if (nextStart !== null && nextStart > sliceStart) {
        sliceEnd = nextStart
        chunked = true
      }
    }

    const textSlice = full.slice(sliceStart, sliceEnd)

    const onEnd = () => {
      const endChar = sliceEnd
      if ((pauseEnabled || chunked) && endChar < full.length) {
        setReadAlongUtteranceStartChar(endChar)
        const delayMs = pauseEnabled ? Math.max(0, normalizePauseSeconds(pauseSeconds) * 1000) : 50
        voice.readAlongPauseTimerRef.current = setTimeout(() => {
          voice.readAlongPauseTimerRef.current = null
          startReadAlongSpeech()
        }, delayMs)
      } else {
        setReadAlongUtteranceStartChar(0)
        setCurrentWordIndex(-1)

        const queue = playQueue
        if (queue && queue.index + 1 < queue.emails.length) {
          const nextIndex = queue.index + 1
          setPlayQueue({ ...queue, index: nextIndex })
          pendingQueuePlayRef.current = true
          selectEmail(queue.emails[nextIndex])
        } else {
          if (onQueueComplete) onQueueComplete()
          else {
            setPlayQueue(null)
            setIsAudioPaused(true)
          }
        }
      }
    }

    startSpeech(textSlice, findWordIndexForChar, onEnd)
  }, [
    voice,
    playQueue,
    setPlayQueue,
    setIsAudioPaused,
    setCurrentWordIndex,
    setReadAlongUtteranceStartChar,
    startSpeech,
    selectEmail,
    onQueueComplete
  ])

  const handleReadThisEmail = useCallback(async () => {
    if (!selectedEmail) return
    const base = getBaseBodyHtmlForReadAlong()
    if (!base.trim()) return

    // Always inject read-along spans into the ORIGINAL email HTML so the iframe
    // keeps the email's visual format. Pipeline output is used only for
    // metadata + spoken_name suffix, not for replacing the body view.
    let html = ''
    let bodyText = ''
    let wordOffsets = []
    let ipcEmailData = null

    {
      const injected = injectReadAlongMarkup(base)
      html = injected.html
      bodyText = injected.utteranceText
      wordOffsets = injected.wordOffsets
    }

    const extract = window.electronAPI?.extractEmailFromHtml
    if (typeof extract === 'function') {
      try {
        const res = await extract({
          html: base,
          from: buildFromFieldForTextExtraction(selectedEmail),
          to: String(selectedEmail.to || selectedEmail.mailboxEmail || '').trim(),
          subject: String(selectedEmail.subject || '').replace(/^\(No subject\)$/i, '').trim(),
          date: String(selectedEmail.rawDate || selectedEmail.date || '').trim(),
          uid: selectedEmail.uid,
          attachment: selectedEmail.attachments,
          attachments: selectedEmail.attachments,
        })
        if (res?.status === 'ok' && res.email_data && typeof res.email_data === 'object') {
          ipcEmailData = res.email_data
        }
      } catch (err) {
        console.warn('[useEmailVoice] pipeline 请求失败（仍按原邮件 HTML 朗读，但元数据 / spoken_name 顺序缺失）:', err)
      }
    }

    if (!bodyText.trim()) return

    const { prefix, suffix } = ipcEmailData
      ? buildPipelineReadAlongAffixes(ipcEmailData)
      : (() => {
          const attLines = (selectedEmail.attachments || [])
            .map(f => (f && typeof f === 'object' ? String(f.spoken_name || '').trim() : ''))
            .filter(Boolean)
          return {
            prefix: '',
            suffix: attLines.length > 0 ? '\n\nAttachments: ' + attLines.join('. ') + '.' : '',
          }
        })()

    const utteranceText = prefix + bodyText + suffix
    const shiftedWordOffsets = prefix.length > 0
      ? wordOffsets.map(w => ({ ...w, charStart: w.charStart + prefix.length, charEnd: w.charEnd + prefix.length }))
      : wordOffsets
    const sentenceStarts = computeSentenceStarts(utteranceText)

    setReadAlongUtteranceStartChar(0)
    setCurrentWordIndex(-1)
    readAlongSessionRef.current = { utteranceText, wordOffsets: shiftedWordOffsets, sentenceStarts }
    setIsAudioBarOpen(true)
    setIsAudioPaused(false)

    return { html, utteranceText, wordOffsets: shiftedWordOffsets }
  }, [
    selectedEmail,
    getBaseBodyHtmlForReadAlong,
    setIsAudioBarOpen,
    setIsAudioPaused,
    setCurrentWordIndex,
    setReadAlongUtteranceStartChar,
    readAlongSessionRef
  ])

  const speakUnreadEmails = useCallback((externalEmails) => {
    let emails = []
    let mode = 'unread'
    if (Array.isArray(externalEmails) && externalEmails.length > 0) {
      emails = externalEmails
      mode = 'scheduled'
      console.log('Scheduled emails:', emails)
    } else {
      const { pagedFiltered, bulkSelected, bulkSelectedEmails } = stateRef.current
      emails = bulkSelected.size > 0
        ? [...bulkSelected].map(id => bulkSelectedEmails[id]).filter(Boolean)
        : (pagedFiltered || []).filter(e => e.unread)
      mode = bulkSelected.size > 0 ? 'selected' : 'unread'
      console.log('Unread emails:', emails)
    }

    if (emails.length === 0) return

    setPlayQueue({ emails, index: 0, mode })
    pendingQueuePlayRef.current = true
    selectEmail(emails[0])
  }, [setPlayQueue, selectEmail])

  // IPC listener for scheduled reading
  useEffect(() => {
    if (window.electronAPI) {
      // 1. Check if there are any buffered messages from before we were listening
      if (window.electronAPI.getPendingScheduledReading) {
        window.electronAPI.getPendingScheduledReading().then(messages => {
          if (messages && messages.length > 0) {
            console.log('[useEmailVoice] Found buffered scheduled reading!')
            speakUnreadEmails(messages)
          }
        }).catch(err => console.error('[useEmailVoice] getPendingScheduledReading error:', err))
      }

      // 2. Listen for future scheduled readings
      if (window.electronAPI.onScheduledReading) {
        const unsubscribe = window.electronAPI.onScheduledReading((messages) => {
          speakUnreadEmails(messages)
        })
        return unsubscribe
      }
    }
  }, [speakUnreadEmails])

  // Orchestrator Effect: Wait for email body to be cached, then start reading
  useEffect(() => {
    if (!pendingQueuePlayRef.current) return
    const queue = playQueue
    if (!queue || queue.awaitingNextPage) return
    const expected = queue.emails[queue.index]
    if (!expected) return

    // selectedEmail might be behind, so we wait until it matches the queue's expected email
    const recordKey = getEmailRecordKey(expected)
    if (!selectedEmail || getEmailRecordKey(selectedEmail) !== recordKey) return

    if (isGoogleProvider && imapUidForGmailListRow(expected) != null) {
      const cached = bodyCache[recordKey]
      if (!cached || cached.loading) return
      
      // If there was an error fetching the body, skip this email to prevent hanging the queue
      if (cached.error) {
        console.warn(`[Orchestrator] Skipping email ${recordKey} due to fetch error: ${cached.error}`)
        if (queue.index + 1 < queue.emails.length) {
          const nextIndex = queue.index + 1
          setPlayQueue({ ...queue, index: nextIndex })
          selectEmail(queue.emails[nextIndex])
        } else {
          setPlayQueue(null)
          pendingQueuePlayRef.current = false
        }
        return
      }
    }

    pendingQueuePlayRef.current = false
    const res = handleReadThisEmail()
    if (res?.html && onReadAlongReady) {
      onReadAlongReady({
        emailKey: recordKey,
        markedHtml: res.html,
        utteranceText: res.utteranceText,
        wordOffsets: res.wordOffsets
      })
    } else {
      console.warn(`[Orchestrator] Skipping email ${recordKey} because it has no readable text`)
      // Skip this email and go to the next one
      if (queue.index + 1 < queue.emails.length) {
        const nextIndex = queue.index + 1
        setPlayQueue({ ...queue, index: nextIndex })
        pendingQueuePlayRef.current = true
        selectEmail(queue.emails[nextIndex])
      } else {
        setPlayQueue(null)
      }
    }
  }, [
    selectedEmail,
    bodyCache,
    isGoogleProvider,
    playQueue,
    getEmailRecordKey,
    imapUidForGmailListRow,
    handleReadThisEmail,
    onReadAlongReady
  ])

  // Automatic progression to next page if mode is 'unread'
  useEffect(() => {
    const queue = playQueue
    if (!queue?.awaitingNextPage) return
    if (loading) return
    const { pagedFiltered } = stateRef.current
    const unreadEmails = (pagedFiltered || []).filter(e => e.unread)
    if (unreadEmails.length === 0) {
      setPlayQueue(null)
      setIsAudioPaused(true)
      return
    }
    setPlayQueue({ emails: unreadEmails, index: 0, mode: 'unread', awaitingNextPage: false })
    pendingQueuePlayRef.current = true
    selectEmail(unreadEmails[0])
  }, [playQueue, loading, setPlayQueue, setIsAudioPaused, selectEmail])

  return {
    handleReadThisEmail,
    speakUnreadEmails,
    startReadAlongSpeech,
  }
}
