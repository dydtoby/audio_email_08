/**
 * Smoke: voicePipeline.normalizeEmailForTts normalisation (no HTTP).
 * Run: node test/smoke/voice_pipeline_normalize_smoke.js
 */

const path = require('path')
const assert = require('assert')

const modPath = path.join(__dirname, '..', '..', 'src', 'main', 'integration', 'voicePipeline.js')
const { normalizeEmailForTts } = require(modPath)

function main() {
  const empty = normalizeEmailForTts()
  assert.deepStrictEqual(empty.links, [])
  assert.deepStrictEqual(empty.images, [])
  assert.deepStrictEqual(empty.attachments, [])
  assert.strictEqual(empty.number_of_detected_links, 0)
  assert.strictEqual(empty.number_of_detected_images, 0)

  const rich = normalizeEmailForTts({
    sender: 'Alice',
    receiver: 'Bob',
    attachments: null,
    links: ['http://a'],
    number_of_detected_links: '2',
  })
  assert.strictEqual(rich.sender, 'Alice')
  assert.deepStrictEqual(rich.attachments, [])
  assert.strictEqual(rich.number_of_detected_links, 2)
  assert.strictEqual(rich.number_of_detected_images, 0)

  console.log('[voice_pipeline_normalize_smoke] ok')
}

main()
