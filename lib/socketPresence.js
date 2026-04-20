'use strict';

async function countRoomMembers(io, roomId) {
  if (!io || typeof io.in !== 'function' || typeof roomId !== 'string' || roomId.trim() === '') {
    return null;
  }

  try {
    const sockets = await io.in(roomId).allSockets();
    return sockets instanceof Set ? sockets.size : 0;
  } catch (err) {
    console.error('socketPresence.countRoomMembers failed', err);
    return null;
  }
}

async function isSocketActive(io, socketId) {
  if (!io || typeof io.in !== 'function' || typeof socketId !== 'string' || socketId.trim() === '') {
    return false;
  }

  try {
    const sockets = await io.in(socketId.trim()).allSockets();
    return sockets instanceof Set && sockets.size > 0;
  } catch (err) {
    console.error('socketPresence.isSocketActive failed', err);
    return false;
  }
}

module.exports = {
  countRoomMembers,
  isSocketActive,
};
