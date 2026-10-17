#!/usr/bin/env node
/**
 * IMAP smoke using the same Gmail XOAUTH2 style as the app (refresh token → access token).
 * Use a refresh token from OAuth Playground or a one-off script; scopes must include Gmail IMAP
 * (e.g. https://mail.google.com/ as in the app).
 *
 * Requires: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
 *           TEST_GMAIL_USER (mailbox), TEST_GMAIL_REFRESH_TOKEN
 * Optional: GOOGLE_REDIRECT_URI (must match OAuth client registration)
 */

const path = require('path')
const { google } = require('googleapis')
const { ImapFlow } = require('imapflow')

const ROOT = path.join(__dirname, '..', '..')
require('dotenv').config({ path: path.join(ROOT, '.env') })

async function main() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/callback'
  const user = process.env.TEST_GMAIL_USER
  const refreshToken = process.env.TEST_GMAIL_REFRESH_TOKEN

  if (!clientId || !clientSecret || !user || !refreshToken) {
    console.error(
      '[gmail_imap_refresh_token_test] Need GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, TEST_GMAIL_USER, TEST_GMAIL_REFRESH_TOKEN'
    )
    process.exit(1)
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri)
  oauth2.setCredentials({ refresh_token: refreshToken })
  const res = await oauth2.getAccessToken()
  const accessToken =
    (res && typeof res === 'object' && res.token) ||
    (typeof res === 'string' ? res : null) ||
    oauth2.credentials?.access_token ||
    null
  if (!accessToken || typeof accessToken !== 'string') {
    console.error('[gmail_imap_refresh_token_test] Could not resolve access_token')
    process.exit(1)
  }

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user, accessToken },
    logger: false,
  })

  await client.connect()

  try {
    const lock = await client.getMailboxLock('INBOX')
    try {
      const st = await client.status('INBOX', { messages: true, unseen: true })
      console.log('[gmail_imap_refresh_token_test] INBOX:', { messages: st.messages, unseen: st.unseen })
    } finally {
      lock.release()
    }
  } finally {
    await client.logout().catch(() => {})
  }

  console.log('[gmail_imap_refresh_token_test] ok')
}

main().catch((err) => {
  console.error('[gmail_imap_refresh_token_test] failed:', err.message || err)
  process.exit(1)
})
