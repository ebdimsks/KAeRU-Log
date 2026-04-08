'use strict';

const express = require('express');

const KEYS = require('../lib/redisKeys');
const { pushAndTrimList } = require('../lib/redisHelpers');
const createSpamService = require('../services/spamService');
const { toIsoString } = require('../utils/time');
const { isValidRoomId, isValidMessage, trimString } = require('../lib/validation');

const GENERAL_ROOM_MAX_MESSAGES = 300;
const DEFAULT_ROOM_MAX_MESSAGES = 100;

function safeEmitToast(fn, ...args) {
  if (typeof fn !== 'function') {
    return;
  }

  try {
    fn(...args);
  } catch (err) {
    console.error('toast emit failed', err);
  }
}

function parseStoredMessage(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const username = trimString(raw.username);
  const message = trimString(raw.message);
  const time = raw.time;

  if (!username || !message || typeof time !== 'number' || !Number.isFinite(time)) {
    return null;
  }

  return {
    username,
    message,
    time,
    admin: raw.admin === true,
  };
}

function toPublicMessage(record) {
  const parsed = parseStoredMessage(record);
  if (!parsed) {
    return null;
  }

  return {
    username: parsed.username,
    message: parsed.message,
    time: toIsoString(parsed.time),
    ...(parsed.admin ? { admin: true } : {}),
  };
}

function readRoomId(req) {
  return trimString(req.params?.roomId);
}

function readMessage(req) {
  return trimString(req.body?.message);
}

function getMaxMessages(roomId) {
  return roomId === 'general' ? GENERAL_ROOM_MAX_MESSAGES : DEFAULT_ROOM_MAX_MESSAGES;
}

function createApiMessagesRouter({ redisClient, io, emitUserToast }) {
  const router = express.Router();
  const spamService = createSpamService(redisClient, KEYS);
  const notifyUser = (...args) => safeEmitToast(emitUserToast, ...args);

  router.get('/messages/:roomId', async (req, res) => {
    try {
      const roomId = readRoomId(req);
      if (!isValidRoomId(roomId)) {
        return res.sendStatus(400);
      }

      const rawMessages = await redisClient.lrange(KEYS.messages(roomId), 0, -1);
      const messages = rawMessages
        .map((entry) => {
          try {
            return JSON.parse(entry);
          } catch {
            return null;
          }
        })
        .map(toPublicMessage)
        .filter(Boolean);

      return res.json(messages);
    } catch (err) {
      console.error('get messages failed', err);
      return res.status(500).json({ error: 'Server error', code: 'server_error' });
    }
  });

  router.post('/messages/:roomId', async (req, res) => {
    try {
      const roomId = readRoomId(req);
      const message = readMessage(req);

      if (!isValidRoomId(roomId) || !isValidMessage(message)) {
        return res.sendStatus(400);
      }

      const clientId = trimString(req.clientId);
      if (!clientId) {
        return res.status(403).json({ error: 'Authentication required', code: 'no_token' });
      }

      const username = trimString(await redisClient.get(KEYS.username(clientId)));
      if (!username) {
        return res.status(400).json({ error: 'Username not set', code: 'username_missing' });
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
      const token = trimString(req.token);
      if (token) {
        const adminOwnerClientId = trimString(await redisClient.get(KEYS.adminSession(token)));
        isAdmin = adminOwnerClientId === clientId;
      }

      const now = Date.now();
      const storedMessage = {
        username,
        message,
        time: now,
        ...(isAdmin ? { admin: true } : {}),
      };

      await pushAndTrimList(
        redisClient,
        KEYS.messages(roomId),
        JSON.stringify(storedMessage),
        getMaxMessages(roomId)
      );

      io.to(roomId).emit('newMessage', {
        username: storedMessage.username,
        message: storedMessage.message,
        time: toIsoString(now),
        ...(storedMessage.admin ? { admin: true } : {}),
      });

      return res.json({ ok: true });
    } catch (err) {
      console.error('post messages failed', err);
      return res.status(500).json({ error: 'Server error', code: 'server_error' });
    }
  });

  return router;
}

module.exports = createApiMessagesRouter;
