"use strict";
class Redis {
    constructor(n) { this.n = n; }
    get() { return this.n * 2; }
}
Redis.defaultOptions = { a: 1 };
exports.default = Redis;
exports.Redis = Redis;
