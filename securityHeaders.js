'use strict';

const crypto = require('crypto');

function generateNonce() {
  return crypto.randomBytes(32).toString('base64');
}

function normalizeOrigin(value) {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed === "'self'" || trimmed === 'self') {
    return "'self'";
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.origin;
    }
  } catch {
    // ignore
  }

  return null;
}

function isHttpsOrigin(value) {
  if (typeof value !== 'string') return false;

  try {
    return new URL(value.trim()).protocol === 'https:';
  } catch {
    return false;
  }
}

function securityHeaders({ frontendUrl } = {}) {
  const frontendOrigin = normalizeOrigin(frontendUrl) || "'self'";
  const frameAncestors = frontendOrigin === "'self'" ? "'self'" : frontendOrigin;
  const enableHttpsHeaders = isHttpsOrigin(frontendUrl);

  return (_req, res, next) => {
    if (res.headersSent) return next();

    const nonce = generateNonce();
    res.locals = res.locals || {};
    res.locals.nonce = nonce;

    const connectSrc = ["'self'"];
    if (frontendOrigin !== "'self'") connectSrc.push(frontendOrigin);

    const csp = [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}' https://cdn.socket.io`,
      `script-src-elem 'self' 'nonce-${nonce}' https://cdn.socket.io`,
      `style-src 'self' 'nonce-${nonce}'`,
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      `connect-src ${connectSrc.join(' ')}`,
      `frame-ancestors ${frameAncestors}`,
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
      "manifest-src 'self'",
    ];

    if (enableHttpsHeaders) {
      csp.push('upgrade-insecure-requests');
    }

    res.setHeader('Content-Security-Policy', csp.join('; '));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader(
      'Permissions-Policy',
      'geolocation=(), microphone=(), camera=(), fullscreen=(self), payment=()'
    );
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    res.setHeader('X-DNS-Prefetch-Control', 'off');

    if (enableHttpsHeaders) {
      res.setHeader(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains; preload'
      );
    }

    next();
  };
}

module.exports = securityHeaders;