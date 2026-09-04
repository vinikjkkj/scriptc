// The MIRROR of 7500, and the half that needs no arity anywhere.
//
// 7500 pins the PACK: a function written with a rest parameter, filling a
// slot of fixed arity. This pins the UNPACK: a fixed-arity function
// filling a VARIADIC slot, where the slot's callers hand ONE packed array
// and each of the callee's parameters is one element of it.
//
// Every line below answered WRONG at exit 0 with no diagnostic before the
// unpack existed: the whole packed array went in as argument ZERO, so
// `f('alpha', 7)` bound the first parameter to the array's toString,
// "alpha,7", and every later parameter to undefined.
//
// WHY IT IS EXACT and needs no arity word. The checked-dynamic pack is the
// only rest slot whose element type promises nothing (`...args:
// unknown[]`), and a keyed-dyn read of a missing index answers the
// undefined dyn value — which IS what Node binds to a parameter the call
// never reached. So the wrapper reads element `i` for parameter `i` and
// the array's own length decides the rest, with no length test emitted and
// no arity carried. A TYPED pack (`...xs: string[]`) is a different
// object: its out-of-range read traps where Node hands back undefined, so
// that pair refuses instead (tests/diagnostics/
// a-fixed-arity-function-filling-a-rest-parameter-slot.ts pins it).
//
// The DYN BOUNDARY is the same question asked by the runtime rather than
// the lowering, and it used to answer the same way — wrongly. A function
// boxed into a checked-dynamic value and cast BACK to a rest-parameter
// type reaches the per-target adapter, whose one parameter is the pack;
// the boxed thunk underneath wants the arguments positionally. The pack's
// own items ARE that vector, so the spread is one call and no allocation.
// The reverse — a boxed rest function reached through a FIXED signature —
// is the call thunk's side of it: the arguments from the rest slot's index
// on go INTO the pack, where taking `args[L]` alone bound the callee's
// `args` to the first argument and made `args.length` read that
// argument's length.

type Sink = (...args: unknown[]) => void;

function show(tag: string, a: unknown, b: unknown, c: unknown): void {
  console.log(`${tag} a=${String(a)} b=${String(b)} c=${String(c)}`);
}

// A — one declared parameter where the slot packs; called with two
// arguments, with one, and with none.
const one: Sink = (first: unknown): void => {
  show("A", first, "-", "-");
};

// B — three declared parameters, so the trailing ones must come back as
// undefined when the call is short. This is the shape a length test would
// have had to get right and does not exist to get wrong.
const three: Sink = (first: unknown, second: unknown, third: unknown): void => {
  show("B", first, second, third);
};

// C — none at all: the callback that ignores its arguments, which is
// undici's dispatcher shape and zapo's own spelling of it.
const none: Sink = (): void => {
  console.log("C called");
};

// D — LEADING fixed parameters in front of the slot's rest: those stay
// positional and only the tail unpacks.
type Levelled = (level: string, ...rest: unknown[]) => void;
const levelled: Levelled = (level: string, first: unknown, second: unknown): void => {
  console.log(`D level=${level} first=${String(first)} second=${String(second)}`);
};

// The calls go through functions that only know the slot type, so the
// value has genuinely crossed before it is called.
function callTwo(f: Sink): void {
  f("alpha bravo", 7);
}
function callOne(f: Sink): void {
  f("alpha bravo");
}
function callNone(f: Sink): void {
  f();
}

callTwo(one);
callOne(one);
callNone(one);
callTwo(three);
callOne(three);
callNone(three);
callTwo(none);
levelled("warn", "alpha bravo", 7);
levelled("info", "alpha bravo");

// E — the DYN BOUNDARY, both directions. A fixed-arity function boxed
// into a checked-dynamic value and cast to the rest type spreads; a rest
// function boxed and cast to a fixed type packs.
function fixed(a: unknown, b: unknown): void {
  console.log(`E fixed a=${String(a)} b=${String(b)}`);
}
function variadic(...args: unknown[]): void {
  console.log(`E variadic count=${String(args.length)}`);
  for (const a of args) console.log(`E variadic arg: ${String(a)}`);
}

const bag: Record<string, unknown> = { fixed, variadic };

const asRest = bag["fixed"] as (...args: unknown[]) => void;
asRest("x", 7);
asRest("x");
asRest();

const asFixed = bag["variadic"] as (a: unknown, b: unknown) => void;
asFixed("x", 7);

const asSame = bag["variadic"] as (...args: unknown[]) => void;
asSame("x", 7, "z");
