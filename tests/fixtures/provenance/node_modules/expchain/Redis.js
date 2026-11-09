"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Commander_1 = require("./Commander");
const transaction_1 = require("./transaction");
class Redis extends Commander_1.default {
    constructor(options) {
        super();
        this.options = options;
        this.sent = 0;
    }
    sendCommand(command) {
        this.sent++;
        return Promise.resolve(command.name + ":" + command.args.join("+"));
    }
}
(0, transaction_1.addTransactionSupport)(Redis.prototype);
exports.default = Redis;
