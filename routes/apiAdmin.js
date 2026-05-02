'use strict';

const crypto = require('crypto');
const express = require('express');

const KEYS = require('../lib/redisKeys');
const { checkRateLimitMs } = require('../utils/rateLimitUtils');
const { createSafeToastEmitter } = require('../lib/emitToast');
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
  const notifyUser = createSafeToastEmitter(emitUserToast);
  const notifyRoom = createSafeToastEmitter(emitRoomToast);

  async function readAdminOwner(token) {
    return redisClient.get(KEYS.adminSession(token));
  }

  async function requireAdminSession(context, res, clientIdMessage) {
    const { clientId, token } = context;
    const adminOwnerClientId = await readAdminOwner(token);

    if (!adminOwnerClientId) {
      notifyUser(clientId, clientIdMessage || '管理者ログインが必要です');
      res.sendStatus(403);
      return null;
    }

    if (adminOwnerClientId !== clientId) {
      notifyUser(clientId, '管理者セッションが一致しません');
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
        notifyUser(clientId, 'ログイン操作には30秒以上間隔をあけてください');
        return res.sendStatus(429);
      }

      if (!constantTimeEquals(password, adminPass)) {
        notifyUser(clientId, '管理者パスワードが正しくありません');
        return res.sendStatus(403);
      }

      const tokenTtlSec = await redisClient.ttl(KEYS.token(token));
      if (!Number.isFinite(tokenTtlSec) || tokenTtlSec <= 0) {
        return res.status(403).json({ error: 'Invalid token TTL', code: 'invalid_token_ttl' });
      }

      await redisClient.set(KEYS.adminSession(token), clientId, 'EX', tokenTtlSec);
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
        notifyUser(clientId, '管理者セッションがありません');
        return res.sendStatus(403);
      }

      if (adminOwnerClientId !== clientId) {
        notifyUser(clientId, '管理者セッションが一致しません');
        return res.sendStatus(403);
      }

      await redisClient.del(KEYS.adminSession(token));
      notifyUser(clientId, '管理者ログアウトしました');

      return res.json({ ok: true });
    } catch (err) {
      console.error('admin logout failed', err);
      return res.status(500).json({ error: 'Server error', code: 'server_error' });
    }
  });

  router.post('/clear/:roomId([a-zA-Z0-9_-]{1,32})', async (req, res) => {
    try {
      const context = requireRequestAuthContext(req, res);
      if (!context) {
        return;
      }

      const { clientId } = context;
      const roomId = typeof req.params.roomId === 'string' ? req.params.roomId : '';

      if (!isValidRoomId(roomId)) {
        return res.sendStatus(400);
      }

      if (!(await checkRateLimitMs(redisClient, KEYS.rateClear(clientId), ADMIN_RATE_LIMIT_MS))) {
        notifyUser(clientId, '削除操作は30秒以上間隔をあけてください');
        return res.sendStatus(429);
      }

      const adminOwnerClientId = await requireAdminSession(context, res, '管理者ログインが必要です');
      if (!adminOwnerClientId) {
        return;
      }

      await redisClient.del(KEYS.messages(roomId));
      io.to(roomId).emit('clearMessages');

      notifyRoom(roomId, '全メッセージ削除されました');

      return res.json({ ok: true });
    } catch (err) {
      console.error('admin clear failed', err);
      return res.status(500).json({ error: 'Server error', code: 'server_error' });
    }
  });

  return router;
}

module.exports = createApiAdminRouter;
