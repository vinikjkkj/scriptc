'use strict';
const Core = require('./lib/core.js');
const PromisePool = require('./lib/promise/pool.js');
const PromisePoolConnection = require('./lib/promise/pool_connection.js');

function createPool(label) {
  return new PromisePool(new Core(label), Promise);
}
exports.createPool = createPool;
exports.PoolConnection = PromisePoolConnection;
