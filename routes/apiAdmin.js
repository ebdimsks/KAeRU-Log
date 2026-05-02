'use strict';

const crypto = require('crypto');
const express = require('express');

const KEYS = require('../lib/redisKeys');
const { checkRateLimitMs } = require('../utils/rateLimitUtils');
const { requireRequestAuthContext } = require('../lib/requestAuth');
const { isValidRoomId } = require('../lib/validation');

const ADMIN_RATE_LIMIT_MS = 30_000;

function constantTimeEquals(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function createApiAdminRouter({ redisClient, io, emitUserToast, emitRoomToast, adminPass }) {
  const router = express.Router();

  async function readAdminOwner(token) {
    return redisClient.get(KEYS.adminSession(token));
  }

  async function requireAdminSession(context, res, clientIdMessage) {
    const { clientId, token } = context;
    const adminOwnerClientId = await readAdminOwner(token);

    if (!adminOwnerClientId) {
      emitUserToast(clientId, clientIdMessage || '管理者ログインが必要です', { tone: 'warning' });
      res.sendStatus(403);
      return null;
    }

    if (adminOwnerClientId !== clientId) {
      emitUserToast(clientId, '管理者セッションが一致しません', { tone: 'warning' });
      res.sendStatus(403);
      return null;
    }

    return adminOwnerClientId;
  }

  router.post('/login', async (req, res) => {
    try {
      const context = requireRequestAuthContext(req, res);
      if (!context) {
        return;
      }

      const { clientId, token } = context;
      const password = typeof req.body?.password === 'string' ? req.body.password : '';

      if (!(await checkRateLimitMs(redisClient, KEYS.rateAdminLogin(clientId), ADMIN_RATE_LIMIT_MS))) {
        emitUserToast(clientId, 'ログイン操作には30秒以上間隔をあけてください', { tone: 'warning' });
        return res.sendStatus(429);
      }

      if (!constantTimeEquals(password, adminPass)) {
        emitUserToast(clientId, '管理者パスワードが正しくありません', { tone: 'error' });
        return res.sendStatus(403);
      }

      const tokenTtlSec = await redisClient.ttl(KEYS.token(token));
      if (!Number.isFinite(tokenTtlSec) || tokenTtlSec <= 0) {
        return res.status(403).json({ error: 'Invalid token TTL', code: 'invalid_token_ttl' });
      }

      await redisClient.set(KEYS.adminSession(token), clientId, 'EX', tokenTtlSec);
      emitUserToast(clientId, '管理者としてログインしました', { tone: 'success' });
      return res.json({ ok: true, admin: true });
    } catch (err) {
      console.error('admin login failed', err);
      return res.status(500).json({ error: 'Server error', code: 'server_error' });
    }
  });

  router.get('/status', async (req, res) => {
    try {
      const context = requireRequestAuthContext(req, res);
      if (!context) {
        return;
      }

      const { clientId, token } = context;
      const adminOwnerClientId = await readAdminOwner(token);
      return res.json({ admin: adminOwnerClientId === clientId });
    } catch (err) {
      console.error('admin status failed', err);
      return res.status(500).json({ error: 'Server error', code: 'server_error' });
    }
  });

  router.post('/logout', async (req, res) => {
    try {
      const context = requireRequestAuthContext(req, res);
      if (!context) {
        return;
      }

      const { clientId, token } = context;
      const adminOwnerClientId = await readAdminOwner(token);

      if (!adminOwnerClientId) {
        emitUserToast(clientId, '管理者セッションがありません', { tone: 'warning' });
        return res.sendStatus(403);
      }

      if (adminOwnerClientId !== clientId) {
        emitUserToast(clientId, '管理者セッションが一致しません', { tone: 'warning' });
        return res.sendStatus(403);
      }

      await redisClient.del(KEYS.adminSession(token));
      emitUserToast(clientId, '管理者ログアウトしました', { tone: 'success' });

      return res.json({ ok: true });
    } catch (err) {
      console.error('admin logout failed', err);
      return res.status(500).json({ error: 'Server error', code: 'server_error' });
    }
  });

  router.post('/clear/:roomId', async (req, res) => {
    try {
      const context = requireRequestAuthContext(req, res);
      if (!context) {
        return;
      }

      const { clientId } = context;
      const roomId = typeof req.params.roomId === 'string' ? req.params.roomId.trim() : '';

      if (!isValidRoomId(roomId)) {
        return res.sendStatus(400);
      }

      if (!(await checkRateLimitMs(redisClient, KEYS.rateClear(clientId), ADMIN_RATE_LIMIT_MS))) {
        emitUserToast(clientId, '削除操作は30秒以上間隔をあけてください', { tone: 'warning' });
        return res.sendStatus(429);
      }

      const adminOwnerClientId = await requireAdminSession(context, res, '管理者ログインが必要です');
      if (!adminOwnerClientId) {
        return;
      }

      await redisClient.del(KEYS.messages(roomId));
      io.to(roomId).emit('clearMessages');

      emitRoomToast(roomId, '全メッセージ削除されました', { tone: 'success' });

      return res.json({ ok: true });
    } catch (err) {
      console.error('admin clear failed', err);
      return res.status(500).json({ error: 'Server error', code: 'server_error' });
    }
  });

  return router;
}

module.exports = createApiAdminRouter;
