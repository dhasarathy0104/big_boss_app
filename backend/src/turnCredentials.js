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
//
// IMPORTANT: `<subdomain>.metered.live` is ONLY the account/API dashboard
// domain (it resolves to an Azure Front Door CDN, which is HTTP(S)-only and
// silently drops raw STUN/TURN UDP/TCP packets sent to it). Every real
// session tested came back with no relay candidate at all because of this —
// the actual media-plane TURN/STUN relay lives at a completely different,
// fixed hostname regardless of account: global.relay.metered.ca /
// stun.relay.metered.ca. Confirmed against Metered's own docs.
export async function fetchTurnCredentials() {
  const username = process.env.TURN_USERNAME;
  const password = process.env.TURN_PASSWORD;
  if (!username || !password) return [{ urls: 'stun:stun.l.google.com:19302' }];

  return [
    { urls: 'stun:stun.relay.metered.ca:80' },
    { urls: 'turn:global.relay.metered.ca:80', username, credential: password },
    { urls: 'turn:global.relay.metered.ca:80?transport=tcp', username, credential: password },
    { urls: 'turn:global.relay.metered.ca:443', username, credential: password },
    { urls: 'turns:global.relay.metered.ca:443?transport=tcp', username, credential: password },
  ];
}
