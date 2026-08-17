// Reports only the hostname of the active tab — never the full URL, query
// string, or page content — to the local agent running on this same machine.
// If the agent isn't running, posts just fail silently; nothing is queued
// or retried, so there's no local buildup of unsent data.

const AGENT_URL = 'http://127.0.0.1:34909';

function hostnameFrom(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null; // skip chrome://, file://, etc.
    return u.hostname;
  } catch {
    return null;
  }
}

async function postDomain(domain) {
  try {
    await fetch(`${AGENT_URL}/url-event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain }),
    });
  } catch {
    // Agent not running — nothing to do, this just means tracking is currently inactive.
  }
}

async function reportActiveTab() {
  try {
    const win = await chrome.windows.getLastFocused({ populate: false });
    if (!win || !win.focused || win.id === chrome.windows.WINDOW_ID_NONE) {
      await postDomain(null);
      return;
    }
    const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
    await postDomain(tab ? hostnameFrom(tab.url) : null);
  } catch {
    await postDomain(null);
  }
}

chrome.tabs.onActivated.addListener(reportActiveTab);
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === 'complete') reportActiveTab();
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    postDomain(null);
  } else {
    reportActiveTab();
  }
});

// Cover the case where the service worker wakes up fresh with no recent event.
reportActiveTab();
