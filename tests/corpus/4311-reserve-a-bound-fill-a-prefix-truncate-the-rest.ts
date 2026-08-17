// RESERVE an upper bound, fill a PREFIX under a counter, throw the unwritten
// tail away with `a.length = counter` — the second way a program keeps a
// scalar hole from ever being read, and the one the counting-loop proof
// (2686) cannot see: the writes are indexed by the COUNTER, not by the loop
// variable, and the body's `continue` is the whole point of the idiom rather
// than a reason to decline.
//
// Before this both halves fenced, and they fenced in the order the source
// wrote them, so the second one was invisible:
//   SC2020 'new Array(count) with 'number' elements'
//   SC2020 'assigning '.length' on 'number'-element arrays'
// They are ONE fact stated twice — admitting either alone leaves a readable
// scalar 0 where Node reads undefined — so one proof answers both sites and
// each site requires the proof to name the very node it is lowering.
//
// zapo's `src/signal/session/resolver.ts` is the live consumer: the two
// diagnostics above are its lines 282 and 345, they are the ONLY two traps in
// their emitted host function, and the shape below is that function's,
// transcribed.
//
// The proof is syntactic and conservative. It requires a `const` array, a
// `let c = 0` before the loop, the counting loop over the SAME length
// expression the reserve used, writes `a[c] = ...` at the top level of the
// body, the counter's ONLY mutation as the body's LAST statement, the array
// untouched between the reserve and the loop and between the loop and the
// truncation, and the length expression's root unmutated throughout. Every
// one of those is what makes `c <= N` and "[0,c) is written" true; break any
// one and the fence comes back, which is checked outside the corpus (a
// corpus case can only hold programs that compile).

// --- the row: zapo's shape, number elements, with `continue` ----------------
function prepare(
  missingIndices: readonly number[],
  jids: readonly string[],
  bundles: readonly (string | null)[],
): { kept: number[]; labels: string[]; dropped: number } {
  const prepareTargetIndices = new Array<number>(missingIndices.length);
  const prepareLabels = new Array<string>(missingIndices.length);
  let prepareCount = 0;
  const missingBundleTargets: { jid: string; reason: string }[] = [];
  for (let index = 0; index < missingIndices.length; index += 1) {
    const targetIndex = missingIndices[index]!;
    const targetJid = jids[targetIndex]!;
    const bundle = bundles[index];
    if (!bundle) {
      missingBundleTargets.push({ jid: targetJid, reason: "missing key bundle" });
      continue;
    }
    prepareTargetIndices[prepareCount] = targetIndex;
    prepareLabels[prepareCount] = `${bundle}:${targetJid}`;
    prepareCount += 1;
  }
  if (prepareCount === 0) {
    return { kept: [], labels: [], dropped: missingBundleTargets.length };
  }
  prepareTargetIndices.length = prepareCount;
  prepareLabels.length = prepareCount;
  return { kept: prepareTargetIndices, labels: prepareLabels, dropped: missingBundleTargets.length };
}

const idx = [0, 1, 2, 3];
const jids = ["a@s", "b@s", "c@s", "d@s"];
const some = prepare(idx, jids, ["B0", null, "B2", null]);
console.log("some:", JSON.stringify(some.kept), some.labels.join("|"), some.dropped, some.kept.length);

// Nothing dropped: the truncation is a no-op and every slot was written.
const all = prepare(idx, jids, ["B0", "B1", "B2", "B3"]);
console.log("all:", JSON.stringify(all.kept), all.labels.join("|"), all.dropped, all.kept.length);

// Everything dropped: the early return runs and the array is never read.
const none = prepare(idx, jids, [null, null, null, null]);
console.log("none:", JSON.stringify(none.kept), JSON.stringify(none.labels), none.dropped);

// An empty bound: `new Array<number>(0)` reserves nothing, the loop never
// runs, and the early return answers.
const empty = prepare([], [], []);
console.log("empty:", JSON.stringify(empty.kept), empty.dropped);

// --- the other accepted spellings: `i++` for the loop, `c++` for the tick ---
function evensUnder(n: number): number[] {
  const out = new Array<number>(n);
  let k = 0;
  for (let i = 0; i < n; i++) {
    if (i % 2 !== 0) {
      continue;
    }
    out[k] = i;
    k++;
  }
  out.length = k;
  return out;
}
console.log("evens:", JSON.stringify(evensUnder(7)), JSON.stringify(evensUnder(1)), JSON.stringify(evensUnder(0)));

// --- boolean elements take the same road ------------------------------------
function flagsOf(words: readonly string[]): boolean[] {
  const flags = new Array<boolean>(words.length);
  let n = 0;
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i]!;
    if (w.length === 0) {
      continue;
    }
    flags[n] = w.length % 2 === 0;
    n += 1;
  }
  flags.length = n;
  return flags;
}
console.log("flags:", JSON.stringify(flagsOf(["ab", "", "xyz", "", "pqrs"])));
console.log("flags-empty:", JSON.stringify(flagsOf(["", ""])));

// --- the truncated array is a NORMAL array afterwards ------------------------
// Nothing about the reserve survives the truncation: push, index, join, spread
// and iteration all answer over exactly the kept prefix.
const kept = prepare(idx, jids, ["B0", null, "B2", null]).kept;
kept.push(99);
let sum = 0;
for (const v of kept) sum += v;
console.log("after:", kept.join(","), kept.length, sum, JSON.stringify([...kept]), kept.indexOf(2));

// --- CONTROL: refcounted elements, which never needed a proof ----------------
// `new Array<string>(n)` carries an absent slot already, so this compiled
// before and must keep answering identically.
function labelsOnly(words: readonly string[]): string[] {
  const out = new Array<string>(words.length);
  let n = 0;
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i]!;
    if (w.length === 0) {
      continue;
    }
    out[n] = w.toUpperCase();
    n += 1;
  }
  out.length = n;
  return out;
}
console.log("refcounted:", JSON.stringify(labelsOnly(["ab", "", "xyz"])));

// --- CONTROL: the counting-loop proof (2686) is untouched --------------------
const table = new Array<number>(5);
for (let i = 0; i < 5; i += 1) {
  table[i] = i * i;
}
console.log("countingloop:", table.join(","), table.length);

// --- the reserve is evaluated exactly once -----------------------------------
let bounds = 0;
function bound(): number {
  bounds += 1;
  return 3;
}
const size = bound();
const once = new Array<number>(size);
let m = 0;
for (let i = 0; i < size; i += 1) {
  once[m] = i * 10;
  m += 1;
}
once.length = m;
console.log("once:", bounds, once.join(","), once.length);
