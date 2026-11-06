// process.nextTick as a VALUE (ioredis DelayQueue: `options.callback || process.nextTick`): same queue as the direct call, trailing
// arguments reach the callback, a non-function callback is Node's catchable ERR_INVALID_ARG_TYPE at the call, identity holds.
const nt = process.nextTick;
const log = [];
nt((a, b) => log.push("value " + a + b), "x", "y");
process.nextTick(() => log.push("direct"));
nt(() => log.push("value-noargs"));
Promise.resolve().then(() => log.push("promise"));
function pick(options) { return options.callback || process.nextTick; }
pick({})(() => log.push("picked"));
pick({ callback: (f) => { log.push("custom"); f(); } })(() => log.push("custom-ran"));
try { nt(1); } catch (e) { console.log(e.name, e.code, e.message.split(".")[0]); }
try { nt(); } catch (e) { console.log(e.name, e.code); }
console.log(nt === process.nextTick, typeof nt, pick({}) === nt);
setTimeout(() => console.log(log.join(",")), 5);
