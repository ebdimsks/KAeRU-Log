'use strict';

function normalizeOrigin(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed === 'self' || trimmed === "'self'") {
    return "'self'";
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.origin;
    }
  } catch {
    // invalid origin
  }

  return null;
}

function isHttpsOrigin(value) {
  const origin = normalizeOrigin(value);
  if (!origin || origin === "'self'") {
    return false;
  }

  try {
    return new URL(origin).protocol === 'https:';
  } catch {
    return false;
  }
}

module.exports = {
  normalizeOrigin,
  isHttpsOrigin,
};
