'use strict';

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function pad(n) {
  return String(n).padStart(2, '0');
}

function toValidDate(input) {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError('Invalid date');
  }
  return date;
}

function toJST(date) {
  const source = toValidDate(date);
  return new Date(source.getTime() + JST_OFFSET_MS);
}

function formatJST(date = new Date()) {
  const jst = toJST(date);
  const yyyy = jst.getUTCFullYear();
  const mm = pad(jst.getUTCMonth() + 1);
  const dd = pad(jst.getUTCDate());
  const hh = pad(jst.getUTCHours());
  const mi = pad(jst.getUTCMinutes());

  return `${yyyy}/${mm}/${dd} ${hh}:${mi}`;
}

module.exports = { pad, toJST, formatJST };