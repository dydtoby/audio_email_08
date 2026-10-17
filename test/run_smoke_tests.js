#!/usr/bin/env node
/**
 * Runs all Node smoke scripts under test/ (fast, no Python services).
 * Usage: node test/run_smoke_tests.js
 */

const { spawnSync } = require('child_process')
const path = require('path')

const SCRIPTS = [
  'smoke/store_encryption_smoke.js',
  'smoke/cron_scheduler_smoke.js',
  'smoke/voice_pipeline_normalize_smoke.js',
  'smoke/tts_control_smoke.js',
  'data/validate_test_emails_smoke.js',
]

function main() {
  const root = path.join(__dirname)

  for (const rel of SCRIPTS) {
    const full = path.join(root, rel)
    process.stdout.write(`\n→ ${rel}\n`)
    const r = spawnSync(process.execPath, [full], {
      stdio: 'inherit',
      env: process.env,
      cwd: path.join(root, '..'),
    })
    if (r.status !== 0) {
      process.exit(r.status == null ? 1 : r.status)
    }
  }

  console.log(`\nSmoke suite passed (${SCRIPTS.length} scripts).`)
}

main()
