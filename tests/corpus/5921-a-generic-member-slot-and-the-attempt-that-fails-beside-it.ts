// A generic callable MEMBER held in a record slot — `<K extends keyof Ev>(e:
// K, ...args: Parameters<Ev[K]>) => void`, the emitter idiom — used to leave
// the shape unless SCRIPTC_GENERIC_SLOT was set, a switch that shipped OFF.
// The walk that admits it is SPECULATIVE: the member is mapped at its
// constraint instantiation and drops out of the shape if that fails, so the
// attempt runs under a retraction point.
//
// The retraction is the reason the switch existed, and it was incomplete in a
// way the switch did not protect anyone from — the identical attempt already
// ran ungated at the constraint-erasure site. What it did was TRUNCATE the
// shape and union id arrays, so the next unrelated shape was handed a
// discarded one's id, while mapType's memo — a WeakMap, so unenumerable and
// unpurgeable — still named the old one. That crashed the compiler outright
// (tests/harness/spec-rollback.test.ts carries the five-line program and the
// stack).
//
// This file is the differential half: every construct the ungated walk now
// admits, and a member the walk still cannot map sitting next to types that
// must come out unharmed. Nothing here is scriptc-specific — Node runs the
// same text and the two must agree byte for byte.
//
// Every handler in a key map takes ONE parameter on purpose: the rule refuses
// a map whose handlers disagree on arity (mapParametersAliasOverBoundKey's
// `arity split`), so a two-parameter event here would refuse the whole slot
// and this file would be testing the refusal instead of the slot.
import { EventEmitter } from "node:events";

/* ── the slot itself ──────────────────────────────────────────────────── */

interface Ev {
  alpha: (p: { readonly kind: string }) => void;
  beta: (n: number) => void;
}

interface Sink {
  readonly emitEvent: <K extends keyof Ev>(event: K, ...args: Parameters<Ev[K]>) => void;
}

class Bus extends EventEmitter {
  sink(): Sink {
    return { emitEvent: this.emit.bind(this) };
  }
}

const bus = new Bus();
bus.on("alpha", (p: { readonly kind: string }) => {
  console.log("alpha " + p.kind);
});
bus.on("beta", (n: number) => {
  console.log("beta " + String(n));
});

const sink = bus.sink();
sink.emitEvent("alpha", { kind: "A" });
sink.emitEvent("beta", 7);

/* ── an ALIASED handler: the key map names a type, not a function type ── */

type Named = (p: { readonly n: string }) => void;
interface Ev2 {
  one: Named;
  two: Named;
}
interface Sink2 {
  readonly send: <K extends keyof Ev2>(event: K, ...args: Parameters<Ev2[K]>) => void;
}
const bus2 = new Bus();
bus2.on("one", (p: { readonly n: string }) => {
  console.log("one " + p.n);
});
bus2.on("two", (p: { readonly n: string }) => {
  console.log("two " + p.n);
});
const sink2: Sink2 = { send: bus2.emit.bind(bus2) };
sink2.send("one", { n: "x" });
sink2.send("two", { n: "y" });

/* ── a generic member mapped at its constraint and CALLED through the slot ─ */

interface Reg {
  readonly a: number;
  readonly b: number;
}
interface Ops {
  readonly pick: <K extends keyof Reg>(k: K) => number;
}
const reg: Reg = { a: 1, b: 2 };
const ops: Ops = { pick: (k) => reg[k] };
console.log("pick " + String(ops.pick("a")) + String(ops.pick("b")));

/* ── the attempt that FAILS, beside the types it walked through ────────── */

// `A extends Nest` maps — interning `Nest` and its inner `{ c: number }` —
// and then the unconstrained `B` has no widest honest binding, so the whole
// member is retracted. `nest` is read afterwards and has to be itself: this
// is exactly the sequence that used to hand `{ c: number }`'s id to whatever
// was interned next while the memo still answered with it.
interface Nest {
  readonly a: string;
  readonly b: { readonly c: number };
}
interface Holder {
  readonly bad: <A extends Nest, B>(x: A, y: B) => void;
  readonly nest: Nest;
}
const holder: Holder = {
  bad: (_x, _y) => {},
  nest: { a: "s", b: { c: 42 } },
};
console.log("nest " + holder.nest.a + String(holder.nest.b.c));

// The same failure with a RECURSIVE type inside the retracted region: the
// attempt mints a placeholder the retraction must unbind without letting a
// later mapping resume it.
interface Tree {
  readonly tag: string;
  readonly kids: readonly Tree[];
}
interface TreeHolder {
  readonly bad: <A extends Tree, B>(x: A, y: B) => void;
  readonly tree: Tree;
}
const treeHolder: TreeHolder = {
  bad: (_x, _y) => {},
  tree: { tag: "root", kids: [{ tag: "leaf", kids: [] }] },
};
console.log(
  "tree " + treeHolder.tree.tag + String(treeHolder.tree.kids.length) + treeHolder.tree.kids[0]!.tag,
);

// ...and with a UNION, for the union registry's half of the retraction.
interface Wrap {
  readonly v: string | number;
}
interface WrapHolder {
  readonly bad: <A extends Wrap, B>(x: A, y: B) => void;
  readonly wrap: Wrap;
}
const wrapHolder: WrapHolder = { bad: (_x, _y) => {}, wrap: { v: "s" } };
console.log("wrap " + typeof wrapHolder.wrap.v);

/* ── the shapes the attempt walked through, used INDEPENDENTLY ─────────── */

// Built from scratch, not through a holder: if a retracted id had been
// handed to something else, these are the reads that would come back wrong
// rather than merely missing.
const standalone: Nest = { a: "z", b: { c: 7 } };
console.log("standalone " + standalone.a + String(standalone.b.c));
const standaloneTree: Tree = { tag: "t", kids: [] };
console.log("standaloneTree " + standaloneTree.tag + String(standaloneTree.kids.length));
console.log(JSON.stringify({ nest: standalone, wrap: wrapHolder.wrap }));
