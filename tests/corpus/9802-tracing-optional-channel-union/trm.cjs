'use strict';
const process = require('process');
const dc = (() => { try { return 'getBuiltinModule' in process ? process.getBuiltinModule('node:diagnostics_channel') : require('node:diagnostics_channel'); } catch { return undefined; } })();
const hasTracingChannel = typeof dc?.tracingChannel === 'function';
const connectChannel = hasTracingChannel ? dc.tracingChannel('mysql2:connect') : undefined;
function getServerContext(config) { return { serverAddress: config.host || 'localhost', serverPort: config.port || 3306 }; }
function shouldTrace(channel) {
  if (channel === undefined || channel === null) return false;
  return channel.hasSubscribers ?? channel.start?.hasSubscribers ?? false;
}
function tracePromise(channel, fn, contextFactory) {
  if (shouldTrace(channel)) return channel.tracePromise(fn, contextFactory());
  return fn();
}
module.exports = { connectChannel, tracePromise, shouldTrace, getServerContext };
