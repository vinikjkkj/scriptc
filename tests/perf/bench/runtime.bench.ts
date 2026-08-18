// The COMPILER-COST axes.
//
// messaging.bench.ts is dominated by sha256, which is the same C in both
// lanes and therefore HIDES the compiler. This file is the opposite: every
// scenario sits on one thing the compiler decides, so a regression has a
// name before a profiler is opened.
//
// FOLD RESISTANCE - this was learned the hard way. A first version of this
// file measured `a += i` and reported 1.006e9 ops/s from the exe and
// 3.113e9 ops/s from Node. Both are impossible for real work at these
// clocks: LLVM recognises the closed form of `a += i` and V8 eliminates a
// loop whose result is unobservable. Every scenario below therefore:
//   1. reads from `seed[]`, whose contents come from the environment at
//      runtime, so no term is a compile-time constant;
//   2. carries a dependency chain the optimiser cannot close;
//   3. ends by PRINTING the accumulator, so the work is observable.
// and the harness flags any scenario faster than FOLD_CEILING as suspect
// rather than publishing it. A bench that cannot report "this number is not
// real" cannot be trusted when it reports one that is.

import { runScenario, benchEnd, envInt } from "./_bench.ts"

const N = envInt("BENCH_N", 200000)
const FOLD_CEILING = envInt("BENCH_FOLD_CEILING", 300000000)

// Runtime-valued data: nothing here is knowable at compile time.
const SEED = envInt("BENCH_SEED", 12345)
const MASK = 1023
const seed: number[] = []
for (let i = 0; i <= MASK; i++) seed.push((SEED + i * 7919) % 65521)

let acc = 0

// ── numeric: `%` on numbers lowers to a libm fmod() call ─────────────
runScenario("numeric-modulo", "ops", N, () => {
  let a = acc
  for (let i = 0; i < N; i++) a += seed[i & MASK] % 7
  acc = a % 1000000007
}, FOLD_CEILING)

// The SAME loop without `%`, so the fmod cost is subtracted, not argued.
runScenario("numeric-add", "ops", N, () => {
  let a = acc
  for (let i = 0; i < N; i++) a += seed[i & MASK]
  acc = a % 1000000007
}, FOLD_CEILING)

// ── closures: scr_closure_new + a retain/release pair per call ───────
runScenario("closure-churn", "closures", N, () => {
  let a = acc
  for (let i = 0; i < N; i++) {
    const base = seed[i & MASK]
    const f = (x: number): number => x + base
    a += f(i & 1)
  }
  acc = a % 1000000007
}, FOLD_CEILING)

// ── the closure ABLATION LADDER ──────────────────────────────────────
// closure-churn above is 17x slower than Node and the question is WHICH
// part. Each rung below removes exactly one mechanism from the loop
// above it, so the differences price the mechanisms instead of arguing
// about them:
//
//   closure-churn         box alloc + closure alloc + call + 3 releases
//   closure-nocapture     closure alloc + call + releases   (no box)
//   closure-call-hoisted  call + retain/release only        (no alloc)
//
// churn - nocapture      = the captured BOX
// nocapture - hoisted    = the CLOSURE object
// hoisted                = the indirect call and its refcount traffic
//
// Every rung reads seed[] and feeds the same accumulator, so none of
// them is a different amount of arithmetic dressed up as a control.
runScenario("closure-nocapture", "closures", N, () => {
  let a = acc
  for (let i = 0; i < N; i++) {
    const f = (x: number): number => x + 1
    a += f(seed[i & MASK] & 1)
  }
  acc = a % 1000000007
}, FOLD_CEILING)

const hoisted = (x: number): number => x + 1
runScenario("closure-call-hoisted", "calls", N, () => {
  let a = acc
  for (let i = 0; i < N; i++) a += hoisted(seed[i & MASK] & 1)
  acc = a % 1000000007
}, FOLD_CEILING)

// ── strings: immutable concat, scr_string.c reallocates ──────────────
runScenario("string-build", "concats", N, () => {
  let a = acc
  let s = ""
  for (let i = 0; i < N; i++) {
    s = "k" + seed[i & MASK]
    a += s.length
  }
  acc = a % 1000000007
}, FOLD_CEILING)

// ── maps: scr_map.c hashing per set/get ──────────────────────────────
const m = new Map<string, number>()
runScenario("map-churn", "ops", N, () => {
  let a = acc
  for (let i = 0; i < N; i++) {
    const k = "k" + (seed[i & MASK] & 4095)
    m.set(k, i)
    const v = m.get(k)
    if (v !== undefined) a += v & 1
  }
  acc = a % 1000000007
}, FOLD_CEILING)

// ── arrays: scr_array.c push/index ───────────────────────────────────
runScenario("array-churn", "ops", N, () => {
  let a = acc
  const arr: number[] = []
  for (let i = 0; i < N; i++) arr.push(seed[i & MASK])
  for (let i = 0; i < arr.length; i++) a += arr[i] & 1
  acc = a % 1000000007
}, FOLD_CEILING)

// ── records: plain field reads ───────────────────────────────────────
runScenario("record-field", "reads", N, () => {
  let a = acc
  for (let i = 0; i < N; i++) {
    const r = { a: seed[i & MASK], b: i & 7, c: "x", d: true }
    a += r.a + r.b
  }
  acc = a % 1000000007
}, FOLD_CEILING)

// The accumulator is OBSERVED. Without this line every loop above is
// legal to delete.
console.log("SCBENCH-CHECKSUM acc=" + acc)
benchEnd()
