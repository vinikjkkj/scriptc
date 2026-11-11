// `for (const [a, b] of [[...], [...]] as const)` where the element tuples do not share their position types: TypeScript types a and b as the
// union of the positions, and the loop must bind each pair's own values. Only the pairs of one shape used to compile (SC2020 otherwise).
for (const [name, value] of [["a", 1], ["b", "x"]] as const) {
  console.log(name, value, typeof value);
}
for (const [x, y] of [[1, "one"], ["two", 2]] as const) {
  console.log(x, y, typeof x, typeof y);
}
for (const [flag, n, label] of [[true, 1, "yes"], [false, 0, "no"], [true, 2.5, "maybe"]] as const) {
  console.log(flag, n, label);
}
for (const [k, list] of [["nums", [1, 2, 3]], ["words", ["a", "b"]]] as const) {
  console.log(k, list.length, String(list));
}

// A pair list held in a binding, a loop with break and continue, and closures that capture the pair.
const table = [["one", 1], ["two", "II"], ["three", 3], ["four", "IV"]] as const;
const seen: string[] = [];
const getters: (() => string)[] = [];
for (const [word, mark] of table) {
  if (word === "three") continue;
  seen.push(word + ":" + String(mark));
  getters.push(() => word + "/" + String(mark));
  if (word === "four") break;
}
console.log(seen.join(","), getters.map((g) => g()).join(","));

// The tuple comes from a call (not re-emittable per position): it is evaluated once.
let calls = 0;
function pairs(): readonly [readonly ["p", number], readonly ["q", string]] {
  calls++;
  return [["p", 10], ["q", "Q"]] as const;
}
for (const [id, payload] of pairs()) {
  console.log(id, payload);
}
console.log("calls", calls);

// Same-shaped pairs keep working.
for (const [a, b] of [[1, "x"], [2, "y"]] as const) console.log(a, b);
for (const [a, b] of [["a", true], ["b", false]] as const) console.log(a, b);

outer: for (const [p, q] of [[1, "a"], ["b", 2], [3, "c"]] as const) {
  for (const r of [1, 2]) {
    if (p === "b") continue outer;
    console.log(p, q, r);
  }
}
