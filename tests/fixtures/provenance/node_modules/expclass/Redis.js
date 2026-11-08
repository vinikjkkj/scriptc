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
        return this.queue.map((c) => (c[0] === "get" ? this.redis.get(c[1]) : c[0] + ":" + c[1]));
    }
}
// The commands are installed on the prototype by a loop over a name list, the way ioredis' Commander installs its command methods.
const COMMANDS = ["cmd0", "cmd1", "cmd2", "cmd3", "cmd4", "cmd5", "cmd6", "cmd7", "cmd8", "cmd9", "cmd10", "cmd11", "cmd12", "cmd13", "cmd14", "cmd15", "cmd16", "cmd17", "cmd18", "cmd19", "cmd20", "cmd21", "cmd22", "cmd23", "cmd24", "cmd25", "cmd26", "cmd27", "cmd28", "cmd29", "cmd30", "cmd31", "cmd32", "cmd33", "cmd34", "cmd35", "cmd36", "cmd37", "cmd38", "cmd39", "cmd40", "cmd41", "cmd42", "cmd43", "cmd44", "cmd45", "cmd46", "cmd47", "cmd48", "cmd49", "cmd50", "cmd51", "cmd52", "cmd53", "cmd54", "cmd55", "cmd56", "cmd57", "cmd58", "cmd59", "cmd60", "cmd61", "cmd62", "cmd63", "cmd64", "cmd65", "cmd66", "cmd67", "cmd68", "cmd69"];
COMMANDS.forEach((name) => {
    Pipeline.prototype[name] = function (key) {
        this.queue.push([name, key]);
        return this;
    };
});
exports.default = Redis;
