'use strict';

// A module whose export is a table of methods with untyped parameters, the
// way plain-JS packages (ws's event-target, mysql2's helpers) write them.
const Tools = {
  greet(name) {
    return 'hello ' + name;
  },
  twice(n) {
    return n * 2;
  },
  join(a, b) {
    return a + ':' + b;
  }
};

const Consts = { LIMIT: 7, NAME: 'lib' };

function plain(x) {
  return x + 1;
}

module.exports = { Tools, Consts, plain };
