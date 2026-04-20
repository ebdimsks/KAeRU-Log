'use strict';

const crypto = require('crypto');
const { Server: SocketIOServer } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');

const KEYS = require('./lib/redisKeys');
const createWrapperFactory = require('./utils/socketWrapper');
const { validateAuthToken } = require('./auth');
const ClientSessionStore = require('./lib/clientSessionStore');
const SocketSessionManager = require('./lib/socketSessionManager');
const { countRoomMembers } = require('./lib/socketPresence');
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
  const clientSessionStore = new ClientSessionStore(redisClient, { ttlSec: 24 * 60 * 60 });
  const socketSessionManager = new SocketSessionManager({ io, store: clientSessionStore });

  io.use(async (socket, next) => {
    socket.data = socket.data || {};
    socket.data.authenticated = false;
    socket.data.cleanup = async () => {};

    const token = typeof socket.handshake?.auth?.token === 'string'
      ? socket.handshake.auth.token.trim()
      : '';

    if (!token) {
      return next(createSocketError('NO_TOKEN', 'NO_TOKEN'));
    }

    try {
      const clientId = await validateAuthToken(redisClient, token);
      if (!clientId) {
        return next(createSocketError('TOKEN_EXPIRED', 'TOKEN_EXPIRED'));
      }

      const connectionId = socket.id || crypto.randomUUID();
      socket.data.connectionId = connectionId;
      socket.data.clientId = clientId;

      const session = await socketSessionManager.acquire(clientId, connectionId);
      if (!session.acquired) {
        return next(
          createSocketError('CLIENT_SESSION_LIMIT', 'CLIENT_SESSION_LIMIT', {
            clientId,
            limit: 1,
            previousSocketId: session.previousSocketId || null,
          })
        );
      }

      let cleanedUp = false;
      const releaseClientSession = async () => {
        if (cleanedUp) {
          return;
        }

        cleanedUp = true;
        await clientSessionStore.release(clientId, connectionId).catch((err) => {
          console.error('Failed to release client session slot', err);
        });
      };

      socket.data.cleanup = releaseClientSession;
      socket.once('disconnect', () => {
        void socket.data.cleanup?.();
      });

      socket.data.authenticated = true;
      await socket.join(KEYS.userRoom(clientId));

      return next();
    } catch (err) {
      console.error('Authentication error in socket middleware', err);
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
        const roomSize = await countRoomMembers(io, roomId);
        if (typeof roomSize !== 'number') {
          return;
        }

        io.to(roomId).emit('roomUserCount', roomSize);
      } catch (err) {
        console.error('Failed to emit roomUserCount', err);
      }
    };

    const previousCleanup = typeof socket.data?.cleanup === 'function' ? socket.data.cleanup : async () => {};
    socket.data.cleanup = async () => {
      try {
        await previousCleanup();
      } finally {
        const roomId = socket.data?.roomId;
        socket.data.roomId = null;

        if (!roomId) {
          return;
        }

        try {
          await emitRoomUserCount(roomId);
        } catch (err) {
          console.error('Error in disconnect cleanup', err);
        }
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

        socket.data.roomId = roomId;
        await socket.join(roomId);
        await emitRoomUserCount(roomId);
        safeEmitSocket(socket, 'joinedRoom', { roomId });
      })
    );
  });

  return io;
}

module.exports = createSocketServer;
