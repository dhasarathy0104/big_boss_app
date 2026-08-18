const TOKEN_KEY = 'desklog_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

// Every /api/ fetch call in the app is a plain relative fetch('/api/...') —
// this attaches the session token without having to touch every call site.
const nativeFetch = window.fetch.bind(window);
window.fetch = (input, init = {}) => {
  const url = typeof input === 'string' ? input : input?.url;
  const token = getToken();
  if (token && url?.startsWith('/api/')) {
    init = { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } };
  }
  return nativeFetch(input, init);
};
