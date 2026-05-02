import { elements } from './dom.js';

const DEFAULT_DURATION_MS = 1800;
const MAX_QUEUE_SIZE = 16;
const RECENT_TTL_MS = 15_000;
const PRIORITY_WEIGHT = {
  low: 0,
  normal: 1,
  high: 2,
};

const queue = [];
const recentToasts = new Map();
let activeToast = null;
let timerId = null;

function normalizeText(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

function normalizeEnum(value, allowed, fallback) {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function normalizeToast(input) {
  if (typeof input === 'string') {
    return {
      id: null,
      scope: 'local',
      tone: 'info',
      priority: 'normal',
      durationMs: DEFAULT_DURATION_MS,
      message: normalizeText(input),
    };
  }

  if (!input || typeof input !== 'object') {
    return null;
  }

  const message = normalizeText(input.message);
  if (!message) {
    return null;
  }

  const tone = normalizeEnum(input.tone, new Set(['info', 'success', 'warning', 'error']), 'info');
  const priority = normalizeEnum(input.priority, new Set(['low', 'normal', 'high']), tone === 'error' ? 'high' : 'normal');
  const scope = normalizeEnum(input.scope, new Set(['local', 'user', 'room']), 'local');
  const id = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : null;
  const duration = Number(input.durationMs);
  const durationMs = Number.isFinite(duration) && duration > 0 ? Math.min(Math.floor(duration), 6000) : DEFAULT_DURATION_MS;

  return {
    id,
    scope,
    tone,
    priority,
    durationMs,
    message,
  };
}

function toastKey(toast) {
  return toast.id || `${toast.scope}:${toast.tone}:${toast.priority}:${toast.message}`;
}

function pruneRecent() {
  const cutoff = Date.now() - RECENT_TTL_MS;
  for (const [key, ts] of recentToasts.entries()) {
    if (ts < cutoff) {
      recentToasts.delete(key);
    }
  }
}

function rememberToast(toast) {
  const key = toastKey(toast);
  recentToasts.set(key, Date.now());
  pruneRecent();
}

function seenToast(toast) {
  pruneRecent();
  const key = toastKey(toast);
  return recentToasts.has(key);
}

function clearTimer() {
  if (timerId !== null) {
    clearTimeout(timerId);
    timerId = null;
  }
}

function hideToast() {
  clearTimer();
  activeToast = null;
  elements.toastNotification?.classList.remove('show');
}

function renderToast(toast) {
  const el = elements.toastNotification;
  if (!el) {
    return false;
  }

  el.textContent = toast.message;
  el.dataset.scope = toast.scope;
  el.dataset.tone = toast.tone;
  el.dataset.priority = toast.priority;
  el.setAttribute('role', toast.tone === 'error' ? 'alert' : 'status');
  el.setAttribute('aria-live', toast.tone === 'error' ? 'assertive' : 'polite');
  el.setAttribute('aria-atomic', 'true');
  el.classList.add('show');
  return true;
}

function displayToast(toast) {
  if (!renderToast(toast)) {
    return false;
  }

  activeToast = toast;
  clearTimer();
  timerId = setTimeout(() => {
    hideToast();
    flushQueue();
  }, toast.durationMs || DEFAULT_DURATION_MS);
  return true;
}

function flushQueue() {
  if (activeToast || queue.length === 0) {
    return;
  }

  const next = queue.shift();
  if (!next) {
    return;
  }

  if (!displayToast(next)) {
    flushQueue();
  }
}

function enqueueToast(input) {
  const toast = normalizeToast(input);
  if (!toast) {
    return false;
  }

  if (seenToast(toast)) {
    return false;
  }

  rememberToast(toast);

  if (!activeToast) {
    return displayToast(toast);
  }

  const activePriority = PRIORITY_WEIGHT[activeToast.priority] ?? 1;
  const nextPriority = PRIORITY_WEIGHT[toast.priority] ?? 1;

  if (nextPriority > activePriority) {
    queue.unshift(activeToast);
    displayToast(toast);
    return true;
  }

  if (queue.length >= MAX_QUEUE_SIZE) {
    queue.pop();
  }

  queue.push(toast);
  return true;
}

export function showToast(message, durationMs = DEFAULT_DURATION_MS) {
  return enqueueToast({
    scope: 'local',
    tone: 'info',
    priority: 'normal',
    durationMs,
    message,
  });
}

export function showServerToast(payload) {
  if (typeof payload === 'string') {
    return enqueueToast({
      scope: 'user',
      tone: 'info',
      priority: 'normal',
      durationMs: DEFAULT_DURATION_MS,
      message: payload,
    });
  }

  return enqueueToast({
    scope: payload?.scope || 'user',
    tone: payload?.tone || 'info',
    priority: payload?.priority || 'normal',
    durationMs: payload?.durationMs || DEFAULT_DURATION_MS,
    id: payload?.id || null,
    message: payload?.message || '',
  });
}

export function clearToastQueue() {
  queue.length = 0;
  hideToast();
}

export function getToastState() {
  return {
    activeToast,
    queued: queue.length,
  };
}
