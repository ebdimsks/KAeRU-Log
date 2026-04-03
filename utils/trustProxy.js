'use strict';

function isTrustProxyEnabled(value = process.env.TRUST_PROXY) {
  return String(value).trim().toLowerCase() === 'true';
}

function getSocketClientIp(socket, trustProxy) {
  if (trustProxy) {
    const raw = socket?.handshake?.headers?.['x-forwarded-for'];
    const forwardedFor = Array.isArray(raw) ? raw[0] : raw;

    if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
      return forwardedFor.split(',')[0].trim();
    }
  }

  return socket?.handshake?.address || '';
}

module.exports = {
  isTrustProxyEnabled,
  getSocketClientIp,
};