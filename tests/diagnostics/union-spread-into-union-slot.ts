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

// The refusal, spread LAST into an argument slot (zapo's
// `{ ...baseEvent, ...parsed }` at client/events/incoming.ts:397).
const p = parse(0);
if (p !== null) {
  console.log(emit({ ...base, ...p }));
}

// The refusal, spread FIRST with an explicit field after it (zapo's
// `{ ...normalized, errors }` at client/events/mex-notification.ts:192).
const q = parse(1);
if (q !== null) {
  console.log(emit({ ...q, rawId: "R2" }));
}

// The refusal reached through a RETURN slot rather than an argument
// (zapo's `thumbnail = { ...fetched, ... }` at
// message/addons/link-preview/fetcher.ts:91 is the assignment form).
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
