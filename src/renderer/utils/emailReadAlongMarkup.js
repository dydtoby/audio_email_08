/**
 * Injects per-word spans into email HTML for read-along highlighting.
 * The utterance string is derived only from those spans so SpeechSynthesis
 * boundary charIndex values stay aligned with the DOM.
 */

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT'])

/** Prefer these block roots so paragraph / list / cell boundaries get pauses in the utterance. */
const BLOCK_ANCHOR_SELECTOR =
  'p, li, td, th, h1, h2, h3, h4, h5, h6, blockquote, address, pre, figcaption'

/**
 * @param {Element} span
 * @returns {Element}
 */
function getBlockAnchor(span) {
  const el = span.closest(BLOCK_ANCHOR_SELECTOR)
  if (el) return el
  const fallback = span.closest('div, section, article, main, table, tbody, thead, tfoot, tr, ol, ul, body')
  return fallback || span.ownerDocument.body
}

/**
 * Collect the literal DOM text (punctuation, spaces) that lives between two
 * adjacent `.tts-word` spans inside the same block, normalized for speech.
 * Falls back to a single space so words are never glued together.
 * @param {Element} a
 * @param {Element} b
 * @returns {string}
 */
function collectBetweenWordsText(a, b) {
  try {
    const doc = a.ownerDocument || b.ownerDocument
    const range = doc.createRange()
    range.setStartAfter(a)
    range.setEndBefore(b)
    const raw = range.toString()
    range.detach?.()
    const cleaned = String(raw ?? '')
      .replace(/\u00a0/g, ' ')
      .replace(/[\u200b-\u200d\ufeff]/g, '')
      .replace(/\s+/g, ' ')
    return cleaned || ' '
  } catch {
    return ' '
  }
}

/**
 * Safe token tweaks for speech only (does not change DOM spans).
 * @param {string} text
 * @returns {string}
 */
export function normalizeWordTokenForSpeech(text) {
  if (!text) return ''
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
}

const TTS_STYLE = `
.tts-word--current {
  background-color: rgba(255, 230, 0, 0.88);
  border-radius: 2px;
}
`.trim()

function ensureTtsStyle(doc) {
  if (doc.getElementById('tts-read-along-styles')) return
  const style = doc.createElement('style')
  style.id = 'tts-read-along-styles'
  style.textContent = TTS_STYLE
  const head = doc.head
  if (head) head.appendChild(style)
  else {
    const html = doc.documentElement
    const h = doc.createElement('head')
    h.appendChild(style)
    html.insertBefore(h, html.firstChild)
  }
}

/**
 * @param {string} text
 * @param {Document} doc
 * @param {{ i: number }} counter
 * @returns {DocumentFragment}
 */
function textNodeToFragment(text, doc, counter) {
  const fragment = doc.createDocumentFragment()
  if (!text) return fragment

  const hasSegmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'

  if (hasSegmenter) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' })
    for (const seg of segmenter.segment(text)) {
      const part = text.slice(seg.index, seg.index + seg.segment.length)
      if (!part) continue
      if (seg.isWordLike) {
        const span = doc.createElement('span')
        span.className = 'tts-word'
        span.setAttribute('data-tts-i', String(counter.i))
        span.textContent = part
        counter.i += 1
        fragment.appendChild(span)
      } else {
        fragment.appendChild(doc.createTextNode(part))
      }
    }
    return fragment
  }

  // Fallback: non–word-like runs vs words (Latin-ish)
  const re = /(\s+)|([^\s]+)/g
  let m
  while ((m = re.exec(text)) !== null) {
    if (m[1]) {
      fragment.appendChild(doc.createTextNode(m[1]))
    } else if (m[2]) {
      const span = doc.createElement('span')
      span.className = 'tts-word'
      span.setAttribute('data-tts-i', String(counter.i))
      span.textContent = m[2]
      counter.i += 1
      fragment.appendChild(span)
    }
  }
  return fragment
}

function processTextNode(textNode, doc, counter) {
  const text = textNode.nodeValue
  if (text == null || !/\S/.test(text)) return

  const parent = textNode.parentNode
  if (!parent) return

  const fragment = textNodeToFragment(text, doc, counter)
  parent.replaceChild(fragment, textNode)
}

