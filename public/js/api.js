import { SERVER_URL, AUTH_RETRY_COOLDOWN_MS } from './config.js';
import { state } from './state.js';

async function fetchWithTimeout(url, opts = {}, timeout = 10000) {
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), timeout);

  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timerId);
  }
}

export async function obtainToken() {
  if (state.authPromise) return state.authPromise;

  const now = Date.now();
  if (now - state.lastAuthAttempt < AUTH_RETRY_COOLDOWN_MS) {
    throw new Error('authCooldown');
  }
  state.lastAuthAttempt = now;

  state.authPromise = (async () => {
    const reqBody = {};
    if (state.myName) reqBody.username = state.myName;

    const res = await fetchWithTimeout(`${SERVER_URL}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`auth failed: ${res.status} ${text}`);
    }

    const data = await res.json();

    if (!data?.token) {
      throw new Error('invalid auth response');
    }

    state.myToken = data.token;
    localStorage.setItem('chatToken', state.myToken);

    if (data.username && (!state.myName || state.myName !== data.username)) {
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

export async function fetchWithAuth(url, opts = {}, retry = true) {
  const headers = { ...(opts.headers || {}) };

  if (state.myToken) {
    headers.Authorization = `Bearer ${state.myToken}`;
  }

  const requestOptions = { ...opts, headers };
  const res = await fetchWithTimeout(url, requestOptions);

  if ((res.status === 401 || res.status === 403) && retry) {
    let code = null;

    try {
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const body = await res.clone().json().catch(() => null);
        code = body?.code;
      }
    } catch (e) {
      code = null;
    }

    if (code === 'token_expired' || code === 'no_token') {
      const refreshedToken = await obtainToken().catch(() => null);
      if (!refreshedToken) {
        return res;
      }

      return await fetchWithAuth(url, { ...opts, headers: { ...headers, Authorization: `Bearer ${refreshedToken}` } }, false);
    }
  }

  return res;
}