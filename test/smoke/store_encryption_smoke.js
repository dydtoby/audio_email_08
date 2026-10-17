/**
 * Smoke: storeEncryption key resolution (no Electron).
 * Run: node test/smoke/store_encryption_smoke.js
 */

const path = require('path')
const assert = require('assert')

function loadFresh() {
  const modPath = path.join(__dirname, '..', '..', 'src', 'main', 'storeEncryption.js')
  delete require.cache[require.resolve(modPath)]
  return require(modPath)
}

function main() {
  delete process.env.DB_ENCRYPTION_KEY
  const { getStoreEncryptionKey } = loadFresh()
  assert.strictEqual(getStoreEncryptionKey(), 'audio-emailer-team08-store-key-v1')

  process.env.DB_ENCRYPTION_KEY = '  custom-key  '
  const { getStoreEncryptionKey: key2 } = loadFresh()
  assert.strictEqual(key2(), 'custom-key')

  console.log('[store_encryption_smoke] ok')
}

main()
