/**
 * Smoke: src/data/test_emails.json is valid JSON and minimally shaped.
 * Run: node test/data/validate_test_emails_smoke.js
 */

const fs = require('fs')
const path = require('path')
const assert = require('assert')

const jsonPath = path.join(__dirname, '..', '..', 'src', 'data', 'test_emails.json')

function coerceEmailArray(parsed) {
  if (Array.isArray(parsed)) return parsed
  if (parsed && Array.isArray(parsed.emails)) return parsed.emails
  return null
}

function main() {
  const raw = fs.readFileSync(jsonPath, 'utf8')
  const parsed = JSON.parse(raw)
  const emails = coerceEmailArray(parsed)
  assert.ok(emails != null, 'test_emails.json must be [] or { "emails": [...] }')
  assert.ok(emails.length > 0, 'test_emails.json must not be empty')

  for (let i = 0; i < emails.length; i += 1) {
    const e = emails[i]
    assert.ok(e && typeof e === 'object', `entry ${i} must be an object`)
    assert.ok(
      typeof e.subject === 'string' || typeof e.body === 'string',
      `entry ${i}: expected subject or body string`
    )
  }

  console.log(`[validate_test_emails_smoke] ok (${emails.length} emails)`)
}

main()
