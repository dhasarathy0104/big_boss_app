// Windows tracking agent — zero native npm dependencies.
// Shells out to PowerShell (built into Windows) for active window / idle time / screenshots,
// so no compiler toolchain is needed to run this.
//
// If DESKLOG_INVITE_TOKEN is set on first run, enrollment automatically attaches this
// employee to whichever manager generated that invite link — no manual manager lookup.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BACKEND_URL = process.env.DESKLOG_BACKEND_URL || 'http://localhost:4000';
const AGENT_NAME = process.env.DESKLOG_AGENT_NAME || os.userInfo().username;
const INVITE_TOKEN = process.env.DESKLOG_INVITE_TOKEN || null;
const POLL_INTERVAL_MS = 10_000;
const FLUSH_INTERVAL_MS = 30_000;
const SCREENSHOT_INTERVAL_MS = 5 * 60_000;
const IDLE_THRESHOLD_SECONDS = 120;

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

async function enroll() {
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

    if (
      !currentSegment ||
      currentSegment.appName !== ctx.process ||
      currentSegment.windowTitle !== ctx.title ||
      currentSegment.isIdle !== isIdle
    ) {
      closeSegment();
      currentSegment = {
        appName: ctx.process || '(unknown)',
        windowTitle: ctx.title || '',
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
  console.log(`Agent running. Polling every ${POLL_INTERVAL_MS / 1000}s, flushing every ${FLUSH_INTERVAL_MS / 1000}s, screenshot every ${SCREENSHOT_INTERVAL_MS / 60000}min.`);

  setInterval(poll, POLL_INTERVAL_MS);
  setInterval(() => flush(cfg), FLUSH_INTERVAL_MS);
  setInterval(() => screenshotTick(cfg), SCREENSHOT_INTERVAL_MS);

  await poll();
}

main().catch((err) => {
  console.error('agent crashed:', err);
  process.exit(1);
});
