// A function LITERAL written with a REST parameter, filling a slot that
// was declared with FIXED arity. Every line below answered WRONG at exit 0
// with no diagnostic on both backends before the adapter learned to pack:
// `args.length` read 34 for a two-argument call, and `for (const a of
// args)` walked the message string's CHARACTERS.
//
// WHY IT WAS WRONG. `(...args: unknown[]) => void` and
// `(x: unknown) => void` have the same compiled ABI — one parameter, one
// value — and mapType has marked the difference on SIGNATURES since
// IrType.restIn shipped, for exactly this reason ("anything that has to
// BUILD the arguments from outside the compiler must tell them apart or it
// packs an array where the callee wanted the first argument"). The
// DECLARATION side never marked it. So funcCoerceAdapter, which wraps a
// function value whose signature differs from its slot's, saw a
// one-parameter callee, handed it the call's FIRST argument, and dropped
// the rest — and the callee, whose `args` is the packed array, was handed
// a string. `.length` on a dyn string is the string's length.
//
// WHY IT MATTERS BEYOND THE ARITHMETIC. This is the spelling zapo's own
// bench harness uses for its logger (`warn: (...args: unknown[]) => {
// console.warn('[lib warn]', ...args) }` against an interface that
// declares `warn(message: string, context?: ...)`), so every warning line
// in those logs came out letter-spaced. The failure is DATA-shaped: it
// spreads a string into characters instead of passing it.
//
// WHAT THE PACK CANNOT KNOW, and this program pins the boundary: the
// compiled slot ABI fills every declared parameter at the CALL SITE (the
// one-signature contract), so an OMITTED trailing optional and an
// explicitly written `undefined` reach the wrapper as the same value.
// `args.length` is the only thing that can tell them apart in Node. The
// pack tests the trailing undefined-armed slot parameters at run time and
// stops at the last one holding a value, which is Node's answer for the
// omission — the case every line here spells and the one the `context?`
// interfaces in the wild spell. An explicitly passed trailing `undefined`
// is the one shape that still diverges, and it is deliberately NOT in this
// program: pinning it would pin the divergence.

interface Logger {
  warn(message: string, context?: Readonly<Record<string, unknown>>): void;
}

function show(tag: string, args: readonly unknown[]): void {
  console.log(`${tag} count=${String(args.length)}`);
  for (const a of args) console.log(`${tag} arg: ${String(a)}`);
}

// A — the arrow, the reproduction's own shape.
const arrowLog: Logger = {
  warn: (...args: unknown[]): void => {
    show("A", args);
  },
};

// B — the METHOD SHORTHAND, which is a different syntax node and used to
// take the same wrong path.
const methodLog: Logger = {
  warn(...args: unknown[]): void {
    show("B", args);
  },
};

// C — a function EXPRESSION assigned to a variable of the slot's type,
// with no object literal anywhere.
type Slot = (message: string, context?: Readonly<Record<string, unknown>>) => void;
const fnExpr: Slot = function (...args: unknown[]): void {
  show("C", args);
};

// The calls go through a function that only knows the INTERFACE, so the
// value has genuinely crossed into the fixed-arity slot before it is
// called — not folded at the definition.
function emitBoth(l: Logger): void {
  l.warn("failed to decrypt incoming message", { encType: "pkmsg" });
}
function emitOne(l: Logger): void {
  l.warn("no context");
}

emitBoth(arrowLog);
emitOne(arrowLog);
emitBoth(methodLog);
emitOne(methodLog);
fnExpr("failed to decrypt incoming message", { encType: "pkmsg" });
fnExpr("no context");

// D — a slot with MORE fixed parameters than the call supplies, so the
// pack's length is decided by two runtime tests, not one.
type Wide = (a: string, b?: number, c?: string) => void;
const wide: Wide = (...args: unknown[]): void => {
  show("D", args);
};
function callWide1(f: Wide): void {
  f("alpha bravo");
}
function callWide2(f: Wide): void {
  f("alpha bravo", 7);
}
function callWide3(f: Wide): void {
  f("alpha bravo", 7, "zed");
}
callWide1(wide);
callWide2(wide);
callWide3(wide);

// E — a slot with exactly ONE parameter (the pack is a one-element array,
// not the bare value), and a slot with NONE (an empty pack, which used to
// be a hard refusal because the arities did not line up).
type One = (a: string) => void;
const one: One = (...args: unknown[]): void => {
  show("E", args);
};
one("alpha bravo");

type Zero = () => void;
const zero: Zero = (...args: unknown[]): void => {
  show("F", args);
};
zero();

// G — a TYPED rest element (`string[]`, not the checked-dynamic
// `unknown[]`), so the pack is a real array and each slot argument
// converts into the element type. This pair used to throw the stranded
// "parameter types cannot convert" TypeError at the call.
type Two = (a: string, b: string) => void;
const typed: Two = (...args: string[]): void => {
  console.log(`G count=${String(args.length)}`);
  for (const a of args) console.log(`G arg: ${a}`);
};
function callTwo(f: Two): void {
  f("alpha bravo charlie", "delta");
}
callTwo(typed);

// H — LEADING fixed parameters in front of the rest: only the surplus
// packs, and the leading ones stay positional.
type Levelled = (level: string, message: string, context?: Readonly<Record<string, unknown>>) => void;
const levelled: Levelled = (level: string, ...args: unknown[]): void => {
  console.log(`H level=${level}`);
  show("H", args);
};
function callLevelled(f: Levelled): void {
  f("warn", "failed to decrypt incoming message", { encType: "pkmsg" });
}
callLevelled(levelled);
levelled("info", "bare");

// I — an ASYNC rest literal in a promise-returning slot: the adapter wraps
// the same way and the pack is built before the call, not inside it.
type ASlot = (message: string, context?: Readonly<Record<string, unknown>>) => Promise<void>;
const alog: ASlot = async (...args: unknown[]): Promise<void> => {
  show("I", args);
};

// J — the same function value reaching the slot through the DYN boundary
// as well, so the record carrying it is one the checked-dynamic side has
// also seen.
async function main(): Promise<void> {
  await alog("failed to decrypt incoming message", { encType: "pkmsg" });
  await alog("bare");

  const bag: Record<string, unknown> = { n: 1 };
  console.log(`J ${String(bag["n"])}`);
  emitBoth(arrowLog);
}

void main();
