const dc = require('node:diagnostics_channel');
const ch = dc.tracingChannel('mysql2:connect');
function shouldTrace(channel) { return channel.hasSubscribers ?? channel.start?.hasSubscribers ?? false; }
function tracePromise(channel, fn, contextFactory) {
  if (shouldTrace(channel)) return channel.tracePromise(fn, contextFactory());
  return fn();
}
function traceCallback(channel, fn, position, context, thisArg, ...args) {
  if (shouldTrace(channel)) return channel.traceCallback(fn, position, context(), thisArg, ...args);
  return fn.apply(thisArg, args);
}
module.exports = { connectChannel: ch, tracePromise, traceCallback, shouldTrace };
