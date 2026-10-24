// mysql2's tracing.js: the diagnostics_channel module loaded through the safe-load IIFE, its
// tracingChannel probed with typeof dc?.tracingChannel, and channels asked for subscribers.
// (No subscriber is attached: the untyped parameter of shouldTrace receives the channel handle
// as a number today, so a subscribed channel is not modeled here.)
const { traceCallback, tracePromise, queryChannel, shouldTrace, hasTracingChannel, getServerContext } = require('./tracing.cjs');
console.log(hasTracingChannel, shouldTrace(undefined), shouldTrace(null));
function run(sql, cb) { setImmediate(() => cb(null, [sql.length])); return 'ran ' + sql; }
const r = traceCallback(queryChannel, run, 1, () => ({ sql: 'select 1', host: 'h' }), null, 'select 1', (err, rows) => {
  console.log('cb', err, rows);
  tracePromise(queryChannel, () => Promise.resolve(5), () => ({ sql: 'p' })).then((v) => { console.log('promise', v); });
});
console.log(r, getServerContext({ socketPath: '/s' }), getServerContext({}), getServerContext({ host: 'db', port: 3307 }));
const dc = require('node:diagnostics_channel');
console.log(typeof dc.tracingChannel === 'function', typeof dc?.channel === 'function');
