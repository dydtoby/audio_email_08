'use strict'

/**
 * Local persistence uses electron-store + optional AES. If only dev sets
 * DB_ENCRYPTION_KEY and packaged app does not, the same userData file is
 * unreadable (JSON.parse on ciphertext). Use env when set, else a fixed
 * fallback so dev (no .env) and installer builds share one format.
 */
function getStoreEncryptionKey() {
  const k = process.env.DB_ENCRYPTION_KEY
  if (k != null && String(k).trim()) return String(k).trim()
  return 'audio-emailer-team08-store-key-v1'
}

module.exports = { getStoreEncryptionKey }
