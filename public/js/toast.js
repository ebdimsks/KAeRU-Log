import { elements } from './dom.js';
import { state } from './state.js';

let userToastTimer = null;
let serverToastTimer = null;

function showToastElement(text) {
  const toast = elements.toastNotification;
  if (!toast) return false;

  toast.textContent = text;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.classList.add('show');
  return true;
}

export function showToast(text, duration = 1800) {
  if (state.isServerToastActive) return;
  if (!showToastElement(text)) return;

  clearTimeout(userToastTimer);
  userToastTimer = setTimeout(() => {
    elements.toastNotification?.classList.remove('show');
  }, duration);
}

export function showServerToast(text, duration = 1800) {
  if (!showToastElement(text)) return;

  state.isServerToastActive = true;
  clearTimeout(serverToastTimer);
  serverToastTimer = setTimeout(() => {
    elements.toastNotification?.classList.remove('show');
    state.isServerToastActive = false;
  }, duration);
}
