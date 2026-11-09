"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.addTransactionSupport = void 0;
const Pipeline_1 = require("./Pipeline");
function addTransactionSupport(redis) {
    redis.pipeline = function (commands) {
        const pipeline = new Pipeline_1.default(this);
        return pipeline;
    };
    redis.multi = function (commands, options) {
        const pipeline = new Pipeline_1.default(this);
        const exec = pipeline.exec;
        // An instance-own override reading `this`, as ioredis' multi installs on the pipeline it returns.
        pipeline.exec = function (callback) {
            if (this.redis.isCluster) {
                return Promise.resolve(null);
            }
            return exec.call(pipeline);
        };
        return pipeline;
    };
}
exports.addTransactionSupport = addTransactionSupport;
