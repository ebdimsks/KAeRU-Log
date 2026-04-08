'use strict';

const crypto = require('crypto');
const { Server: SocketIOServer } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');

const KEYS = require('./lib/redisKeys');
const createWrapperFactory = require('./utils/socketWrapper');
const { validateAuthToken } = require('./auth');
const IpSessionStore = require('./lib/ipSessionStore');
const { isTrustProxyEnabled, getSocketClientIp } = require('./utils/trustProxy');
const { isValidRoomId, trimString } = require('./lib/validation');

function safeEmitSocket(socket, event, payload) {
  if (!socket || typeof socket.emit !== 'function') {
    return false;
  }

  try {
    socket.emit(event, payload);
    return true;
  } catch (err) {
    console.error('safeEmitSocket failed', err);
    return false;
  }
}

function createSocketError(code, message, details) {
  const err = new Error(message || code);
  err.code = code;
  if (details !== undefined) {
    err.details = details;
  }
  return err;
}

function createSocketServer({ httpServer, redisClient, frontendUrl }) {
  if (!httpServer) throw new Error('httpServer is required');
  if (!redisClient) throw new Error('redisClient is required');

  const trustProxy = isTrustProxyEnabled(process.env.TRUST_PROXY);
  const pubClient = redisClient.duplicate();
  const subClient = redisClient.duplicate();

  pubClient.on('error', (err) => console.error('Redis pubClient error', err));
  subClient.on('error', (err) => console.error('Redis subClient error', err));

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: frontendUrl,
      methods: ['GET', 'POST', 'OPTIONS'],
      credentials: true,
    },
    adapter: createAdapter(pubClient, subClient),
  });

  const wrapperFactory = createWrapperFactory({ safeEmitSocket });
  const ipSessionStore = new IpSessionStore(redisClient, { limit: 5 });

  io.use(async (socket, next) => {
    const ip = getSocketClientIp(socket, trustProxy);
    const connectionId = socket.id || crypto.randomUUID();

    socket.data = socket.data || {};
    socket.data.ip = ip;
    socket.data.connectionId = connectionId;
    socket.data.authenticated = false;

    let acquired = false;

    const releaseSlot = async () => {
      if (!acquired) return;
      acquired = false;
      await ipSessionStore.release(ip, connectionId).catch((err) => {
        console.error('Failed to release ip slot', err);
      });
    };

    socket.once('disconnect', () => {
      void releaseSlot();
    });

    try {
      const { success, count } = await ipSessionStore.tryAcquire(ip, connectionId);
      if (!success) {
        return next(
          createSocketError('IP_SESSION_LIMIT', 'IP_SESSION_LIMIT', {
            ip,
            count,
            limit: ipSessionStore.limit,
          })
        );
      }

      acquired = true;

      const token = trimString(socket.handshake?.auth?.token);
      if (!token) {
        await releaseSlot();
        return next(createSocketError('NO_TOKEN', 'NO_TOKEN'));
      }

      const clientId = await validateAuthToken(redisClient, token);
      if (!clientId) {
        await releaseSlot();
        return next(createSocketError('TOKEN_EXPIRED', 'TOKEN_EXPIRED'));
      }

      socket.data.clientId = clientId;
      socket.data.authenticated = true;
      await socket.join(KEYS.userRoom(clientId));
      return next();
    } catch (err) {
      console.error('Authentication error in socket middleware', err);
      if (acquired) {
        await releaseSlot().catch(() => {});
      }
      return next(createSocketError('AUTHENTICATION_ERROR', 'Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    const wrap = wrapperFactory(socket);

    const emitRoomUserCount = async (roomId) => {
      if (!roomId) return;

      try {
        const roomSize = io.sockets.adapter.rooms.get(roomId)?.size || 0;
        io.to(roomId).emit('roomUserCount', roomSize);
      } catch (err) {
        console.error('Failed to emit roomUserCount', err);
      }
    };

    socket.on(
      'joinRoom',
      wrap(async (socket, data = {}) => {
        const roomId = trimString(data?.roomId);

        if (!socket.data?.authenticated || !socket.data?.clientId) {
          safeEmitSocket(socket, 'authRequired', {});
          return;
        }

        if (!isValidRoomId(roomId)) {
          safeEmitSocket(socket, 'error', { message: 'Invalid roomId' });
          return;
        }

        const currentRooms = Array.from(socket.rooms || []);
        for (const room of currentRooms) {
          if (typeof room === 'string' && room.startsWith('room:')) {
            await socket.leave(room).catch((err) => {
              console.error('Failed to leave room', err);
            });
            await emitRoomUserCount(room).catch((err) => {
              console.error('Failed to emit room user count after leave', err);
            });
          }
        }

        const newRoom = `room:${roomId}`;
        await socket.join(newRoom);
        await emitRoomUserCount(newRoom);
        safeEmitSocket(socket, 'joinedRoom', { roomId });
      })
    );

    socket.on('disconnecting', async () => {
      try {
        const rooms = Array.from(socket.rooms || []);
        for (const room of rooms) {
          if (typeof room === 'string' && room.startsWith('room:')) {
            await emitRoomUserCount(room);
          }
        }
      } catch (err) {
        console.error('disconnecting handler failed', err);
      }
    });
  });

  return io;
}

module.exports = createSocketServer;
