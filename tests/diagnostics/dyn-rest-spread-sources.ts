// A spread INTO a dyn rest slot lowers (the pack's length is the call's
// arity), but only for a source the run-time walk can step.
//
// scr_dyn_arr_push_spread iterates exactly three dyn kinds without an
// engine: ARR, STR and BYTES. Everything else boxes by REFERENCE and the
// walk throws V8's spread-call TypeError at a call Node completes — a
// wrong answer, not a missing feature. The statically-ITERABLE kinds that
// CAN be drained first are (a Set, a class iterable, the wider typed
// arrays); the ones below cannot, and refuse by naming the type.
//
// A Map is iterable in JS and yields one [key, value] ARRAY per entry;
// nothing in this compiler turns a static Map into that array, so the
// spread has nothing to hand the walk.
function take(...args: unknown[]): void {
  console.log(args.length);
}

const mp = new Map<string, number>([["a", 1]]);
take(...mp);

// A generator object: its protocol is the engine's, and a no-engine build
// has no drain for it at the dyn boundary.
function* gen(): Generator<string> {
  yield "g";
}
take(...gen());

// A PROMISE converts to dyn perfectly well (SCR_DYN_PROMISE) and is not
// iterable at all — the widest of the reference boxes canConvertToDyn
// admits, and the one whose acceptance would have been least visible.
const p: Promise<number> = Promise.resolve(1);
take(...(p as unknown as unknown[]));
