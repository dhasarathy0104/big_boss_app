// Windows tracking agent — zero native npm dependencies.
// Shells out to PowerShell (built into Windows) for active window / idle time / screenshots,
// so no compiler toolchain is needed to run this.
//
// If DESKLOG_INVITE_TOKEN is set on first run, enrollment automatically attaches this
// employee to whichever manager generated that invite link — no manual manager lookup.
//
// Also runs a tiny local HTTP listener the browser extension posts the active tab's
// domain to (see ../browser-extension). Window titles alone don't give you a real URL —
// this is what makes "chrome" time classifiable as github.com vs youtube.com instead of
// a blanket guess.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BACKEND_URL = process.env.DESKLOG_BACKEND_URL || 'http://localhost:4000';
const AGENT_NAME = process.env.DESKLOG_AGENT_NAME || os.userInfo().username;
const INVITE_TOKEN = process.env.DESKLOG_INVITE_TOKEN || null;
const LOCAL_PORT = Number(process.env.DESKLOG_LOCAL_PORT || 34909);
const POLL_INTERVAL_MS = 10_000;
const FLUSH_INTERVAL_MS = 30_000;
const DEFAULT_SCREENSHOT_INTERVAL_MIN = 5;
const SETTINGS_RECHECK_MS = 60_000; // how often we re-check the manager's configured interval
const IDLE_THRESHOLD_SECONDS = 120;
const DOMAIN_FRESHNESS_MS = 20_000; // extension reports on tab/window change, not every poll
const BROWSER_APPS = new Set(['chrome', 'msedge', 'firefox', 'brave', 'opera']);

const configPath = path.join(__dirname, '.agent-config.json');
const queuePath = path.join(__dirname, 'queue.json');

function runPowerShell(scriptFile) {
  return execFileAsync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-File', scriptFile,
  ], { maxBuffer: 20 * 1024 * 1024 });
}

async function getContext() {
  const { stdout } = await runPowerShell(path.join(__dirname, 'get-context.ps1'));
  return JSON.parse(stdout.trim());
}

async function getScreenshotBase64() {
  const { stdout } = await runPowerShell(path.join(__dirname, 'screenshot.ps1'));
  return stdout.trim();
}

function loadConfig() {
  if (fs.existsSync(configPath)) {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
  return null;
}

function saveConfig(cfg) {
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
}

function loadQueue() {
  if (fs.existsSync(queuePath)) {
    try { return JSON.parse(fs.readFileSync(queuePath, 'utf8')); } catch { return []; }
  }
  return [];
}

function saveQueue(queue) {
  fs.writeFileSync(queuePath, JSON.stringify(queue));
}

let lastDomainEvent = null; // { domain, receivedAt } — domain can be null (e.g. internal browser page)
let enrolledName = null;

// The extension only posts on tab/window change, so the domain itself is sticky
// until the next real navigation — no time-based expiry here, or a quiet page
// would spuriously "go stale" and break the activity segment every few seconds.
function getCurrentDomain() {
  return lastDomainEvent ? lastDomainEvent.domain : null;
}

// Separate from the above: only for the extension's /status connectivity check,
// so the popup can tell "installed but quiet" apart from "never connected".
function isExtensionRecentlyActive() {
  return !!lastDomainEvent && (Date.now() - lastDomainEvent.receivedAt) < DOMAIN_FRESHNESS_MS * 15;
}

function startLocalServer() {
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && req.url === '/status') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ connected: true, enrolledAs: enrolledName, receivingDomains: isExtensionRecentlyActive() }));
      return;
    }

    if (req.method === 'POST' && req.url === '/url-event') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          // domain may be explicitly null (internal page, lost focus) — still record it
          // so a stale domain from the previous page doesn't linger.
          lastDomainEvent = { domain: parsed.domain ?? null, receivedAt: Date.now() };
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid body' }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(LOCAL_PORT, '127.0.0.1', () => {
    console.log(`Local listener for the browser extension on http://127.0.0.1:${LOCAL_PORT}`);
  });
  server.on('error', (err) => {
    console.error(`Local listener failed to start (port ${LOCAL_PORT} busy?):`, err.message);
  });
}

async function enroll() {
  enrolledName = AGENT_NAME;
  const existing = loadConfig();
  if (existing) return existing;

  console.log(`Enrolling agent as "${AGENT_NAME}" with ${BACKEND_URL} ...`);
  const res = await fetch(`${BACKEND_URL}/api/enroll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: AGENT_NAME, inviteToken: INVITE_TOKEN }),
  });
  if (!res.ok) throw new Error(`enroll failed: ${res.status} ${await res.text()}`);
  const cfg = await res.json();
  saveConfig(cfg);
  if (cfg.managerName) {
    console.log(`Enrolled as user #${cfg.userId}, joined ${cfg.managerName}'s team`);
  } else {
    console.log(`Enrolled as user #${cfg.userId} (no manager — no invite token supplied)`);
  }
  return cfg;
}

