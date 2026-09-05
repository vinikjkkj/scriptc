// clearTimeout / clearInterval / clearImmediate over an OPTIONAL handle —
// `let t: ReturnType<typeof setTimeout> | undefined`, the shape every
// cancel-in-a-finally idiom has, and the one zapo's companion-host
// handshake writes:
//
//   let finishTimeout: ReturnType<typeof setTimeout> | undefined
//   try { finishTimeout = setTimeout(...); ... } finally { clearTimeout(finishTimeout) }
//
// Node's clear functions take anything and do nothing when the argument is
// not a live handle, so an optional handle needs no narrowing to mean
// something: either the value carries the id and the timer is cancelled, or
// it does not and the call is a no-op. The `| null` spelling is the same
// question. What this file checks is that BOTH arms behave — a cleared
// timer must not fire, and an absent handle must not throw.

let fired: string[] = [];

// The arm that holds an id: the callback must NOT run.
let t1: ReturnType<typeof setTimeout> | undefined;
t1 = setTimeout(() => { fired.push("t1"); }, 5);
clearTimeout(t1);

// The arm that is absent: the call is a no-op, not a throw.
let t2: ReturnType<typeof setTimeout> | undefined;
clearTimeout(t2);

// The `| null` spelling, both arms.
let t3: ReturnType<typeof setTimeout> | null = setTimeout(() => { fired.push("t3"); }, 5);
clearTimeout(t3);
let t4: ReturnType<typeof setTimeout> | null = null;
clearTimeout(t4);

// A timer that is deliberately LEFT running proves the clears above are
// doing something rather than the whole battery silently never firing.
let t5: ReturnType<typeof setTimeout> | undefined = setTimeout(() => { fired.push("t5"); }, 5);
void t5;

// The finally shape, run twice: once where the timer was armed and once
// where the try threw before arming it.
function guarded(arm: boolean, boom: boolean): string {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (arm) timer = setTimeout(() => { fired.push("guarded"); }, 5);
    if (boom) throw new Error("boom");
    return "ok";
  } catch (e) {
    return `caught ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    clearTimeout(timer);
  }
}
console.log(guarded(true, false));
console.log(guarded(false, true));
console.log(guarded(true, true));

// clearInterval over an optional handle, both arms. The armed interval
// would fire forever if the clear did not land.
let i1: ReturnType<typeof setInterval> | undefined = setInterval(() => { fired.push("i1"); }, 1);
clearInterval(i1);
let i2: ReturnType<typeof setInterval> | undefined;
clearInterval(i2);

// clearImmediate over an optional handle, both arms.
let m1: ReturnType<typeof setImmediate> | undefined = setImmediate(() => { fired.push("m1"); });
clearImmediate(m1);
let m2: ReturnType<typeof setImmediate> | undefined;
clearImmediate(m2);

// Clearing the SAME optional handle twice is a no-op the second time.
let t6: ReturnType<typeof setTimeout> | undefined = setTimeout(() => { fired.push("t6"); }, 5);
clearTimeout(t6);
clearTimeout(t6);

// A handle held in a record field, read out through an optional binding.
type Entry = { name: string; timer: ReturnType<typeof setTimeout> | undefined };
const entries: Entry[] = [
  { name: "a", timer: setTimeout(() => { fired.push("a"); }, 5) },
  { name: "b", timer: undefined },
];
for (const e of entries) clearTimeout(e.timer);

// Everything above either never armed or was cleared, except t5. Give the
// loop a turn to run whatever survived, then report.
setTimeout(() => {
  fired.sort();
  console.log(`fired=[${fired.join(",")}]`);
}, 40);
