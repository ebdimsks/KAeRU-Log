'use strict';

const { isSocketActive } = require('./socketPresence');

class SocketSessionManager {
  constructor({ io, store }) {
    if (!io) {
      throw new Error('io is required');
    }
    if (!store) {
      throw new Error('store is required');
    }

    this.io = io;
    this.store = store;
  }

  async acquire(clientId, socketId) {
    const acquired = await this.store.tryAcquire(clientId, socketId);
    if (acquired) {
      return { acquired: true, replacedStale: false, previousSocketId: null };
    }

    const previousSocketId = await this.store.get(clientId);
    if (!previousSocketId || previousSocketId === socketId) {
      const retried = await this.store.tryAcquire(clientId, socketId);
      return {
        acquired: retried,
        replacedStale: false,
        previousSocketId,
      };
    }

    const previousIsActive = await isSocketActive(this.io, previousSocketId);
    if (previousIsActive) {
      return { acquired: false, replacedStale: false, previousSocketId };
    }

    await this.store.release(clientId, previousSocketId);

    const reacquired = await this.store.tryAcquire(clientId, socketId);
    return {
      acquired: reacquired,
      replacedStale: reacquired,
      previousSocketId,
    };
  }
}

module.exports = SocketSessionManager;
