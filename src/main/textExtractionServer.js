/**
 * Spawn html2text / Flask text-extraction service and stop it on app quit.
 * Works in both dev and packaged app.
 */
'use strict'

const { spawn } = require('child_process')
const path = require('path')
const http = require('http')
const fs = require('fs')
const { app } = require('electron')

const DEFAULT_PORT = 5000

let childProcess = null

function extractionSrcDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'text_extraction', 'src')
  }
  return path.join(__dirname, '..', 'text_extraction', 'src')
}

function resolvePythonExecutable() {
  const fromEnv = process.env.PYTHON || process.env.PYTHON_EXECUTABLE
  if (fromEnv && String(fromEnv).trim()) return String(fromEnv).trim()
  if (app.isPackaged && process.platform === 'win32') {
    // Optional bundled executable path; if present we prefer it.
    const bundledExe = path.join(process.resourcesPath, 'text_extraction', 'text_extraction_server.exe')
    if (fs.existsSync(bundledExe)) return bundledExe
  }
  return process.platform === 'win32' ? 'python' : 'python3'
}

function shouldAutoStart() {
  if (process.env.TEXT_EXTRACTION_AUTOSTART === '0') return false
  const u = String(process.env.TEXT_EXTRACTION_URL || '').trim()
  if (!u) return true
  return /127\.0\.0\.1:5000|localhost:5000/i.test(u)
}

function waitForTextExtractionReady(port = DEFAULT_PORT, timeoutMs = 25000) {
  const host = '127.0.0.1'
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(`http://${host}:${port}/`, (res) => {
        res.resume()
        resolve()
      })
      req.on('error', () => {
        if (Date.now() - started > timeoutMs) {
          reject(
            new Error(
              `Text extraction server (html2text) not reachable at http://${host}:${port} within ${timeoutMs}ms`
            )
          )
        } else {
          setTimeout(tick, 300)
        }
      })
    }
    tick()
  })
}

async function startTextExtractionServer() {
  if (!shouldAutoStart()) {
    console.log('[textExtraction] Skip auto-start (TEXT_EXTRACTION_AUTOSTART=0 or remote TEXT_EXTRACTION_URL).')
    return
  }
  if (childProcess) {
    console.log('[textExtraction] Already running.')
    return
  }

  const cwd = extractionSrcDir()
  const python = resolvePythonExecutable()
  const isBundledExe = python.toLowerCase().endsWith('.exe') && python.toLowerCase().includes('text_extraction_server')
  const args = isBundledExe ? [] : ['app.py']

  childProcess = spawn(python, args, {
    cwd,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  childProcess.stdout.on('data', (chunk) => {
    process.stdout.write(`[textExtraction] ${chunk}`)
  })
  childProcess.stderr.on('data', (chunk) => {
    process.stderr.write(`[textExtraction] ${chunk}`)
  })
  childProcess.on('exit', (code, signal) => {
    console.log(`[textExtraction] Python process exited code=${code} signal=${signal}`)
    childProcess = null
  })
  childProcess.on('error', (err) => {
    console.error('[textExtraction] Failed to spawn Python:', err.message)
    childProcess = null
  })

  await waitForTextExtractionReady(DEFAULT_PORT)
  console.log(`[textExtraction] Ready at http://127.0.0.1:${DEFAULT_PORT}`)
}

function stopTextExtractionServer() {
  if (!childProcess) return
  try {
    childProcess.kill()
  } catch (err) {
    console.warn('[textExtraction] kill:', err.message)
  }
  childProcess = null
}

module.exports = {
  startTextExtractionServer,
  stopTextExtractionServer,
}
