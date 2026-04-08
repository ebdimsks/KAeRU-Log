'use strict';

function toValidDate(input) {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError('Invalid date');
  }
  return date;
}

function toIsoString(value = new Date()) {
  return toValidDate(value).toISOString();
}

module.exports = { toValidDate, toIsoString };
