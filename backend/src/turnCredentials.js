// Fetches short-lived TURN relay credentials from Metered on demand, one set
// per watch session. The account's secret key stays server-side only (per
// Metered's own guidance — it must never reach a browser or the agent); this
// is the one place it's used, to mint a disposable username/password pair
// that IS safe to hand to a client.
const METERED_SUBDOMAIN = 'dhasarathy';

export async function fetchTurnCredentials() {
  const secretKey = process.env.METERED_SECRET_KEY;
  if (!secretKey) return null;

  const label = `bigboss-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let res;
  try {
    res = await fetch(
      `https://${METERED_SUBDOMAIN}.metered.live/api/v1/turn/credential?secretKey=${encodeURIComponent(secretKey)}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label }) },
    );
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const { username, password } = await res.json();
  if (!username || !password) return null;

  return [
    { urls: `stun:${METERED_SUBDOMAIN}.metered.live:80` },
    { urls: `turn:${METERED_SUBDOMAIN}.metered.live:80`, username, credential: password },
    { urls: `turn:${METERED_SUBDOMAIN}.metered.live:80?transport=tcp`, username, credential: password },
    { urls: `turn:${METERED_SUBDOMAIN}.metered.live:443`, username, credential: password },
    { urls: `turns:${METERED_SUBDOMAIN}.metered.live:443?transport=tcp`, username, credential: password },
  ];
}
