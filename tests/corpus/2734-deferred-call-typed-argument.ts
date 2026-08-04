// A DEFERRED CALL THAT CARRIES ITS ARGUMENTS AT THEIR OWN TYPES.
//
// Every deferral queue in this runtime holds one ZERO-argument closure per
// entry, and a deferred call with arguments is a closure that captured
// them. The general way to build that is the dyn thunk (the callback and
// the arguments box, and a dynCall delivers JS's per-argument checks at
// fire time) — but boxing needs every parameter to have a dyn
// representation, and the node-style callback shape `(err: Error | null)`
// does not: a class instance inside a union has none.
//
// Such a callback is not unsupported, only not DYNAMIC. When the arguments
// as written already land in the parameters, there is nothing left to
// check and the thunk can hold them at their own types. This pins that
// path: the arities JS allows, the values arriving intact and by
// reference, and the FIFO order the queue keeps around them.
const order: string[] = [];

// The shape that cannot box. `null` lands in the union at the deferring
// call, which is where tsc checked it too.
const onErr = (error: Error | null): void => {
  order.push(error === null ? "err:null" : `err:${error.message}`);
};
process.nextTick(onErr, null);
process.nextTick(onErr, new RangeError("boom"));

// Two parameters, and the second is a REFERENCE: the callback must see the
// very array that was deferred, mutations and all.
const shared: number[] = [1, 2];
const onPair = (error: Error | null, xs: number[]): void => {
  order.push(`pair:${error === null}:${xs.length}:${xs === shared}`);
};
process.nextTick(onPair, null, shared);
shared.push(3); // mutated AFTER the deferral: the callback sees 3 elements

// A class instance argument, the case a dyn box refuses outright.
class Token {
  n: number;
  constructor(n: number) {
    this.n = n;
  }
}
const onToken = (t: Token): void => {
  order.push(`token:${t.n}`);
};
process.nextTick(onToken, new Token(7));

// JS arity: arguments past the parameter list still evaluate and are
// dropped. `count` proves the extra argument's expression really ran.
let count = 0;
const bump = (): number => {
  count++;
  return count;
};
const onNone = (): void => {
  order.push(`none count=${count}`);
};
process.nextTick(onNone, bump(), bump());

// setImmediate takes the same trailing arguments, through the same thunk —
// the facility is the closure, not the queue.
setImmediate(onErr, null);
setImmediate((e: Error | null, s: string): void => {
  order.push(`imm:${e === null}:${s}`);
}, null, "tail");

// A tick deferred FROM a tick keeps FIFO with the ticks queued after it.
process.nextTick((error: Error | null): void => {
  order.push(`nested-outer:${error === null}`);
  process.nextTick(onErr, null);
}, null);
process.nextTick(onErr, new TypeError("last"));

setImmediate(() => {
  console.log(order.join(" | "));
});
