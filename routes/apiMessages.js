'use strict';

const express = require('express');

const KEYS = require('../lib/redisKeys');
const { pushAndTrimList } = require('../lib/redisHelpers');
const createSpamService = require('../services/spamService');
const { formatJST } = require('../utils/time');

const ROOM_ID_PATTERN = /^[a-zA-Z0-9_-]{1,32}$/;
const MESSAGE_MAX_LENGTH = 300;
const GENERAL_ROOM_MAX_MESSAGES = 300;
const DEFAULT_ROOM_MAX_MESSAGES = 100;

function safeEmitToast(fn, ...args) {
  try {
    if (typeof fn === 'function') {
      fn(...args);
    }
  } catch (err) {
    console.error('toast emit failed', err);
  }
}

function isValidRoomId(roomId) {
  return typeof roomId === 'string' && ROOM_ID_PATTERN.test(roomId);
}

function sanitizeStoredMessage(record) {
  if (!record || typeof record !== 'object') {
    return null;
  }

  const username = typeof record.username === 'string' ? record.username : '';
  const message = typeof record.message === 'string' ? record.message : '';
  const time = typeof record.time === 'string' ? record.time : '';

  if (!username || !message || !time) {
    return null;
  }

  const out = { username, message, time };
  if (record.admin === true) {
    out.admin = true;
  }

  return out;
}

function createApiMessagesRouter({ redisClient, io, emitUserToast }) {
  const router = express.Router();
  const spamService = createSpamService(redisClient, KEYS);
  const notifyUser = (...args) => safeEmitToast(emitUserToast, ...args);

  router.get('/messages/:roomId([a-zA-Z0-9_-]{1,32})', async (req, res) => {
    try {
      const roomId = typeof req.params.roomId === 'string' ? req.params.roomId : '';
      if (!isValidRoomId(roomId)) {
        return res.sendStatus(400);
      }

      const rawMessages = await redisClient.lrange(KEYS.messages(roomId), 0, -1);
      const messages = rawMessages
        .map((entry) => {
          try {
            return JSON.parse(entry);
          } catch (err) {
            return null;
          }
        })
        .map(sanitizeStoredMessage)
        .filter(Boolean);

      return res.json(messages);
    } catch (err) {
      console.error('get messages failed', err);
      return res.status(500).json({ error: 'Server error' });
    }
  });

  router.post('/messages', async (req, res) => {
    try {
      const roomId = typeof req.body?.roomId === 'string' ? req.body.roomId : '';
      const message = typeof req.body?.message === 'string' ? req.body.message : '';

      if (!roomId || !message) {
        return res.sendStatus(400);
      }

      if (!isValidRoomId(roomId)) {
        return res.sendStatus(400);
      }

      if (message.length > MESSAGE_MAX_LENGTH) {
        return res.sendStatus(400);
      }

      const clientId = typeof req.clientId === 'string' ? req.clientId : '';
      if (!clientId) {
        return res.status(403).json({ error: 'Authentication required', code: 'no_token' });
      }

      const username = await redisClient.get(KEYS.username(clientId));
      if (!username) {
        return res.status(400).json({ error: 'Username not set' });
      }

      const spamResult = await spamService.check(clientId, message);

      if (spamResult.rejected) {
        if (spamResult.muted) {
          notifyUser(
            clientId,
            spamResult.muteSec
              ? `スパムを検知したため${spamResult.muteSec}秒間ミュートされました`
              : '送信が制限されています'
          );
        }

        return res.sendStatus(429);
      }

      if (spamResult.muted) {
        notifyUser(clientId, `スパムを検知したため${spamResult.muteSec}秒間ミュートされました`);
        return res.sendStatus(429);
      }

      let isAdmin = false;
      const token = typeof req.token === 'string' ? req.token : '';

      if (token) {
        const adminOwnerClientId = await redisClient.get(KEYS.adminSession(token));
        if (adminOwnerClientId && adminOwnerClientId === clientId) {
          isAdmin = true;
        }
      }

      const storedMessage = {
        username,
        message,
        time: formatJST(new Date()),
      };

      if (isAdmin) {
        storedMessage.admin = true;
      }

      const maxMessages = roomId === 'general'
        ? GENERAL_ROOM_MAX_MESSAGES
        : DEFAULT_ROOM_MAX_MESSAGES;

      await pushAndTrimList(
        redisClient,
        KEYS.messages(roomId),
        JSON.stringify(storedMessage),
        maxMessages
      );

      io.to(roomId).emit('newMessage', storedMessage);

      return res.json({ ok: true });
    } catch (err) {
      console.error('post messages failed', err);
      return res.status(500).json({ error: 'Server error' });
    }
  });

  return router;
}

module.exports = createApiMessagesRouter;