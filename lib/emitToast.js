'use strict';

function createSafeToastEmitter(emitToast) {
  return (...args) => {
    try {
      if (typeof emitToast === 'function') {
        emitToast(...args);
      }
    } catch (err) {
      console.error('toast emit failed', err);
    }
  };
}

module.exports = { createSafeToastEmitter };
