#!/usr/bin/env node
/**
 * End-to-end smoke test for:
 * 1) text_extraction service (5000)
 * 2) tts service (5001)
 * 3) backend voice pipeline glue code
 *
 * Usage:
 *   node test/audio/email_connect/run_email_connect_test.js
 */

const path = require('path');
const fs = require('fs/promises');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const EXTRACTION_URL = process.env.TEXT_EXTRACTION_URL || 'http://127.0.0.1:5000';
const TTS_URL = process.env.TTS_BASE_URL || 'http://127.0.0.1:5001';
const EXTRACTION_HEALTH = `${EXTRACTION_URL}/process-email`;
const TTS_HEALTH = `${TTS_URL}/voices`;

const EXTRACTION_APP = path.join(ROOT, 'src', 'text_extraction', 'src', 'app.py');
const TTS_APP = path.join(ROOT, 'src', 'tts', 'tts.py');
const VOICE_PIPELINE_MODULE = path.join(ROOT, 'src', 'main', 'integration', 'voicePipeline.js');
const TEST_EMAILS_JSON = path.join(ROOT, 'src', 'data', 'test_emails.json');

const startedChildren = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isExtractionUp() {
  try {
    const body = { html: '<html><body><p>health</p></body></html>' };
    const res = await fetch(EXTRACTION_HEALTH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function isTtsUp() {
  try {
    const res = await fetch(TTS_HEALTH);
    return res.ok;
  } catch {
    return false;
  }
}

function startPython(scriptPath, label) {
  const child = spawn('python', [scriptPath], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  child.stdout.on('data', (buf) => {
    process.stdout.write(`[${label}] ${buf}`);
  });
  child.stderr.on('data', (buf) => {
    process.stderr.write(`[${label}:err] ${buf}`);
  });
  child.on('exit', (code) => {
    process.stdout.write(`[${label}] exited with code ${code}\n`);
  });

  startedChildren.push(child);
  return child;
}

async function waitFor(predicate, label, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    if (await predicate()) return;
    // eslint-disable-next-line no-await-in-loop
    await sleep(500);
  }
  throw new Error(`${label} did not become ready within ${timeoutMs}ms`);
}

async function loadSeedEmail() {
  const raw = await fs.readFile(TEST_EMAILS_JSON, 'utf-8');
  const parsed = JSON.parse(raw);
  const emails = Array.isArray(parsed) ? parsed : parsed?.emails;
  if (!Array.isArray(emails) || emails.length === 0) {
    throw new Error('test_emails.json is empty or invalid');
  }
  return emails[0];
}

function buildHtmlFromEmail(email) {
  const fromName = email?.fromName || '';
  const fromEmail = email?.fromEmail || '';
  const toField = Array.isArray(email?.to) ? email.to.join(', ') : String(email?.to || '');
  const subject = email?.subject || '';
  const date = email?.date || '';
  const body = String(email?.body || '').replaceAll('\n\n', '</p><p>').replaceAll('\n', '<br/>');
  const attachmentNames = Array.isArray(email?.attachments)
    ? email.attachments
        .map((a) => (a && typeof a === 'object' ? a.name : a))
        .filter(Boolean)
        .join(', ')
    : '';

  return `
    <html><body>
      <div>From: ${fromName}${fromEmail ? ` <${fromEmail}>` : ''}</div>
      <div>To: ${toField}</div>
      <div>Subject: ${subject}</div>
      <div>Date: ${date}</div>
      <p>${body}</p>
      <div>Attachments: ${attachmentNames}</div>
    </body></html>
  `;
}

async function runExtractionTest() {
  const seedEmail = await loadSeedEmail();
  const sampleHtml = buildHtmlFromEmail(seedEmail);

  const res = await fetch(EXTRACTION_HEALTH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html: sampleHtml }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Extraction test failed: HTTP ${res.status} ${text}`);
  }

  const json = await res.json();
  if (!json?.email_data?.body) throw new Error('Extraction test failed: missing email_data.body');
  if (!Array.isArray(json?.email_data?.attachments)) {
    throw new Error('Extraction test failed: email_data.attachments is not an array');
  }

  console.log('[test] extraction ok');
  return json;
}

async function runPipelineTest() {
  const pipeline = require(VOICE_PIPELINE_MODULE);
  try {
    // Make the test idempotent if a previous speech task is still running.
    await fetch(`${TTS_URL}/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  } catch {
    // If stop fails, continue and let the main assertion capture real failure.
  }

  const seedEmail = await loadSeedEmail();
  const sampleHtml = buildHtmlFromEmail(seedEmail);

  const result = await pipeline.speakFromHtml({
    html: sampleHtml,
    voice: 'Samantha (US)',
    speed: 'normal',
  });

  if (result?.tts?.status !== 'started') {
    throw new Error(`Pipeline test failed: unexpected TTS status ${JSON.stringify(result?.tts)}`);
  }

  console.log('[test] pipeline e2e ok');
  return result;
}

async function cleanup() {
  for (const child of startedChildren) {
    if (!child.killed) {
      child.kill('SIGTERM');
      await sleep(100);
      if (!child.killed) child.kill('SIGKILL');
    }
  }
}

async function main() {
  let extractionOwned = false;
  let ttsOwned = false;

  process.on('SIGINT', async () => {
    await cleanup();
    process.exit(130);
  });
  process.on('SIGTERM', async () => {
    await cleanup();
    process.exit(143);
  });

  try {
    const extractionUp = await isExtractionUp();
    if (!extractionUp) {
      console.log('[setup] starting text_extraction service...');
      startPython(EXTRACTION_APP, 'extract');
      extractionOwned = true;
    } else {
      console.log('[setup] text_extraction already running');
    }

    const ttsUp = await isTtsUp();
    if (!ttsUp) {
      console.log('[setup] starting tts service...');
      startPython(TTS_APP, 'tts');
      ttsOwned = true;
    } else {
      console.log('[setup] tts already running');
    }

    await waitFor(isExtractionUp, 'text_extraction');
    await waitFor(isTtsUp, 'tts');

    const extractionResult = await runExtractionTest();
    const pipelineResult = await runPipelineTest();

    console.log('\n=== TEST SUMMARY ===');
    console.log(
      JSON.stringify(
        {
          extraction: {
            sender: extractionResult?.email_data?.sender || '',
            receiver: extractionResult?.email_data?.receiver || '',
            subject: extractionResult?.email_data?.subject || '',
            attachmentsCount: extractionResult?.email_data?.attachments?.length || 0,
          },
          pipeline: {
            ttsStatus: pipelineResult?.tts?.status || 'unknown',
            voice: pipelineResult?.tts?.voice || '',
            speed: pipelineResult?.tts?.speed || '',
          },
          servicesStartedByScript: {
            extraction: extractionOwned,
            tts: ttsOwned,
          },
        },
        null,
        2
      )
    );
    console.log('\nAll checks passed.');
  } catch (err) {
    console.error('\nTest failed:', err?.message || err);
    process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

main();
