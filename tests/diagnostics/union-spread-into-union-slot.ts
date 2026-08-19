// An object literal that spreads a MULTI-record-arm union into a
// union-typed slot: which arm the result inhabits is decided by the
// source at run time, and a literal builds one shape.
//
// This is the message's own regression pin. On main all of these reported
// SC2011 — "values of type 'Ev' have no static representation but run in
// the embedded dynamic engine, which this build does not include" — and
// BOTH halves were false. mapType answers a union for exactly the type
// the message named (the slot has a static representation), and a
// `--dynamic` build refuses the same site with SC2001 rather than running
// it, so the hint pointed at a build that fails the same way and the
// coverage report counted the sites as dynamic-capable.
//
// zapo carries the construct at three sites and the false message sent a
// census after four separate "causes" that were one. The fence now names
// the construct, in the union-source spread's own voice — the per-field
// merge one level down already refuses the same source once the target
// shape is known.
//
// The remedy is pinned as a running program in
// tests/corpus/3891-union-spread-narrowed-first.ts: narrow the source and
// every one of these compiles.
//
// Every consumer here is a REAL function. An ambient `declare function`
// parameter does not drive the literal down this path at all — the first
// draft of this fixture used one and two of its three cases compiled.

interface Base {
  readonly rawId: string;
}

interface ArmA {
  readonly kind: "a";
  readonly lidJid: string;
}

interface ArmB {
  readonly kind: "b";
  readonly oldLidJid: string;
}

type Parsed = ArmA | ArmB;

interface EvA extends Base {
  readonly kind: "a";
  readonly lidJid: string;
}

interface EvB extends Base {
  readonly kind: "b";
  readonly oldLidJid: string;
}

type Ev = EvA | EvB;

function parse(n: number): Parsed | null {
  if (n === 0) return { kind: "a", lidJid: "L" };
  if (n === 1) return { kind: "b", oldLidJid: "O" };
  return null;
}

function emit(e: Ev): string {
  return e.kind === "a" ? e.lidJid : e.oldLidJid;
}

const base: Base = { rawId: "R" };

// NO LONGER the fence, and its absence from this snapshot is the proof.
// `{ ...baseEvent, ...parsed }` at client/events/incoming.ts:397 is a plain
// record CONTRIBUTOR under the union spread, and the relation is exact by
// construction rather than invented: `Parsed` is the slot's arms MINUS the
// base event's names, so `ArmA` + `rawId` IS `EvA` and `ArmB` + `rawId` IS
// `EvB`. The paired-arm rule folds a contributor's names into the source
// side of its pairing key for the same reason it folds a plain override's
// in -- the branch BUILDS those names without reading them from the source
// arm -- and the source still wins every name it declares, because the
// source spread is written after the contributor and JS's spread is
// later-wins. Corpus 4752 runs the whole population byte-exact against Node.
const p = parse(0);
if (p !== null) {
  console.log(emit({ ...base, ...p }));
}

// NO LONGER the fence, and its absence from this snapshot is the proof.
// Spread FIRST with an explicit field after it is zapo's
// `{ ...normalized, errors }` at client/events/mex-notification.ts:192, and
// the relation is exact rather than invented: the source union is the slot's
// arms MINUS the name the literal supplies. `ArmA` + `rawId` IS `EvA`;
// `ArmB` + `rawId` IS `EvB`. The paired-arm rule now folds a PLAIN override's
// name into the source side of its pairing key — a plain override is written
// into every branch unconditionally, so no source read is ever emitted for it
// and it belongs to the shape the branch BUILDS, not the one it reads.
// Corpus 4711 runs the whole population byte-exact against Node.
//
const q = parse(1);
if (q !== null) {
  console.log(emit({ ...q, rawId: "R2" }));
}

// ALSO no longer the fence: the same contributor shape reached through a
// RETURN slot rather than an argument.
function build(n: number): Ev | null {
  const r = parse(n);
  return r === null ? null : { ...base, ...r };
}
console.log(build(0));

// NOT the fence, and its absence from this snapshot is the proof: a
// SINGLE-record-arm union source (`X | undefined`) is the optional-options
// merge the per-field present-test desugar owns. Two record arms are
// required, so this one keeps compiling.
interface Opts {
  readonly host: string;
  readonly port: number;
}
function overrides(n: number): { readonly port: number } | undefined {
  return n === 0 ? undefined : { port: 9 };
}
const o: Opts = { host: "h", port: 1, ...overrides(1) };
console.log(o.port);

// STILL the fence, case 1: a CONTRIBUTOR that is itself a UNION. "Which
// contributor supplies this name" stops being a compile-time fact -- the two
// arms of the contributor can declare different names at different types --
// and the per-arm rebuild has no shape to copy from. Only a plain record
// contributor is admitted.
interface LeadNum {
  readonly rawId: string;
  readonly at: number;
}

interface LeadStr {
  readonly rawId: string;
  readonly at: string;
}

interface EvWA {
  readonly kind: "a";
  readonly lidJid: string;
  readonly rawId: string;
  readonly at: number | string;
}

interface EvWB {
  readonly kind: "b";
  readonly oldLidJid: string;
  readonly rawId: string;
  readonly at: number | string;
}

type EvW = EvWA | EvWB;

function emitW(e: EvW): string {
  return e.kind === "a" ? e.lidJid : e.oldLidJid;
}

function buildW(lead: LeadNum | LeadStr, n: number): string | null {
  const r = parse(n);
  return r === null ? null : emitW({ ...lead, ...r });
}
console.log(buildW({ rawId: "R", at: 1 }, 0));

// STILL the fence, case 2, and this is the one the contributor rule is armed
// against: PER-ARM PRECEDENCE. `n` is supplied by the contributor and also
// declared by ONE source arm, so Node reads it from the SOURCE in that arm and
// from the CONTRIBUTOR in the other -- "which contributor owns this name" is
// no longer arm-independent. The configuration needs no rule of its own: the
// two source arms collapse onto ONE pairing key once the contributor's names
// join it, and the pairing refuses as AMBIGUOUS rather than picking an arm.
interface PSrcA {
  readonly k: string;
  readonly n: number;
  readonly t: number;
}

interface PSrcB {
  readonly k: string;
  readonly t: string;
}

interface POutA {
  readonly k: string;
  readonly n: number;
  readonly t: number;
}

interface POutB {
  readonly k: string;
  readonly n: number;
  readonly t: string;
}

interface PLead {
  readonly k: string;
  readonly n: number;
}

function emitP(x: POutA | POutB): string {
  return x.k + String(x.n) + String(x.t);
}

function buildP(lead: PLead, s: PSrcA | PSrcB): string {
  return emitP({ ...lead, ...s });
}
console.log(buildP({ k: "K", n: 1 }, { k: "K", n: 2, t: 3 }));