function walkForTts(node, doc, counter) {
  if (node.nodeType === Node.ELEMENT_NODE) {
    if (SKIP_TAGS.has(node.tagName)) return
    if (node.tagName === 'SVG') return
  }

  if (node.nodeType === Node.TEXT_NODE) {
    processTextNode(node, doc, counter)
    return
  }

  const children = [...node.childNodes]
  for (const child of children) {
    walkForTts(child, doc, counter)
  }
}

/**
 * @param {{ charStart: number, charEnd: number }[]} wordOffsets sorted by charStart
 * @param {number} charIndex from SpeechSynthesis boundary
 * @returns {number} word index
 */
export function findWordIndexForChar(charIndex, wordOffsets) {
  if (!wordOffsets.length) return -1
  let lo = 0
  let hi = wordOffsets.length - 1
  let ans = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (wordOffsets[mid].charStart <= charIndex) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}

/**
 * Wrap plain text as a minimal HTML document body for markup injection.
 * @param {string} plain
 * @returns {string}
 */
export function plainEmailTextToHtml(plain) {
  const safe = String(plain ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const paras = safe.split(/\n\n+/).map(p => `<p>${p.replace(/\n/g, '<br/>')}</p>`)
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body>${paras.join('')}</body></html>`
}

/**
 * @param {string} htmlString raw email HTML (full or fragment)
 * @returns {{ html: string, utteranceText: string, wordOffsets: { index: number, charStart: number, charEnd: number, text: string }[] }}
 */
export function injectReadAlongMarkup(htmlString) {
  const raw = String(htmlString ?? '').trim()
  if (!raw) {
    return { html: raw, utteranceText: '', wordOffsets: [] }
  }

  const parser = new DOMParser()
  const doc = parser.parseFromString(raw, 'text/html')

  const counter = { i: 0 }
  const body = doc.body
  if (body) {
    walkForTts(body, doc, counter)
  }

  ensureTtsStyle(doc)

  const spans = [...doc.querySelectorAll('.tts-word')]
  let utteranceText = ''
  /** @type {{ index: number, charStart: number, charEnd: number, text: string }[]} */
  const wordOffsets = []

  spans.forEach((el, i) => {
    const text = normalizeWordTokenForSpeech(el.textContent ?? '')

    if (i > 0) {
      const prevEl = spans[i - 1]
      const a0 = getBlockAnchor(prevEl)
      const a1 = getBlockAnchor(el)
      if (a0 !== a1) {
        utteranceText += '\n\n'
      } else {
        utteranceText += collectBetweenWordsText(prevEl, el)
      }
    }

    const charStart = utteranceText.length
    utteranceText += text
    const charEnd = utteranceText.length
    wordOffsets.push({ index: i, charStart, charEnd, text })
  })

  const html = doc.documentElement ? doc.documentElement.outerHTML : raw

  return { html, utteranceText, wordOffsets }
}

/**
 * Build read-along markup from plain text (e.g. backend html2text output).
 * Escapes HTML then reuses the same span / wordOffsets pipeline as email HTML.
 *
 * @param {string} plainText
 * @returns {{ html: string, utteranceText: string, wordOffsets: { index: number, charStart: number, charEnd: number, text: string }[] }}
 */
export function injectReadAlongMarkupFromPlainText(plainText) {
  return injectReadAlongMarkup(plainEmailTextToHtml(plainText ?? ''))
}

/**
 * Removes the .tts-word--current class from all elements in the given document.
 * @param {Document} doc
 */
export function clearWordHighlight(doc) {
  if (!doc) return
  doc.querySelectorAll('.tts-word--current').forEach(el => el.classList.remove('tts-word--current'))
}

/**
 * Highlights a specific word in the given document and scrolls it into view.
 * @param {Document} doc
 * @param {number} wordIndex
 */
export function applyWordHighlight(doc, wordIndex) {
  if (!doc || wordIndex < 0) return
  clearWordHighlight(doc)
  const span = doc.querySelector(`[data-tts-i="${wordIndex}"]`)
  if (span) {
    span.classList.add('tts-word--current')
    span.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
}
