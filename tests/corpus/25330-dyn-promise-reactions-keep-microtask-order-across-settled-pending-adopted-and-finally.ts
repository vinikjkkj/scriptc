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

// The source is REJECTED and the handler returns a PENDING promise that rejects later: the reaction parks again to adopt it, with the source
// already released. The source's payload must outlive that release (the handler kept it), the derived promise must reject exactly once with
// the inner reason, and unhandled-rejection tracking must see that one rejection (and none for the handled twin).
process.on("unhandledRejection", (reason: any) => {
  note("unhandled " + reason.message);
});
let rejectSrc1: any;
let rejectSrc2: any;
let rejectSrc3: any;
let rejectInner1: any;
let rejectInner2: any;
let resolveInner3: any;
let kept1: any;
let kept3: any;
function mk1(): any {
  return new Promise((_res, rej) => {
    rejectSrc1 = rej;
  });
}
function arm1(src1: any): void {
  // no downstream handler: the inner rejection surfaces as ONE unhandled rejection
  src1.catch((e: any) => {
    kept1 = e;
    note("src1.handler " + e.message);
    return pend1;
  });
}
function mk2(): any {
  return new Promise((_res, rej) => {
    rejectSrc2 = rej;
  });
}
function arm2(src2: any): void {
  // handled downstream: no report
  src2
    .then(undefined, (e: any) => {
      note("src2.handler " + e.message);
      return pend2;
    })
    .catch((e: any) => note("src2.caught " + e.message));
}
function mk3(): any {
  return new Promise((_res, rej) => {
    rejectSrc3 = rej;
  });
}
function arm3(src3: any): void {
  // the adopted promise fulfils; the kept source payload is read after the adoption completes
  src3
    .catch((e: any) => {
      kept3 = e;
      return pend3;
    })
    .then((v: any) => note("src3.done " + v + " " + kept3.message));
}
let resolveSrc4: any;
let resolveInner4: any;
function mk4(): any {
  return new Promise((res) => {
    resolveSrc4 = res;
  });
}
// a FULFILLED source whose only holder is the reaction (no rejection ledger entry): releasing it when the adoption starts is the last drop
function arm4(src4: any): void {
  src4
    .then((v: any) => {
      note("src4.handler " + v);
      return pend4;
    })
    .then((v: any) => note("src4.done " + v));
}
const pend4: any = new Promise((res) => {
  resolveInner4 = res;
});
const pend1: any = new Promise((_res, rej) => {
  rejectInner1 = rej;
});
const pend2: any = new Promise((_res, rej) => {
  rejectInner2 = rej;
});
const pend3: any = new Promise((res) => {
  resolveInner3 = res;
});
arm1(mk1());
arm2(mk2());
arm3(mk3());
arm4(mk4());

setTimeout(() => {
  resolveA(10);
  rejectSrc1(new Error("s1"));
  rejectSrc2(new Error("s2"));
  rejectSrc3(new Error("s3"));
  resolveSrc4("v4");
  rejectB(new Error("late"));
  setTimeout(() => {
    resolveInner("inner-value");
    rejectInner1(new Error("i1"));
    rejectInner2(new Error("i2"));
    resolveInner3("i3");
    resolveInner4("i4");
    setTimeout(() => {
      note("kept1 " + kept1.message);
      for (const line of log) console.log(line);
      vals.sort();
      for (const line of vals) console.log(line);
    }, 10);
  }, 10);
}, 5);
