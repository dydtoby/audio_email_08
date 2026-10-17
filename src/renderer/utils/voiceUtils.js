/**
 * Utility functions for Text-to-Speech (TTS) and voice settings.
 */

export const PAUSE_SECONDS_DEFAULT = 1.0

export function speedToRate(speedLabel) {
  const key = String(speedLabel ?? '')
    .trim()
    .toLowerCase()
  if (key === 'slow') return 0.58
  if (key === 'fast') return 1.72
  return 1.0
}

export function computeSentenceStarts(text) {
  if (!text) return []
  const re = /[.!?。！？](\s+|$)/g
  const starts = [0]
  let m
  while ((m = re.exec(text)) !== null) {
    let next = m.index + m[0].length
    while (next < text.length && /\s/.test(text[next])) next += 1
    if (next < text.length) starts.push(next)
  }
  return starts
}

/** Indices where a new paragraph begins after blank line(s) (body-local). */
export function computeParagraphGapStarts(text) {
  const raw = String(text ?? '')
  const out = []
  const re = /\n\n+/g
  let m
  while ((m = re.exec(raw)) !== null) {
    let j = m.index + m[0].length
    while (j < raw.length && /\s/.test(raw[j])) j += 1
    if (j > 0 && j < raw.length) out.push(j)
  }
  return out
}

/** Sentence + paragraph boundaries for read-along body chunking (body-local, sorted). */
export function computeReadAlongBodyPauseStarts(text) {
  const s = String(text ?? '')
  if (!s) return []
  const merged = [
    ...new Set([
      ...computeSentenceStarts(s),
      ...computeParagraphGapStarts(s),
    ]),
  ]
  merged.sort((a, b) => a - b)
  return merged
}

export function findNextSentenceStart(currentEnd, sentenceStarts) {
  if (!sentenceStarts?.length) return null
  for (const s of sentenceStarts) {
    if (s > currentEnd) return s
  }
  return null
}

export function normalizePauseSeconds(val) {
  const n = Number(val)
  return Number.isFinite(n) ? Math.max(0, Math.min(n, 5)) : PAUSE_SECONDS_DEFAULT
}

export function resolveSpeechVoice(selectedVoiceUri, gender) {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : null
  if (!synth) return null
  const voices = synth.getVoices()
  if (selectedVoiceUri) {
    const v = voices.find(x => x.voiceURI === selectedVoiceUri)
    if (v) return v
  }
  const target = String(gender || 'Female').toLowerCase()
  return voices.find(v => v.name.toLowerCase().includes(target)) || voices[0] || null
}

export function getDefaultAudioButtonPosition() {
  if (typeof window === 'undefined') return { x: 20, y: 20 }
  return {
    x: window.innerWidth - 80,
    y: window.innerHeight - 80
  }
}
