'use strict';

const crypto = require('crypto');
const { Server: SocketIOServer } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');

const KEYS = require('./lib/redisKeys');
const createWrapperFactory = require('./utils/socketWrapper');
const { validateAuthToken } = require('./auth');
const IpSessionStore = require('./lib/ipSessionStore');
const { isTrustProxyEnabled, getSocketClientIp } = require('./utils/trustProxy');
const { isValidRoomId } = require('./lib/validation');

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
  if (!httpServer) {
    throw new Error('httpServer is required');
  }
  if (!redisClient) {
    throw new Error('redisClient is required');
  }

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

  io.closeRedisConnections = async () => {
    const tasks = [pubClient.quit(), subClient.quit()];
    await Promise.allSettled(tasks);
  };

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
      if (!acquired) {
        return;
      }

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

      const token = typeof socket.handshake?.auth?.token === 'string'
        ? socket.handshake.auth.token.trim()
        : '';

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
      if (!roomId) {
        return;
      }

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
        const roomId = typeof data?.roomId === 'string' ? data.roomId.trim() : '';

        if (!socket.data?.authenticated || !socket.data?.clientId) {
          safeEmitSocket(socket, 'authRequired', {});
          return;
        }

        if (!isValidRoomId(roomId)) {
          return;
        }

        const previousRoomId = socket.data.roomId;
        if (previousRoomId && previousRoomId !== roomId) {
          await socket.leave(previousRoomId);
          await emitRoomUserCount(previousRoomId);
        }

        if (roomId) {
          await socket.join(roomId);
          socket.data.roomId = roomId;
          await emitRoomUserCount(roomId);
          safeEmitSocket(socket, 'joinedRoom', { roomId });
        }
      })
    );

    socket.once('disconnect', async () => {
      try {
        const roomId = socket.data?.roomId;
        if (!roomId) {
          return;
        }

        await socket.leave(roomId);
        await emitRoomUserCount(roomId);
      } catch (err) {
        console.error('Error in disconnect handler', err);
      }
    });
  });

  return io;
}

module.exports = createSocketServer;
