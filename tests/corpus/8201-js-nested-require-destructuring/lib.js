'use strict';

const Events = {
  add(type, handler) {
    return 'add:' + type + ':' + handler;
  },
  remove(type) {
    return 'remove:' + type;
  },
  limit: 3
};

module.exports = {
  Events,
  Util: {
    shout(s) {
      return s.toUpperCase() + '!';
    },
    Deep: {
      sum(a, b) {
        return a + b;
      },
      label: 'deep'
    }
  },
  version: 2
};
