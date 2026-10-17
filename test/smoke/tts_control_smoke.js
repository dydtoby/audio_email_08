/**
 * Smoke: voicePipeline.ttsControl rejects unknown actions (no HTTP for happy path).
 * Run: node test/smoke/tts_control_smoke.js
 */

const path = require('path')
const assert = require('assert')

const modPath = path.join(__dirname, '..', '..', 'src', 'main', 'integration', 'voicePipeline.js')
const { ttsControl } = require(modPath)

async function main() {
  await assert.rejects(() => ttsControl('nope'), /Invalid TTS action/)
  console.log('[tts_control_smoke] ok')
}

main().catch((err) => {
  console.error('[tts_control_smoke] failed:', err)
  process.exit(1)
})
