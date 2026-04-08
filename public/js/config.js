export const SERVER_URL =
  typeof globalThis.location?.origin === 'string' ? globalThis.location.origin.replace(/\/$/, '') : '';

export const AUTH_RETRY_COOLDOWN_MS = 10_000;

export function getRoomIdFromPath() {
  const pathname = typeof globalThis.location?.pathname === 'string' ? globalThis.location.pathname : '';
  const parts = pathname.split('/').filter(Boolean);
  const roomId = parts[1];

  if (parts.length !== 2 || parts[0] !== 'room' || !roomId || !/^[a-zA-Z0-9_-]{1,32}$/.test(roomId)) {
    return null;
  }

  return roomId;
}
