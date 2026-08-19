// Every family of structural guard the C backend plants, in one program, so
// the shared-helper collapse has something that RUNS behind it.
//
// The C backend used to open-code the abort at every guard site:
// `if (!o) { scr_trap("scriptc: out of memory\n"); }` after each raw
// allocation, and `default: scr_trap("scriptc: internal error: invalid union
// tag\n");` under each `switch (v->tag)`. The LLVM backend has always emitted
// ONE `@sc_oom` / `@sc_bad_tag` definition and called it (llvm/emitter.ts
// helperDefs), so the same program measured 35 abort statements through the C
// emitter and 2 through the LLVM one -- an emission shape, not a property of
// the program. The C backend now plants the same two helpers.
//
// The guards themselves are UNCHANGED and must stay: the statement after an
// allocation guard dereferences the pointer, and a union-tag default is what
// keeps a corrupt tag loud instead of undefined behaviour. This program's job
// is to make every family exist -- record shapes and classes (the calloc
// guards), async frames (the malloc guards), and unions read through
// truthiness, `===`, `String()`, `JSON.stringify`, an `unknown` box and a
// field discriminated off the box (the tag defaults) -- and then to print an
// answer Node can be diffed against, so "the collapse changed no behaviour" is
// a run and not an inspection.

// ------------------------------------------------------- 1. record shapes
// One sc_rnew_rN constructor per shape, each with its own calloc guard.
type Pt = { x: number; y: number };
type Seg = { a: Pt; b: Pt; label: string };
type Bag = { items: Seg[]; note: string | undefined };

function pt(x: number, y: number): Pt { return { x, y }; }
function seg(a: Pt, b: Pt, label: string): Seg { return { a, b, label }; }

const bag: Bag = {
  items: [seg(pt(0, 0), pt(1, 1), "d"), seg(pt(2, 2), pt(3, 5), "e")],
  note: undefined,
};
console.log("r01", bag.items.length, bag.items[1]!.b.y, bag.note === undefined);

// ------------------------------------------------------------ 2. classes
// A standalone class and a hierarchy: each constructor is its own calloc
// guard, and the derived one covers the flattened-layout allocation.
class Node2 {
  name: string;
  constructor(name: string) { this.name = name; }
  describe(): string { return "node:" + this.name; }
}
class Leaf extends Node2 {
  weight: number;
  constructor(name: string, weight: number) { super(name); this.weight = weight; }
  describe(): string { return "leaf:" + this.name + ":" + String(this.weight); }
}
const nodes: Node2[] = [new Node2("root"), new Leaf("l", 3)];
console.log("r02", nodes.map((n) => n.describe()).join("|"));

// -------------------------------------------------------------- 3. unions
// Every walker the emitter interns per union carries a tag default:
// truthiness, strict equality, ToString, the JSON writer, and the dyn box.
type Val = string | number | boolean | null;

function truthy(v: Val): boolean { return v ? true : false; }
function same(a: Val, b: Val): boolean { return a === b; }
function show(v: Val): string { return String(v); }

const vals: Val[] = ["x", "", 7, 0, true, false, null];
console.log("r03", vals.map(truthy).join(","));
console.log("r04", same(vals[0]!, "x"), same(vals[2]!, 7), same(vals[0]!, vals[2]!));
console.log("r05", vals.map(show).join(","));
console.log("r06", JSON.stringify({ vals }));

// The dyn box: a union widened into `unknown` runs the per-union toDyn
// walker, whose switch carries its own default.
function carry(v: unknown): unknown { return v; }
console.log("r07", vals.map((v) => String(carry(v))).join(","));

// The JSON writer over a union that has an UNDEFINED arm reachable only as a
// record FIELD -- the third helper family (sc_stringify_undef), whose arm the
// record writer drops before it can ever be reached.
type Opt = { kept: string; maybe: string | undefined; n: number | undefined };
const opts: Opt[] = [
  { kept: "a", maybe: "m", n: 1 },
  { kept: "b", maybe: undefined, n: undefined },
];
console.log("r08", JSON.stringify(opts));

// ------------------------------------- 4. a field discriminated off a union
// unionDisc / unionKeyGet: an INLINE switch per expression, not an interned
// helper, so these are the tag defaults that scale with source sites.
type Circle = { kind: "circle"; r: number; id: string };
type Rect = { kind: "rect"; w: number; h: number; id: string };
type Shape = Circle | Rect;

const shapes: Shape[] = [
  { kind: "circle", r: 2, id: "c1" },
  { kind: "rect", w: 3, h: 4, id: "r1" },
  { kind: "circle", r: 5, id: "c2" },
];
function idOf(s: Shape): string { return s.id; }
function area(s: Shape): number { return s.kind === "circle" ? 3 * s.r * s.r : s.w * s.h; }
console.log("r09", shapes.map(idOf).join(","));
console.log("r10", shapes.map((s) => String(area(s))).join(","));

// --------------------------------------------------------------- 5. async
// The async frame pack and the generator spawn pack are the other half of the
// OOM guard population (1,313 of zapo's 2,642) -- a malloc, guarded.
async function widen(s: Shape): Promise<string> {
  const n = await Promise.resolve(area(s));
  return idOf(s) + "=" + String(n);
}
function* walk(xs: Shape[]): Generator<string> {
  for (const s of xs) yield idOf(s);
}

async function main(): Promise<void> {
  const parts: string[] = [];
  for (const s of shapes) parts.push(await widen(s));
  console.log("r11", parts.join(","));
  const walked: string[] = [];
  for (const id of walk(shapes)) walked.push(id);
  console.log("r12", walked.join(","));

  // 6. the guards must still be REACHABLE code: every allocation above is
  // dereferenced on the very next statement, which is the whole reason the
  // OOM guard exists. Re-running the shapes through a fresh set proves the
  // constructors are live rather than folded away.
  const more: Seg[] = [];
  for (let i = 0; i < 4; i += 1) more.push(seg(pt(i, i), pt(i + 1, i * 2), "s" + String(i)));
  console.log("r13", more.map((s) => s.label + ":" + String(s.b.y)).join(","));
  console.log("r14", JSON.stringify(more[3]));
}

await main();

export {};
