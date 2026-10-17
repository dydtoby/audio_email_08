#!/usr/bin/env node
/**
 * Runs mail integration scripts for which you have configured .env variables.
 * Nothing runs if no block is configured → exit 1 with instructions.
 *
 * Usage: npm run test:mail
 * Optional: MAIL_TEST_ONLY=smtp|imap|oauth  (run a single suite)
 */

const { spawnSync } = require('child_process')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
require('dotenv').config({ path: path.join(ROOT, '.env') })

function hasImapPassword() {
  return !!(process.env.TEST_IMAP_USER && process.env.TEST_IMAP_PASS)
}

function hasGmailRefresh() {
  return !!(
    process.env.TEST_GMAIL_USER &&
    process.env.TEST_GMAIL_REFRESH_TOKEN &&
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET
  )
}

function hasSmtp() {
  const h = process.env.TEST_SMTP_HOST || process.env.SMTP_HOST
  const u = process.env.TEST_SMTP_USER || process.env.SMTP_USER
  const p = process.env.TEST_SMTP_PASS || process.env.SMTP_PASS
  return !!(h && u && p)
}

const SUITES = [
  {
    name: 'smtp',
    script: 'smtp_verify_test.js',
    when: hasSmtp,
  },
  {
    name: 'imap',
    script: 'imap_app_password_test.js',
    when: hasImapPassword,
  },
  {
    name: 'oauth',
    script: 'gmail_imap_refresh_token_test.js',
    when: hasGmailRefresh,
  },
]

function main() {
  const only = (process.env.MAIL_TEST_ONLY || '').trim().toLowerCase()

  const active = SUITES.filter((s) => {
    if (!s.when()) return false
    if (!only) return true
    return s.name === only
  })

  if (only && active.length === 0) {
    console.error(`MAIL_TEST_ONLY="${only}" did not match any configured suite (available: smtp, imap, oauth).`)
    process.exit(1)
  }

  if (active.length === 0) {
    console.error(`
[test:mail] No mail test configuration found. Add at least one block to .env:

  • IMAP (app password): TEST_IMAP_USER, TEST_IMAP_PASS  (optional TEST_IMAP_HOST, default imap.gmail.com)

  • Gmail IMAP (OAuth refresh): GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, TEST_GMAIL_USER, TEST_GMAIL_REFRESH_TOKEN

  • SMTP: TEST_SMTP_* or SMTP_* (host, user, pass). Optional TEST_SMTP_SEND=1 to send a test message.

See .env.example (mail tests section).
`)
    process.exit(1)
  }

  const emailDir = path.join(__dirname)

  for (const s of active) {
    const full = path.join(emailDir, s.script)
    process.stdout.write(`\n→ mail/${s.script} (${s.name})\n`)
    const r = spawnSync(process.execPath, [full], {
      stdio: 'inherit',
      env: process.env,
      cwd: ROOT,
    })
    if (r.status !== 0) process.exit(r.status == null ? 1 : r.status)
  }

  console.log(`\nMail tests passed (${active.length} suite(s)).`)
}

main()
