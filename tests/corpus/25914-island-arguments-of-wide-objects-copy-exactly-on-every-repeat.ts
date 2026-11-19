// Objects of 31..200 keys (past and around the template cache's key limit), repeated so later calls take the shared-shape path: key order, value kinds and island-side writes must match Node (a write to the island copy is not visible to the native object, so it is not re-read).
const dump: any = new Function("o", "return JSON.stringify(o) + ':' + Object.keys(o).length")
const touch: any = new Function("o", "o.extra = 1; o.k0 = 'changed'; delete o.k1; o.k2 = o.k2 + 'x'; return Object.keys(o).slice(0, 4).join(',') + '|' + Object.keys(o).length")
const out: string[] = []
const kinds: unknown[] = [1, "s", true, null, undefined, [1, 2], { a: { b: 1 } }, 1.5, -0, "", false]
for (const w of [1, 31, 32, 33, 47, 100, 127, 128, 129, 200]) {
  for (let rep = 0; rep < 4; rep++) {
    const o: any = {}
    for (let k = 0; k < w; k++) o["k" + k] = kinds[(k + rep) % kinds.length]
    out.push(w + "/" + rep + " " + dump(o))
    out.push(touch(o))
  }
}
// integer-like keys and a reordered sequence inside a wide object
for (let rep = 0; rep < 3; rep++) {
  const a: any = {}
  for (let k = 0; k < 50; k++) a[k % 2 === 0 ? String(50 - k) : "n" + k] = k
  out.push(dump(a))
  const b: any = {}
  for (let k = 49; k >= 0; k--) b["n" + k] = k + rep
  out.push(dump(b))
}
console.log(out.join("\n"))
