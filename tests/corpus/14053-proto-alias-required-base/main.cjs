'use strict';
const Connection = require('./connection.cjs');
class PoolConnection extends Connection {}
module.exports = PoolConnection;
// Installed AFTER the export, from the required binding (pool_connection.js's shape).
PoolConnection.prototype._realEnd = Connection.prototype.end;
const p = new PoolConnection({ n: 4 });
console.log(p._realEnd(), p._realEnd("x"), p.tag);
console.log(new PoolConnection({ n: 9, isServer: true })._realEnd());
