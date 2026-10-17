#!/usr/bin/env node
/**
 * IMAP smoke: logs in with username + password (app password / provider account).
 * Gmail: enable 2FA and create an «App password» (not your normal login password).
 *
 * Requires: TEST_IMAP_HOST (optional), TEST_IMAP_USER, TEST_IMAP_PASS
 * Optional: TEST_IMAP_PORT (default 993), TEST_IMAP_SECURE (default 1; set 0 for STARTTLS quirks)
 */

const path = require('path')
const { ImapFlow } = require('imapflow')

const ROOT = path.join(__dirname, '..', '..')
require('dotenv').config({ path: path.join(ROOT, '.env') })

async function main() {
  const host = process.env.TEST_IMAP_HOST || 'imap.gmail.com'
  const user = process.env.TEST_IMAP_USER
  const pass = process.env.TEST_IMAP_PASS
  const port = parseInt(process.env.TEST_IMAP_PORT || '993', 10)
  const secure = process.env.TEST_IMAP_SECURE !== '0' && process.env.TEST_IMAP_SECURE !== 'false'

  if (!user || !pass) {
    console.error('[imap_app_password_test] Missing TEST_IMAP_USER or TEST_IMAP_PASS in .env')
    process.exit(1)
  }

  const client = new ImapFlow({
    host,
    port,
    secure,
    auth: { user, pass },
    logger: false,
  })

  await client.connect()

  try {
    const lock = await client.getMailboxLock('INBOX')
    try {
      const st = await client.status('INBOX', { messages: true, unseen: true, uidNext: true })
      console.log('[imap_app_password_test] INBOX status:', {
        messages: st.messages,
        unseen: st.unseen,
      })

      const total = client.mailbox?.exists || 0
      if (total > 0) {
        const seq = `${Math.max(1, total)}:${Math.max(1, total)}`
        for await (const msg of client.fetch(seq, { uid: true, envelope: true })) {
          console.log('[imap_app_password_test] sample envelope uid=', msg.uid, 'subject=', msg.envelope?.subject || '')
          break
        }
      }
    } finally {
      lock.release()
    }
  } finally {
    await client.logout().catch(() => {})
  }

  console.log('[imap_app_password_test] ok')
}

main().catch((err) => {
  console.error('[imap_app_password_test] failed:', err.message || err)
  process.exit(1)
})
