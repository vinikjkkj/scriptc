// Event.timeStamp is performance.now() at construction: monotonic and bracketed by the clock reads around it.
const t0 = performance.now();
const e1 = new Event('a');
const e2 = new Event('b');
const t1 = performance.now();
console.log(e1.timeStamp >= t0, e1.timeStamp <= e2.timeStamp, e2.timeStamp <= t1, typeof e1.timeStamp);
const c = new AbortController();
let stamp = -1;
c.signal.addEventListener('abort', (ev: Event) => { stamp = ev.timeStamp; });
const before = performance.now();
c.abort();
const after = performance.now();
console.log(stamp >= before, stamp <= after);
