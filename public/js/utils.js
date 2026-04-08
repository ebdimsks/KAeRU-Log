import { elements } from './dom.js';

export function selectAll(input) {
  if (!input) return;
  setTimeout(() => input.select(), 0);
}

export function focusInput(target = elements.messageTextarea) {
  if (!target) return;
  target.focus();
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });

  if ('value' in target) {
    const value = target.value;
    target.value = '';
    target.value = value;
  }
}

export function isScrolledToBottom() {
  const container = elements.chatContainer || document.documentElement;
  return container.scrollHeight - container.scrollTop - container.clientHeight < 80;
}

export function scrollBottom(smooth = true) {
  const container = elements.chatContainer || document.documentElement;
  container.scrollTo({ top: container.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}

export function getInitials(name) {
  if (!name) return '?';
  return name
    .trim()
    .split(/\s+/)
    .map((part) => (part[0] || '').toUpperCase())
    .join('')
    .slice(0, 2);
}

export function setConnectionState(stateName) {
  const el = elements.connectionIndicator;
  if (!el) return;

  el.classList.remove('online', 'offline');

  switch (stateName) {
    case 'online':
      el.classList.add('online');
      el.setAttribute('aria-label', 'オンライン');
      if (elements.connectionText) elements.connectionText.textContent = 'オンライン';
      break;
    case 'offline':
      el.classList.add('offline');
      el.setAttribute('aria-label', '切断');
      if (elements.connectionText) elements.connectionText.textContent = '切断';
      break;
    default:
      el.setAttribute('aria-label', '接続中...');
      if (elements.connectionText) elements.connectionText.textContent = '接続中...';
  }
}

export function validateRoomId(roomId) {
  return /^[a-zA-Z0-9_-]{1,32}$/.test(roomId);
}

export function validateUsername(username) {
  return typeof username === 'string' && username.trim().length >= 1 && username.trim().length <= 20;
}

export function formatMessageTime(value) {
  if (typeof value !== 'string' || !value.trim()) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
