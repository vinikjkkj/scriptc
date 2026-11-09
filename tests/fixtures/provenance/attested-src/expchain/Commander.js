"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class Commander {
    constructor() {
        this.options = {};
    }
}
function generateFunction(name) {
    return function (...args) {
        return this.sendCommand({ name, args });
    };
}
["get", "set", "hset", "incr", "del"].forEach((name) => {
    Commander.prototype[name] = generateFunction(name);
});
exports.default = Commander;
