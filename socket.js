'use strict';

const crypto = require('crypto');
const { Server: SocketIOServer } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');

const KEYS = require('./lib/redisKeys');
const createWrapperFactory = require('./utils/socketWrapper');
const { validateAuthToken } = require('./auth');
const IpSessionStore = require('./lib/ipSessionStore');

const IP_SESSION_LIMIT = 5;
const IP_SESSION_TTL = 60;

function safeEmitSocket(socket, event, payload) {
  if (!socket || typeof socket.emit !== 'function') return false;
  try {
    socket.emit(event, payload);
    return true;
  } catch (e) {
    console.error('safeEmitSocket failed', e);
    return false;
  }
}

// Reverse-proxy (X-Forwarded-For) 対応
function getClientIp(socket) {
  const xffRaw = socket.handshake.headers['x-forwarded-for'];
  const xff = Array.isArray(xffRaw) ? xffRaw[0] : xffRaw;
  if (xff) return xff.split(',')[0].trim();
  return socket.handshake.address;
}

function createSocketServer({ httpServer, redisClient, frontendUrl }) {
  if (!redisClient) throw new Error('redisClient is required');

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

  const wrapperFactory = createWrapperFactory({
    redisClient,
    io,
    safeEmitSocket,
  });

  const ipSessionStore = new IpSessionStore(redisClient, {
    limit: IP_SESSION_LIMIT,
    ttl: IP_SESSION_TTL,
  });

  io.use(async (socket, next) => {
    const ip = getClientIp(socket);
    const connectionId = socket.id || crypto.randomUUID();

    socket.data = socket.data || {};
    socket.data.ip = ip;
    socket.data.connectionId = connectionId;

    let acquired = false;

    try {
      const { success, count } = await ipSessionStore.tryAcquire(ip, connectionId);

      if (!success) {
        const err = new Error('IP_SESSION_LIMIT');
        err.details = { ip, count, limit: IP_SESSION_LIMIT };
        return next(err);
      }

      acquired = true;

      socket.on('disconnect', () => {
        ipSessionStore.release(ip, connectionId).catch((e) => {
          console.error('Failed to release ip slot on disconnect', e);
        });
      });

      const token = socket.handshake.auth?.token;
      if (!token) {
        await ipSessionStore.release(ip, connectionId);
        return next(new Error('NO_TOKEN'));
      }

      const clientId = await validateAuthToken(redisClient, token);
      if (!clientId) {
        await ipSessionStore.release(ip, connectionId);
        return next(new Error('TOKEN_EXPIRED'));
      }

      socket.data.clientId = clientId;
      socket.data.authenticated = true;
      socket.join(KEYS.userRoom(clientId));

      return next();
    } catch (err) {
      console.error('Authentication error in socket middleware', err);

      if (acquired) {
        await ipSessionStore.release(ip, connectionId).catch(() => {});
      }

      return next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    const wrap = wrapperFactory(socket);

    socket.on(
      'joinRoom',
      wrap(async (socket, data = {}) => {
        const { roomId } = data;

        if (!socket.data?.authenticated || !socket.data?.clientId) {
          safeEmitSocket(socket, 'authRequired', {});
          return;
        }

        if (!roomId || !/^[a-zA-Z0-9_-]{1,32}$/.test(roomId)) {
          return;
        }

        if (socket.data.roomId) socket.leave(socket.data.roomId);

        socket.join(roomId);
        socket.data.roomId = roomId;

        const roomSize = io.sockets.adapter.rooms.get(roomId)?.size || 0;
        io.to(roomId).emit('roomUserCount', roomSize);
      })
    );

    socket.on('disconnect', async () => {
      try {
        const roomId = socket.data?.roomId;

        if (roomId) {
          socket.leave(roomId);
          const roomSize = io.sockets.adapter.rooms.get(roomId)?.size || 0;
          io.to(roomId).emit('roomUserCount', roomSize);
        }
      } catch (err) {
        console.error('Error in disconnect handler', err);
      }
    });
  });

  return io;
}

module.exports = createSocketServer;
