"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Commander_1 = require("./Commander");
class Pipeline extends Commander_1.default {
    constructor(redis) {
        super();
        this.redis = redis;
        this.queue = [];
    }
    sendCommand(command) {
        this.queue.push(command.name + ":" + command.args.join("+"));
        return this;
    }
    get length() {
        return this.queue.length;
    }
    exec(callback) {
        const out = this.queue.map((q) => [null, q]);
        this.queue = [];
        const promise = new Promise((resolve) => {
            resolve(out);
        });
        return promise;
    }
}
exports.default = Pipeline;
