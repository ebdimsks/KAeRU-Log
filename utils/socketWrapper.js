module.exports = function createWrapperFactory({ redisClient, io, safeEmitSocket }) {
  return function wrapperFactory(socket) {
    return function wrap(handler) {
      return async (...args) => {
        try {
          await handler(socket, ...args);
        } catch (err) {
          try {
            console.error('socketHandlerError', err.message);
          } catch (e) {
            console.error('Failed to log socket handler error', e);
          }

          try {
            safeEmitSocket(socket, 'error', { message: err.message || 'Internal Server Error' });
          } catch (e) {
            // ignore
          }
        }
      };
    };
  };
};