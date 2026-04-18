'use strict';

module.exports = {
  username: (clientId) => `username:${clientId}`,
  token: (token) => `token:${token}`,

  adminSession: (token) => `admin:session:${token}`,

  userRoom: (clientId) => `user:${clientId}`,
  socketSession: (clientId) => `socket:session:${clientId}`,

  messages: (roomId) => `messages:${roomId}`,
  messagesPattern: () => 'messages:*',

  mute: (clientId) => `msg:mute:${clientId}`,
  muteLevel: (clientId) => `msg:mute_level:${clientId}`,
  spamLastTime: (clientId) => `msg:last_time:${clientId}`,
  spamLastInterval: (clientId) => `msg:last_interval:${clientId}`,
  spamRepeatCount: (clientId) => `msg:repeat_interval_count:${clientId}`,
  spamLastMsgHash: (clientId) => `msg:last_hash:${clientId}`,
  spamRepeatMsgCount: (clientId) => `msg:repeat_msg_count:${clientId}`,

  spamLastTimeIp: (ip) => `msg:last_time:ip:${ip}`,
  spamLastIntervalIp: (ip) => `msg:last_interval:ip:${ip}`,
  spamRepeatCountIp: (ip) => `msg:repeat_interval_count:ip:${ip}`,
  spamLastMsgHashIp: (ip) => `msg:last_hash:ip:${ip}`,
  spamRepeatMsgCountIp: (ip) => `msg:repeat_msg_count:ip:${ip}`,
  spamMuteIp: (ip) => `msg:mute:ip:${ip}`,
  spamMuteLevelIp: (ip) => `msg:mute_level:ip:${ip}`,

  rateUsername: (clientId) => `ratelimit:username:${clientId}`,
  rateClear: (clientId) => `ratelimit:clear:${clientId}`,
  rateAdminLogin: (clientId) => `ratelimit:admin:login:${clientId}`,

  tokenBucketAuthIp: (ip) => `bucket:auth:ip:${ip}`,
};
