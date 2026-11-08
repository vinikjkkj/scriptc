"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class Redis {
    constructor(opts) {
        this.opts = opts;
        this.calls = 0;
    }
    get(key) {
        this.calls++;
        return "v:" + key;
    }
    ping() {
        return "PONG";
    }
    pipeline() {
        return new Pipeline(this);
    }
}
class Pipeline {
    constructor(redis) {
        this.redis = redis;
        this.queue = [];
    }
    get(key) {
        this.queue.push(["get", key]);
        return this;
    }
    exec() {
        return this.queue.map((c) => this.redis.get(c[1]));
    }
}
exports.default = Redis;
