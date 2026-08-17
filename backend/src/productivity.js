// Built-in classification for common apps, keyed by lowercased process name
// (what the agent's Get-Process ProcessName reports). Managers can override
// any of these — or add entries for apps not listed here — via category_rules.
//
// isEngagedApp marks apps where near-zero mouse/keyboard input doesn't mean
// AFK: video calls, presentations, media/reading. Idle time in one of these
// counts as "engaged" toward the productivity score instead of true idle.
export const DEFAULT_RULES = {
  // Editors / IDEs / dev tools
  code: { category: 'productive', isEngagedApp: false },
  devenv: { category: 'productive', isEngagedApp: false },
  idea64: { category: 'productive', isEngagedApp: false },
  pycharm64: { category: 'productive', isEngagedApp: false },
  sublime_text: { category: 'productive', isEngagedApp: false },
  'notepad++': { category: 'productive', isEngagedApp: false },
  vim: { category: 'productive', isEngagedApp: false },
  windowsterminal: { category: 'productive', isEngagedApp: false },
  wt: { category: 'productive', isEngagedApp: false },
  powershell: { category: 'productive', isEngagedApp: false },
  cmd: { category: 'productive', isEngagedApp: false },
  node: { category: 'productive', isEngagedApp: false },
  python: { category: 'productive', isEngagedApp: false },
  claude: { category: 'productive', isEngagedApp: false },
  postman: { category: 'productive', isEngagedApp: false },
  figma: { category: 'productive', isEngagedApp: false },
  githubdesktop: { category: 'productive', isEngagedApp: false },

  // Office / docs
  winword: { category: 'productive', isEngagedApp: false },
  excel: { category: 'productive', isEngagedApp: false },
  powerpnt: { category: 'productive', isEngagedApp: true }, // presenting counts as engaged
  onenote: { category: 'productive', isEngagedApp: false },
  acrobat: { category: 'productive', isEngagedApp: true }, // reading a long PDF
  acrord32: { category: 'productive', isEngagedApp: true },

  // Communication — also "engaged apps" since calls have near-zero input
  zoom: { category: 'productive', isEngagedApp: true },
  teams: { category: 'productive', isEngagedApp: true },
  msteams: { category: 'productive', isEngagedApp: true },
  'ms-teams': { category: 'productive', isEngagedApp: true },
  skype: { category: 'productive', isEngagedApp: true },
  webex: { category: 'productive', isEngagedApp: true },
  slack: { category: 'productive', isEngagedApp: false },
  outlook: { category: 'productive', isEngagedApp: false },

  // Browsers fall back to this only when the extension hasn't reported a domain
  // for the current tab (not installed, or the tab predates the extension loading).
  chrome: { category: 'neutral', isEngagedApp: false },
  msedge: { category: 'neutral', isEngagedApp: false },
  firefox: { category: 'neutral', isEngagedApp: false },
  explorer: { category: 'neutral', isEngagedApp: false },

  // Entertainment / distraction
  spotify: { category: 'unproductive', isEngagedApp: false },
  steam: { category: 'unproductive', isEngagedApp: false },
  epicgameslauncher: { category: 'unproductive', isEngagedApp: false },
  vlc: { category: 'unproductive', isEngagedApp: false },
  netflix: { category: 'unproductive', isEngagedApp: false },
  whatsapp: { category: 'unproductive', isEngagedApp: false },
  telegram: { category: 'unproductive', isEngagedApp: false },
  discord: { category: 'unproductive', isEngagedApp: false },
};

// Browser processes we know the extension can report a domain for — everything
// else keeps app-level classification even if a domain were somehow attached.
export const BROWSER_APPS = new Set(['chrome', 'msedge', 'firefox', 'brave', 'opera']);

