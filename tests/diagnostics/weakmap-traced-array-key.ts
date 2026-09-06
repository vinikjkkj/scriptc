// The REFUSED side of the WeakMap key boundary.
//
// An UNTRACED array is an admitted weak key (corpus 7785:
// `WeakMap<readonly string[], readonly string[]>` compiles and is exact
// against node). A TRACED one is not, and must not be: an array whose
// elements carry a cycle header is allocated through scr_cyc_alloc and can
// be reclaimed by the collector's collectWhite WITHOUT passing through
// scr_arr_release, so the death hook that makes an address-keyed table
// sound would never fire for it. A stale entry in an address-keyed table is
// a WRONG ANSWER, not a leak — a later object landing on the dead key's
// address reads the dead key's value.
//
// This file exists because a predicate tested only on what it accepts is
// untested. isSupportedWeakKey under-approximates tracedness from the type
// alone (it cannot reach the emitter's module-level fixpoint), so these are
// the cases where it must say NO.

interface Rec {
  readonly a: number;
  readonly b: string;
}

// 1. Array of RECORDS: records carry a cycle header, so the array is traced.
const recordKeyed = new WeakMap<Rec[], string>();

// 2. Array of ARRAYS: the inner array's tracedness is a fixpoint answer, so
//    the outer one is refused rather than guessed at.
const nestedKeyed = new WeakMap<string[][], string>();

// 3. Bare `object` — phase 3, still waiting on the collector hook.
const objectKeyed = new WeakMap<object, number>();

// 4. A scalar value has no pointer for the table to hold, so even an
//    admitted key kind is refused with one.
const scalarValued = new WeakMap<Uint8Array, number>();

console.log(recordKeyed, nestedKeyed, objectKeyed, scalarValued);