let currentSegment = null;
let eventQueue = loadQueue();

function closeSegment() {
  if (currentSegment) {
    eventQueue.push({
      clientEventId: `${currentSegment.startedAt}_${Math.random().toString(36).slice(2, 8)}`,
      appName: currentSegment.appName,
      windowTitle: currentSegment.windowTitle,
      domain: currentSegment.domain,
      startedAt: currentSegment.startedAt,
      endedAt: currentSegment.endedAt,
      inputCount: currentSegment.inputCount,
      isIdle: currentSegment.isIdle,
    });
    saveQueue(eventQueue);
  }
}

async function poll() {
  try {
    const ctx = await getContext();
    const now = new Date().toISOString();
    const isIdle = ctx.idleSeconds >= IDLE_THRESHOLD_SECONDS;
    const isBrowser = BROWSER_APPS.has((ctx.process || '').toLowerCase());
    const domain = isBrowser ? getCurrentDomain() : null;

    if (
      !currentSegment ||
      currentSegment.appName !== ctx.process ||
      currentSegment.windowTitle !== ctx.title ||
      currentSegment.isIdle !== isIdle ||
      currentSegment.domain !== domain
    ) {
      closeSegment();
      currentSegment = {
        appName: ctx.process || '(unknown)',
        windowTitle: ctx.title || '',
        domain,
        startedAt: now,
        endedAt: now,
        inputCount: isIdle ? 0 : 1,
        isIdle,
      };
    } else {
      currentSegment.endedAt = now;
      if (!isIdle) currentSegment.inputCount += 1;
    }
  } catch (err) {
    console.error('poll error:', err.message);
  }
}

async function flush(cfg) {
  closeSegment();
  currentSegment = null;
  if (eventQueue.length === 0) return;

  try {
    const res = await fetch(`${BACKEND_URL}/api/ingest/activity`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-agent-key': cfg.agentKey },
      body: JSON.stringify({ events: eventQueue }),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    console.log(`flushed ${eventQueue.length} events`);
    eventQueue = [];
    saveQueue(eventQueue);
  } catch (err) {
    console.error('flush failed, will retry next cycle:', err.message);
  }
}

// The manager can change this anytime from the dashboard's Screenshots tab —
// re-checking each cycle means an employee's agent never needs a restart to
// pick up the new cadence. 0 means screenshots are turned off entirely.
async function fetchScreenshotIntervalMinutes(cfg) {
  try {
    const res = await fetch(`${BACKEND_URL}/api/agent-settings`, {
      headers: { 'x-agent-key': cfg.agentKey },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.screenshotIntervalMinutes;
  } catch {
    return null;
  }
}

async function screenshotLoop(cfg) {
  let intervalMinutes = DEFAULT_SCREENSHOT_INTERVAL_MIN;
  for (;;) {
    const fetched = await fetchScreenshotIntervalMinutes(cfg);
    if (fetched !== null) intervalMinutes = fetched;

    if (intervalMinutes > 0) {
      await new Promise((resolve) => setTimeout(resolve, intervalMinutes * 60_000));
      await screenshotTick(cfg);
    } else {
      await new Promise((resolve) => setTimeout(resolve, SETTINGS_RECHECK_MS));
    }
  }
}

async function screenshotTick(cfg) {
  try {
    const ctx = await getContext();
    const imageBase64 = await getScreenshotBase64();
    const res = await fetch(`${BACKEND_URL}/api/ingest/screenshot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-agent-key': cfg.agentKey },
      body: JSON.stringify({
        capturedAt: new Date().toISOString(),
        appName: ctx.process,
        windowTitle: ctx.title,
        imageBase64,
        ext: 'jpg',
      }),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    console.log('screenshot uploaded');
  } catch (err) {
    console.error('screenshot failed:', err.message);
  }
}

async function main() {
  const cfg = await enroll();
  startLocalServer();
  console.log(`Agent running. Polling every ${POLL_INTERVAL_MS / 1000}s, flushing every ${FLUSH_INTERVAL_MS / 1000}s, screenshot interval set by manager (currently ~${DEFAULT_SCREENSHOT_INTERVAL_MIN}min default).`);

  setInterval(poll, POLL_INTERVAL_MS);
  setInterval(() => flush(cfg), FLUSH_INTERVAL_MS);
  screenshotLoop(cfg);

  await poll();
}

main().catch((err) => {
  console.error('agent crashed:', err);
  process.exit(1);
});
