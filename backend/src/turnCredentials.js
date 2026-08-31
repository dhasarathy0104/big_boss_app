// Metered's free tier caps the TOTAL number of TURN credentials that can
// ever be created at 10 (disabling one does not free that count back up —
// confirmed the hard way: minting a brand-new credential per watch session,
// as this originally did, exhausted all 10 within minutes of real testing).
// The fix is to reuse one long-lived credential for every session instead of
// minting a new one. It's kept in env vars, not committed here, even though
// a TURN username/password is lower-stakes than the account secret key —
// this repo is public, and there's no reason to publish it when an env var
// costs nothing extra. If usage ever outgrows the free tier, the fix is a
// paid Metered plan or self-hosting coturn, not more credentials from this one.
const METERED_SUBDOMAIN = 'dhasarathy';

export async function fetchTurnCredentials() {
  const username = process.env.TURN_USERNAME;
  const password = process.env.TURN_PASSWORD;
  if (!username || !password) return [{ urls: 'stun:stun.l.google.com:19302' }];

  return [
    { urls: `stun:${METERED_SUBDOMAIN}.metered.live:80` },
    { urls: `turn:${METERED_SUBDOMAIN}.metered.live:80`, username, credential: password },
    { urls: `turn:${METERED_SUBDOMAIN}.metered.live:80?transport=tcp`, username, credential: password },
    { urls: `turn:${METERED_SUBDOMAIN}.metered.live:443`, username, credential: password },
    { urls: `turns:${METERED_SUBDOMAIN}.metered.live:443?transport=tcp`, username, credential: password },
  ];
}
