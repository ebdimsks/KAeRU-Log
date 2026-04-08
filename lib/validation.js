'use strict';

const ROOM_ID_PATTERN = /^[a-zA-Z0-9_-]{1,32}$/;
const USERNAME_MAX_LENGTH = 20;
const MESSAGE_MAX_LENGTH = 300;

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isValidRoomId(roomId) {
  return typeof roomId === 'string' && ROOM_ID_PATTERN.test(roomId);
}

function isValidUsername(username) {
  const normalized = trimString(username);
  return normalized.length > 0 && normalized.length <= USERNAME_MAX_LENGTH;
}

function isValidMessage(message) {
  const normalized = trimString(message);
  return normalized.length > 0 && normalized.length <= MESSAGE_MAX_LENGTH;
}

module.exports = {
  ROOM_ID_PATTERN,
  USERNAME_MAX_LENGTH,
  MESSAGE_MAX_LENGTH,
  trimString,
  isValidRoomId,
  isValidUsername,
  isValidMessage,
};
