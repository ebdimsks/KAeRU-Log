'use strict';

const DEFAULT_AUTH_ERROR = {
  status: 403,
  body: { error: 'Authentication required', code: 'no_token' },
};

function normalizeString(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

function extractBearerToken(authorizationHeader) {
  const rawHeader = Array.isArray(authorizationHeader)
    ? authorizationHeader[0]
    : authorizationHeader;

  if (typeof rawHeader !== 'string') {
    return null;
  }

  const match = rawHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return null;
  }

  const token = match[1].trim();
  return token || null;
}

function getRequestAuthContext(req) {
  const clientId = normalizeString(req?.clientId);
  const token = extractBearerToken(req?.headers?.authorization);

  return { clientId, token };
}

function sendAuthError(res, status = DEFAULT_AUTH_ERROR.status, code = DEFAULT_AUTH_ERROR.body.code) {
  return res.status(status).json({
    error: DEFAULT_AUTH_ERROR.body.error,
    code,
  });
}

function requireRequestAuthContext(req, res) {
  const context = getRequestAuthContext(req);

  if (!context.clientId || !context.token) {
    sendAuthError(res);
    return null;
  }

  return context;
}

module.exports = {
  extractBearerToken,
  getRequestAuthContext,
  requireRequestAuthContext,
  sendAuthError,
};