// Default domain classification — this is what actually makes browser time
// meaningful instead of a blanket "neutral" guess at the app level.
export const DEFAULT_DOMAIN_RULES = {
  'github.com': { category: 'productive', isEngagedApp: false },
  'stackoverflow.com': { category: 'productive', isEngagedApp: false },
  'docs.google.com': { category: 'productive', isEngagedApp: false },
  'notion.so': { category: 'productive', isEngagedApp: false },
  'figma.com': { category: 'productive', isEngagedApp: false },
  'atlassian.net': { category: 'productive', isEngagedApp: false },
  'jira.com': { category: 'productive', isEngagedApp: false },
  'gitlab.com': { category: 'productive', isEngagedApp: false },
  'developer.mozilla.org': { category: 'productive', isEngagedApp: false },
  'chat.openai.com': { category: 'productive', isEngagedApp: false },
  'claude.ai': { category: 'productive', isEngagedApp: false },

  'google.com': { category: 'neutral', isEngagedApp: false },
  'wikipedia.org': { category: 'neutral', isEngagedApp: false },
  'mail.google.com': { category: 'neutral', isEngagedApp: false },

  'youtube.com': { category: 'unproductive', isEngagedApp: false },
  'facebook.com': { category: 'unproductive', isEngagedApp: false },
  'instagram.com': { category: 'unproductive', isEngagedApp: false },
  'twitter.com': { category: 'unproductive', isEngagedApp: false },
  'x.com': { category: 'unproductive', isEngagedApp: false },
  'reddit.com': { category: 'unproductive', isEngagedApp: false },
  'netflix.com': { category: 'unproductive', isEngagedApp: false },
  'tiktok.com': { category: 'unproductive', isEngagedApp: false },
  'twitch.tv': { category: 'unproductive', isEngagedApp: false },
};

export function buildOverrideMaps(rules) {
  const app = new Map();
  const domain = new Map();
  for (const r of rules) {
    const target = r.rule_type === 'domain' ? domain : app;
    target.set(r.app_pattern.toLowerCase(), { category: r.category, isEngagedApp: !!r.is_engaged_app });
  }
  return { app, domain };
}

// Prefer a real domain classification for browser time; fall back to the app-level
// rule (chrome/edge/firefox default to 'neutral') when no domain was reported —
// e.g. the extension isn't installed, or hasn't seen this tab yet.
export function classify(event, overrides) {
  const appKey = (event.app_name || '').toLowerCase();
  if (event.domain && BROWSER_APPS.has(appKey)) {
    const domainKey = event.domain.toLowerCase();
    return overrides?.domain?.get(domainKey) ?? DEFAULT_DOMAIN_RULES[domainKey] ?? { category: 'neutral', isEngagedApp: false };
  }
  return overrides?.app?.get(appKey) ?? DEFAULT_RULES[appKey] ?? { category: 'neutral', isEngagedApp: false };
}

function durationMinutes(event) {
  return (new Date(event.ended_at) - new Date(event.started_at)) / 60000;
}

function appLabel(event) {
  return event.domain && BROWSER_APPS.has((event.app_name || '').toLowerCase())
    ? `${event.app_name} · ${event.domain}`
    : event.app_name;
}

// Enrich raw activity_events with a classification, and roll up totals + a score.
// Truly idle time is excluded from the score denominator — it neither helps nor
// hurts, matching how these tools usually define "productivity" as a share of
// active(+engaged) time, not of total clocked-in time.
export function computeProductivity(events, overrides) {
  const totals = { productive: 0, neutral: 0, unproductive: 0, engaged: 0, idle: 0 };

  const enriched = events.map((e) => {
    const mins = durationMinutes(e);
    const { category, isEngagedApp } = classify(e, overrides);

    let bucket;
    if (e.is_idle) {
      bucket = isEngagedApp ? 'engaged' : 'idle';
    } else {
      bucket = category;
    }
    totals[bucket] += mins;

    return { ...e, category: bucket, label: appLabel(e) };
  });

  const denom = totals.productive + totals.neutral + totals.unproductive + totals.engaged;
  const score = denom > 0 ? Math.round(100 * (totals.productive + totals.engaged) / denom) : 0;

  const byLabel = {};
  for (const e of enriched) {
    if (e.is_idle && e.category !== 'engaged') continue;
    const mins = durationMinutes(e);
    if (!byLabel[e.label]) byLabel[e.label] = { appName: e.label, category: e.category, minutes: 0 };
    byLabel[e.label].minutes += mins;
  }
  const topApps = Object.values(byLabel).sort((a, b) => b.minutes - a.minutes).slice(0, 8);

  return { events: enriched, totals, score, topApps };
}
