/**
 * Smoke: scheduler module loads and exports expected API.
 * Run: node test/smoke/cron_scheduler_smoke.js
 */

const path = require('path')
const assert = require('assert')

const modPath = path.join(__dirname, '..', '..', 'src', 'main', 'scheduler', 'cronScheduler.js')
const mod = require(modPath)

assert.strictEqual(typeof mod.scheduleJob, 'function')
assert.strictEqual(typeof mod.cancelJob, 'function')

console.log('[cron_scheduler_smoke] ok')
