import { SERVER_URL, AUTH_RETRY_COOLDOWN_MS } from './config.js';
import { state } from './state.js';

const REQUEST_TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url, opts = {}, timeout = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), timeout);

  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timerId);
  }
}

export function clearAuthToken() {
  state.myToken = '';
  localStorage.removeItem('chatToken');
}

export async function obtainToken() {
  if (state.authPromise) return state.authPromise;

  const now = Date.now();
  if (now - state.lastAuthAttempt < AUTH_RETRY_COOLDOWN_MS) {
    throw new Error('authCooldown');
  }
  state.lastAuthAttempt = now;

  state.authPromise = (async () => {
    const reqBody = state.myName ? { username: state.myName } : {};

    const res = await fetchWithTimeout(`${SERVER_URL}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`auth failed: ${res.status} ${text}`);
    }

    const data = await res.json().catch(() => null);
    if (!data?.token) {
      throw new Error('invalid auth response');
    }

    state.myToken = data.token;
    localStorage.setItem('chatToken', state.myToken);

    if (typeof data.username === 'string' && data.username && state.myName !== data.username) {
      state.myName = data.username;
      localStorage.setItem('chat_username', state.myName);
    }

    return state.myToken;
  })();

  try {
    return await state.authPromise;
  } finally {
    state.authPromise = null;
  }
}

async function readErrorCode(res) {
  try {
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return null;
    }

    const body = await res.clone().json().catch(() => null);
    return typeof body?.code === 'string' ? body.code : null;
  } catch {
    return null;
  }
}

export async function fetchWithAuth(url, opts = {}, retry = true) {
  const headers = { ...(opts.headers || {}) };
  if (state.myToken) {
    headers.Authorization = `Bearer ${state.myToken}`;
  }

  const res = await fetchWithTimeout(url, { ...opts, headers });

  if ((res.status === 401 || res.status === 403) && retry) {
    const code = await readErrorCode(res);

    if (code === 'token_expired' || code === 'no_token') {
      const refreshedToken = await obtainToken().catch(() => null);
      if (!refreshedToken) {
        return res;
      }

      return fetchWithAuth(
        url,
        { ...opts, headers: { ...headers, Authorization: `Bearer ${refreshedToken}` } },
        false
      );
    }
  }

  return res;
}
