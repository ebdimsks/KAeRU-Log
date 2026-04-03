'use strict';

module.exports = function createWrapperFactory({ safeEmitSocket } = {}) {
  return function wrapperFactory(socket) {
    return function wrap(handler) {
      if (typeof handler !== 'function') {
        throw new TypeError('socket handler must be a function');
      }

      return async (...args) => {
        try {
          await handler(socket, ...args);
        } catch (err) {
          try {
            console.error('socketHandlerError', err);
          } catch (logErr) {
            console.error('Failed to log socket handler error', logErr);
          }

          try {
            const message = err && typeof err.message === 'string'
              ? err.message
              : 'Internal Server Error';

            safeEmitSocket?.(socket, 'error', { message });
          } catch (emitErr) {
            console.error('Failed to emit socket error', emitErr);
          }
        }
      };
    };
  };
};