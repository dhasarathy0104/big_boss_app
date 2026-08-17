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

  // Ambiguous without URL data (Phase 4 adds real domain-level classification)
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

export function buildOverrideMap(rules) {
  const map = new Map();
  for (const r of rules) {
    map.set(r.app_pattern.toLowerCase(), { category: r.category, isEngagedApp: !!r.is_engaged_app });
  }
  return map;
}

export function classifyApp(appName, overrideMap) {
  const key = (appName || '').toLowerCase();
  return overrideMap?.get(key) ?? DEFAULT_RULES[key] ?? { category: 'neutral', isEngagedApp: false };
}

function durationMinutes(event) {
  return (new Date(event.ended_at) - new Date(event.started_at)) / 60000;
}

// Enrich raw activity_events with a classification, and roll up totals + a score.
// Truly idle time is excluded from the score denominator — it neither helps nor
// hurts, matching how these tools usually define "productivity" as a share of
// active(+engaged) time, not of total clocked-in time.
export function computeProductivity(events, overrideMap) {
  const totals = { productive: 0, neutral: 0, unproductive: 0, engaged: 0, idle: 0 };

  const enriched = events.map((e) => {
    const mins = durationMinutes(e);
    const { category, isEngagedApp } = classifyApp(e.app_name, overrideMap);

    let bucket;
    if (e.is_idle) {
      bucket = isEngagedApp ? 'engaged' : 'idle';
    } else {
      bucket = category;
    }
    totals[bucket] += mins;

    return { ...e, category: bucket };
  });

  const denom = totals.productive + totals.neutral + totals.unproductive + totals.engaged;
  const score = denom > 0 ? Math.round(100 * (totals.productive + totals.engaged) / denom) : 0;

  const byApp = {};
  for (const e of enriched) {
    if (e.is_idle && e.category !== 'engaged') continue;
    const mins = durationMinutes(e);
    if (!byApp[e.app_name]) byApp[e.app_name] = { appName: e.app_name, category: e.category, minutes: 0 };
    byApp[e.app_name].minutes += mins;
  }
  const topApps = Object.values(byApp).sort((a, b) => b.minutes - a.minutes).slice(0, 8);

  return { events: enriched, totals, score, topApps };
}
