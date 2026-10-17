const DEFAULT_EXTRACTION_BASE_URL = process.env.TEXT_EXTRACTION_URL || 'http://127.0.0.1:5000'
const DEFAULT_TTS_BASE_URL = process.env.TTS_BASE_URL || 'http://127.0.0.1:5001'

function normalizeEmailForTts(email = {}) {
  const n = email.number_of_detected_links
  const m = email.number_of_detected_images
  return {
    uid: email.uid,
    sender: email.sender || '',
    receiver: email.receiver || '',
    subject: email.subject || '',
    date: email.date || '',
    body: email.body || '',
    attachments: Array.isArray(email.attachments) ? email.attachments : [],
    links: Array.isArray(email.links) ? email.links : [],
    images: Array.isArray(email.images) ? email.images : [],
    number_of_detected_links: typeof n === 'number' ? n : Number(n) || 0,
    number_of_detected_images: typeof m === 'number' ? m : Number(m) || 0,
  }
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  let data = null
  try {
    data = await response.json()
  } catch {
    data = null
  }

  if (!response.ok) {
    const reason = data?.error || data?.details || `HTTP ${response.status}`
    throw new Error(`${url} failed: ${reason}`)
  }
  return data
}

async function getJson(url) {
  const response = await fetch(url)
  let data = null
  try {
    data = await response.json()
  } catch {
    data = null
  }
  if (!response.ok) {
    const reason = data?.error || data?.details || `HTTP ${response.status}`
    throw new Error(`${url} failed: ${reason}`)
  }
  return data
}

async function processEmailHtml(html, meta = {}) {
  const extractionUrl = `${DEFAULT_EXTRACTION_BASE_URL}/process-email`
  const requestBody =
    typeof html === 'object' && html !== null && typeof html.html === 'string'
      ? { ...html, ...meta }
      : { html: html ?? '', ...meta }
  const extractionResult = await postJson(extractionUrl, requestBody)
  const email_data =
    extractionResult?.email_data && typeof extractionResult.email_data === 'object'
      ? extractionResult.email_data
      : {}

  return {
    ...extractionResult,
    // Same shape as text_extraction output_email.json (do not strip fields for IPC / read-along).
    email_data,
  }
}

async function speakFromHtml({ html, voice, speed }) {
  const extractionResult = await processEmailHtml(html)
  const payload = { ...normalizeEmailForTts(extractionResult?.email_data || {}) }
  if (voice) payload.voice = voice
  if (speed) payload.speed = speed

  const ttsUrl = `${DEFAULT_TTS_BASE_URL}/speak`
  const ttsResult = await postJson(ttsUrl, payload)

  return { extraction: extractionResult, tts: ttsResult }
}

async function speakEmailData(emailData, { voice, speed } = {}) {
  const payload = normalizeEmailForTts(emailData || {})
  if (voice) payload.voice = voice
  if (speed) payload.speed = speed

  const ttsUrl = `${DEFAULT_TTS_BASE_URL}/speak`
  return postJson(ttsUrl, payload)
}

async function speakUnreadEmails(emails, { voice, speed } = {}) {
  const payload = {
    emails: Array.isArray(emails) ? emails.map((email) => normalizeEmailForTts(email)) : [],
  }
  if (voice) payload.voice = voice
  if (speed) payload.speed = speed

  const ttsUrl = `${DEFAULT_TTS_BASE_URL}/speak/unread`
  return postJson(ttsUrl, payload)
}

async function ttsControl(action) {
  const allowed = new Set(['pause', 'resume', 'stop', 'skip', 'replay'])
  if (!allowed.has(action)) {
    throw new Error(`Invalid TTS action: ${action}`)
  }
  return postJson(`${DEFAULT_TTS_BASE_URL}/${action}`, {})
}

async function getTtsVoices() {
  return getJson(`${DEFAULT_TTS_BASE_URL}/voices`)
}

async function getTtsPreferences() {
  return getJson(`${DEFAULT_TTS_BASE_URL}/preferences`)
}

async function setTtsPreferences({ voice, speed, pauseEnabled, pauseSeconds } = {}) {
  const payload = {}
  if (voice !== undefined) payload.voice = voice
  if (speed !== undefined) payload.speed = speed
  if (pauseEnabled !== undefined) payload.pauseEnabled = !!pauseEnabled
  if (pauseSeconds !== undefined) payload.pauseSeconds = pauseSeconds
  return postJson(`${DEFAULT_TTS_BASE_URL}/preferences`, payload)
}

module.exports = {
  processEmailHtml,
  speakFromHtml,
  speakEmailData,
  speakUnreadEmails,
  ttsControl,
  getTtsVoices,
  getTtsPreferences,
  setTtsPreferences,
  normalizeEmailForTts,
}
