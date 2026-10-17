#!/usr/bin/env node
/**
 * SMTP connectivity: nodemailer verify() via app smtpClient.
 * Credentials: TEST_SMTP_* overrides; else falls back to SMTP_* (same keys as src/main/main.js).
 *
 * Optional: TEST_SMTP_SEND=1 sends a trivial message to TEST_SMTP_TO (default = user).
 */

const path = require('path')
const { verifySmtp, sendMail } = require('../../src/main/email/smtpClient')

const ROOT = path.join(__dirname, '..', '..')
require('dotenv').config({ path: path.join(ROOT, '.env') })

function pick(primary, fallback) {
  const a = primary != null && String(primary).trim() !== '' ? String(primary).trim() : ''
  const b = fallback != null && String(fallback).trim() !== '' ? String(fallback).trim() : ''
  return a || b || ''
}

function buildSmtpOptions() {
  const host = pick(process.env.TEST_SMTP_HOST, process.env.SMTP_HOST)
  const user = pick(process.env.TEST_SMTP_USER, process.env.SMTP_USER)
  const pass = pick(process.env.TEST_SMTP_PASS, process.env.SMTP_PASS)
  const portRaw = pick(process.env.TEST_SMTP_PORT, process.env.SMTP_PORT)
  const port = parseInt(portRaw || '465', 10)
  const secureRaw = pick(process.env.TEST_SMTP_SECURE, process.env.SMTP_SECURE).toLowerCase()
  let secure = port === 465
  if (secureRaw === '0' || secureRaw === 'false') secure = false
  if (secureRaw === '1' || secureRaw === 'true') secure = true

  const ok = !!(host && user && pass)
  const smtp = { host, port, secure, auth: { user, pass } }
  return { ok, smtp }
}

async function main() {
  const { ok, smtp: smtpOptions } = buildSmtpOptions()

  if (!ok) {
    console.error('[smtp_verify_test] Need host+user+pass via TEST_SMTP_* or SMTP_* in .env')
    process.exit(1)
  }

  console.log('[smtp_verify_test] verify…', smtpOptions.host, 'port', smtpOptions.port)
  await verifySmtp(smtpOptions)
  console.log('[smtp_verify_test] verify OK')

  if (process.env.TEST_SMTP_SEND === '1' || process.env.TEST_SMTP_SEND === 'true') {
    const to = pick(process.env.TEST_SMTP_TO, '') || smtpOptions.auth.user
    const from =
      pick(process.env.TEST_SMTP_FROM, '') ||
      pick(process.env.SMTP_FROM, '') ||
      smtpOptions.auth.user
    const info = await sendMail({
      smtp: smtpOptions,
      mail: {
        from,
        to,
        subject: `[audio_emailer test] ${new Date().toISOString()}`,
        text: 'SMTP send test — safe to delete.',
      },
    })
    console.log('[smtp_verify_test] send OK', info.messageId || '')
  }

  console.log('[smtp_verify_test] ok')
}

main().catch((err) => {
  console.error('[smtp_verify_test] failed:', err.message || err)
  process.exit(1)
})
