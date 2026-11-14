// Dyn object members hold two one-bit facts beside the key length: whether the key bytes are a compiler literal (never freed) and whether the
// value is a non-owning back-reference. Everything below stores, grows, overwrites, deletes and re-adds members whose keys come from literals
// and from built strings, copies them through JSON, Object.assign and spread, and lets whole objects die, so a wrong flag shows as a wrong key,
// a crash or (in the san lanes) a leak or a double free.
function build(n) {
  const o = {};
  for (let i = 0; i < n; i++) {
    o["k" + i] = i;                       // built keys: malloc'd copies
  }
  o.literal = "lit";                      // literal keys: stored by pointer
  o["al" + "so"] = "built-later";
  o.nested = { a: 1, ["b" + n]: [n] };
  return o;
}

function grow() {
  const o = { first: 1 };
  const seen = [];
  for (let i = 0; i < 40; i++) {
    o["m" + i] = { v: i };
    if (i % 7 === 0) delete o["m" + (i >> 1)];
    if (i % 5 === 0) o.first = i;         // overwrite a literal-keyed member
    seen.push(Object.keys(o).length);
  }
  return [seen.join(","), JSON.stringify(Object.keys(o).slice(0, 8)), o.first];
}

function deleteReadd() {
  const o = { a: 1, b: 2, c: 3 };
  delete o.b;
  o.b = 20;                               // re-add under a literal key
  const k = "b";
  delete o[k];
  o["b" + ""] = 30;                       // re-add under a built key equal to the literal one
  o.a = o.a + 1;
  return JSON.stringify(o) + "|" + Object.keys(o).join("");
}

function roundTrip() {
  const src = build(12);
  const copy = JSON.parse(JSON.stringify(src));
  const merged = Object.assign({}, src, { k3: "over", extra: true });
  const spread = { ...copy, spreadKey: 1, ["k" + 5]: "again" };
  return [JSON.stringify(copy) === JSON.stringify(src), merged.k3, merged.extra, Object.keys(spread).length, spread.k5, spread.literal].join(",");
}

function churn() {
  // many short-lived objects of different member counts, so tables are freed and recycled in every size class
  let total = 0;
  for (let r = 0; r < 300; r++) {
    const o = build(1 + (r % 9));
    const p = Object.assign({}, o);
    for (const k of Object.keys(p)) if (k.length > 2) delete p[k];
    total += Object.keys(o).length * 10 + Object.keys(p).length;
  }
  return total;
}

function holders() {
  // objects holding objects holding objects, released inner-first and outer-first
  const outer = { inner: { deep: { leaf: "x" + "y" } }, list: [{ n: 1 }, { n: 2 }] };
  outer.inner.up = outer;                 // an owning cycle: the collector must free it
  const copy = { ...outer, extra: outer.inner.deep };
  delete outer["inn" + "er"];
  return [Object.keys(outer).join(), Object.keys(copy).join(), copy.inner.deep.leaf, copy.extra.leaf].join("|");
}

console.log(JSON.stringify(build(5)));
console.log(JSON.stringify(grow()));
console.log(deleteReadd());
console.log(roundTrip());
console.log(churn());
console.log(holders());
for (let i = 0; i < 2000; i++) holders();
console.log("done");
