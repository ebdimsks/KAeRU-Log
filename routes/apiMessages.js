'use strict';

const express = require('express');

const KEYS = require('../lib/redisKeys');
const { pushAndTrimList } = require('../lib/redisHelpers');
const createSpamService = require('../services/spamService');
const { formatISO8601 } = require('../utils/time');
const { isValidRoomId, isValidMessage, normalizeMessage } = require('../lib/validation');
const { createSafeToastEmitter } = require('../lib/emitToast');

const GENERAL_ROOM_MAX_MESSAGES = 300;
const DEFAULT_ROOM_MAX_MESSAGES = 100;

function parseStoredMessage(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const username = typeof raw.username === 'string' ? raw.username.trim() : '';
  const message = typeof raw.message === 'string' ? raw.message.trim() : '';
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

  const message = {
    username: parsed.username,
    message: parsed.message,
    time: formatISO8601(new Date(parsed.time)),
  };

  if (parsed.admin) {
    message.admin = true;
  }

  return message;
}

function readRoomId(req) {
  return typeof req.params?.roomId === 'string' ? req.params.roomId.trim() : '';
}

function readMessage(req) {
  return normalizeMessage(req.body?.message);
}

function getMaxMessages(roomId) {
  return roomId === 'general' ? GENERAL_ROOM_MAX_MESSAGES : DEFAULT_ROOM_MAX_MESSAGES;
}

function createApiMessagesRouter({ redisClient, io, emitUserToast }) {
  const router = express.Router();
  const spamService = createSpamService(redisClient, KEYS);
  const notifyUser = createSafeToastEmitter(emitUserToast);

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
      return res.status(500).json({ error: 'Server error' });
    }
  });

  router.post('/messages/:roomId', async (req, res) => {
    try {
      const roomId = readRoomId(req);
      const message = readMessage(req);

      if (!isValidRoomId(roomId) || !isValidMessage(message)) {
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

      const token = typeof req.token === 'string' ? req.token : '';
      const isAdmin = token ? (await redisClient.get(KEYS.adminSession(token))) === clientId : false;
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
        time: formatISO8601(new Date(now)),
        ...(storedMessage.admin ? { admin: true } : {}),
      });

      return res.json({ ok: true });
    } catch (err) {
      console.error('post messages failed', err);
      return res.status(500).json({ error: 'Server error' });
    }
  });

  return router;
}

module.exports = createApiMessagesRouter;
