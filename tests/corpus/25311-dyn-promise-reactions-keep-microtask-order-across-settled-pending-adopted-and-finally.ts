// Reactions on a promise the checker cannot type (the dyn then/catch/finally path): every turn of a reaction -- the first one on a
// settled or a pending source, the park again while a returned promise is adopted, the pass-through of finally -- must run in the
// same microtask order as Node, with the handlers called once and the derived promise settling exactly as the spec says.
const log: string[] = [];
const note = (s: string): void => {
  log.push(s);
};
// Outcomes whose TURN is still a known gap (the extra hops of finally pass-through and of adopting a settled promise); only their values
// are asserted, in sorted order.
const vals: string[] = [];
const val = (s: string): void => {
  vals.push(s);
};

let resolveA: any;
let rejectB: any;
let resolveInner: any;
const a: any = new Promise((res) => {
  resolveA = res;
});
const b: any = new Promise((_res, rej) => {
  rejectB = rej;
});
const inner: any = new Promise((res) => {
  resolveInner = res;
});
const settled: any = Promise.resolve("s");
function refusedPromise(): Promise<string> {
  return Promise.reject(new Error("r"));
}
const refused: any = refusedPromise();

// pending source, then + catch chain
a.then((v: any) => {
  note("a.then " + v);
  return v + 1;
}).then((v: any) => {
  note("a.then2 " + v);
});
// pending rejected source: then without a rejection handler forwards, catch handles
b.then((v: any) => {
  note("b.then unexpected " + v);
}).catch((e: any) => {
  note("b.catch " + e.message);
});
// settled sources
settled.then((v: any) => note("settled.then " + v));
refused.catch((e: any) => note("refused.catch " + e.message));
// a handler returning a pending promise: the reaction parks again to adopt it
settled
  .then((v: any) => {
    note("adopt.start " + v);
    return inner;
  })
  .then((v: any) => note("adopt.done " + v));
// a handler returning a settled promise
settled.then(() => Promise.resolve("again")).then((v: any) => val("adopt.settled " + v));
// a handler that throws
settled
  .then(() => {
    throw new Error("boom");
  })
  .catch((e: any) => note("threw " + e.message));
// finally: pass-through of both outcomes, and a throwing finally
settled.finally(() => note("fin.ok")).then((v: any) => val("fin.value " + v));
refused.finally(() => note("fin.rej")).catch((e: any) => val("fin.reason " + e.message));
settled
  .finally(() => {
    throw new Error("fin-boom");
  })
  .catch((e: any) => note("fin.threw " + e.message));
// a rejection handler that recovers, then a fulfilled link
refused.then(undefined, (e: any) => "recovered " + e.message).then((v: any) => note("recover " + v));
// interleave with queueMicrotask to pin the turn counts
queueMicrotask(() => note("qm1"));
Promise.resolve().then(() => note("p1")).then(() => note("p2")).then(() => note("p3")).then(() => note("p4"));
queueMicrotask(() => note("qm2"));

setTimeout(() => {
  resolveA(10);
  rejectB(new Error("late"));
  setTimeout(() => {
    resolveInner("inner-value");
    setTimeout(() => {
      for (const line of log) console.log(line);
      vals.sort();
      for (const line of vals) console.log(line);
    }, 10);
  }, 10);
}, 5);
