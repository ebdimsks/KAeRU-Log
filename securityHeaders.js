'use strict';

const { isHttpsOrigin, normalizeOrigin } = require('./lib/origin');

function securityHeaders({ frontendUrl } = {}) {
  const frontendOrigin = normalizeOrigin(frontendUrl) || "'self'";
  const frameAncestors = frontendOrigin === "'self'" ? "'self'" : frontendOrigin;
  const connectSrc = frontendOrigin === "'self'" ? ["'self'"] : ["'self'", frontendOrigin];
  const enableHttpsHeaders = isHttpsOrigin(frontendUrl);

  return (_req, res, next) => {
    if (res.headersSent) {
      return next();
    }

    const csp = [
      "default-src 'self'",
      "script-src 'self' https://cdn.socket.io",
      "script-src-elem 'self' https://cdn.socket.io",
      "style-src 'self'",
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
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }

    return next();
  };
}

module.exports = securityHeaders;
