'use strict';

const express = require('express');

const KEYS = require('../lib/redisKeys');
const { pushAndTrimList } = require('../lib/redisHelpers');
const createSpamService = require('../services/spamService');
const { isValidRoomId, isValidMessage, normalizeMessage } = require('../lib/validation');
const { createStoredMessage, parseStoredMessages, toPublicMessage } = require('../lib/messageCodec');

const GENERAL_ROOM_MAX_MESSAGES = 300;
const DEFAULT_ROOM_MAX_MESSAGES = 100;

function readRoomId(req) {
  return typeof req.params?.roomId === 'string' ? req.params.roomId.trim() : '';
}

function readMessage(req) {
  return normalizeMessage(req.body?.message);
}

function getMaxMessages(roomId) {
  return roomId === 'general' ? GENERAL_ROOM_MAX_MESSAGES : DEFAULT_ROOM_MAX_MESSAGES;
}

function createSpamToastMessage(spamResult) {
  if (!spamResult) {
    return null;
  }

  if (spamResult.muted && spamResult.muteSec) {
    return `スパムを検知したため${spamResult.muteSec}秒間ミュートされています`;
  }

  if (spamResult.reason === 'rate-limit') {
    return '送信間隔が短すぎます';
  }

  if (spamResult.reason === 'error') {
    return '送信が制限されています';
  }

  return '送信が制限されています';
}

function createApiMessagesRouter({ redisClient, io, emitUserToast }) {
  const router = express.Router();
  const spamService = createSpamService(redisClient, KEYS);

  router.get('/messages/:roomId', async (req, res) => {
    try {
      const roomId = readRoomId(req);
      if (!isValidRoomId(roomId)) {
        return res.sendStatus(400);
      }

      const rawMessages = await redisClient.lrange(KEYS.messages(roomId), 0, -1);
      const messages = parseStoredMessages(rawMessages);

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

      if (!isValidRoomId(roomId)) {
        return res.sendStatus(400);
      }

      if (!isValidMessage(message)) {
        emitUserToast(typeof req.clientId === 'string' ? req.clientId : '', 'メッセージは1〜300文字で入力してください', {
          tone: 'warning',
        });
        return res.sendStatus(400);
      }

      const clientId = typeof req.clientId === 'string' ? req.clientId : '';
      if (!clientId) {
        return res.status(403).json({ error: 'Authentication required', code: 'no_token' });
      }

      const username = await redisClient.get(KEYS.username(clientId));
      if (!username) {
        return res.status(400).json({ error: 'Username not set', code: 'username_not_set' });
      }

      const spamResult = await spamService.check(clientId, message, req.ip);
      if (spamResult.rejected || spamResult.muted) {
        emitUserToast(clientId, createSpamToastMessage(spamResult), { tone: 'warning' });
        return res.sendStatus(429);
      }

      const token = typeof req.token === 'string' ? req.token : '';
      const isAdmin = token ? (await redisClient.get(KEYS.adminSession(token))) === clientId : false;
      const now = Date.now();
      const messageRecord = {
        username,
        message,
        time: now,
        admin: isAdmin,
      };
      const storedMessage = createStoredMessage(messageRecord);

      await pushAndTrimList(
        redisClient,
        KEYS.messages(roomId),
        storedMessage,
        getMaxMessages(roomId)
      );

      const publicMessage = toPublicMessage(messageRecord);
      if (publicMessage) {
        io.to(roomId).emit('newMessage', publicMessage);
      }

      return res.json({ ok: true });
    } catch (err) {
      console.error('post messages failed', err);
      return res.status(500).json({ error: 'Server error', code: 'server_error' });
    }
  });

  return router;
}

module.exports = createApiMessagesRouter;
