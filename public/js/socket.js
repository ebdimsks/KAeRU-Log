import { SERVER_URL } from './config.js';
import { state } from './state.js';
import { elements } from './dom.js';
import { setConnectionState, scrollBottom, focusInput, validateRoomId } from './utils.js';
import { showServerToast } from './toast.js';
import { createMessage } from './render.js';
import { loadHistory } from './services.js';
import { obtainToken } from './api.js';

export function joinRoom() {
  if (!state.socket) return;
  if (!state.roomId || !validateRoomId(state.roomId)) return;
  state.socket.emit('joinRoom', { roomId: state.roomId });
}

export function createSocket() {
  if (
    state.socket &&
    (state.socket.connected || (state.socket.io && state.socket.io.engine && !state.socket.io.engine.closed))
  ) {
    return;
  }

  // Prepare options: only send auth when we have a token.
  const socketOptions = {
    transports: ['websocket'],
    secure: true,
  };

  if (state.myToken) {
    socketOptions.auth = { token: state.myToken };
    socketOptions.autoConnect = true;
  } else {
    // Prevent automatic connect when no token is present.
    socketOptions.autoConnect = false;
  }

  state.socket = io(SERVER_URL, socketOptions);

  // If we created the socket without autoConnect, try to obtain token and then connect.
  if (!state.myToken) {
    // Do not block creation; attempt to fetch token in background.
    obtainToken()
      .then(() => {
        if (!state.socket) return;
        if (state.myToken) {
          state.socket.auth = { token: state.myToken };
        } else {
          // Ensure auth field removed when still no token
          try {
            delete state.socket.auth;
          } catch (e) {}
        }
        try {
          state.socket.connect();
        } catch (e) {}
      })
      .catch(() => {
        location.reload();
      });
  }

  state.socket.on('connect', () => {
    setConnectionState('online');
    joinRoom();
  });

  state.socket.on('disconnect', () => setConnectionState('offline'));

  state.socket.io.on('reconnect_attempt', () => {
    // Only set auth when we actually have a token.
    if (state.socket) {
      if (state.myToken) {
        state.socket.auth = { token: state.myToken };
      } else {
        try {
          delete state.socket.auth;
        } catch (e) {}
      }
    }
    setConnectionState('connecting');
  });

  state.socket.on('newMessage', (msg) => {
    state.messages.push(msg);
    elements.messageList?.appendChild(createMessage(msg));
    if (state.isAutoScroll) scrollBottom(true);
  });

  state.socket.on('clearMessages', () => {
    state.messages = [];
    if (elements.messageList) elements.messageList.innerHTML = '';
    showServerToast('メッセージがクリアされました');
  });

  state.socket.on('error', (err) => {
    console.error('Socket error:', err);
    showServerToast('エラーが発生しました: ' + (err.message || '不明'));
  });

  state.socket.on('toast', (data) => {
    if (data.scope === 'user') {
      showToast(data.message);
    } else if (data.scope === 'room') {
      showServerToast(data.message);
    }
  });

  state.socket.on('roomUserCount', (count) => {
    if (typeof count === 'number' && elements.onlineUserCount) {
      elements.onlineUserCount.textContent = `${count}`;
    }
  });

  state.socket.on('joinedRoom', () => {
    loadHistory();
    focusInput();
  });

  state.socket.on('connect_error', async (err) => {
    const msg = String((err && err.message) || '');

    if (/TOKEN_EXPIRED/.test(msg)) {
      state.myToken = null;
      localStorage.removeItem('chatToken');

      try {
        await obtainToken();

        if (state.socket) {
          if (state.myToken) {
            state.socket.auth = { token: state.myToken };
          } else {
            try { delete state.socket.auth; } catch (e) {}
          }
          try { state.socket.disconnect(); } catch (e) {}
          try { state.socket.connect(); } catch (e) {}
        } else {
          createSocket();
        }
      } catch (e) {
        location.reload();
      }
      return;
    }

    if (/NO_TOKEN/.test(msg) || /NO_TOKEN/.test(msg.toUpperCase())) {
      state.myToken = null;
      localStorage.removeItem('chatToken');
      location.reload();
      return;
    }

    location.reload();
  });
}

export async function startConnection() {
  if (!state.myToken) {
    try {
      await obtainToken();
    } catch (e) {
      location.reload();
      throw e;
    }
  }

  if (!state.socket) createSocket();
  else if (!state.socket.connected) {
    if (state.myToken) state.socket.auth = { token: state.myToken || '' };
    state.socket.connect();
  }
}
