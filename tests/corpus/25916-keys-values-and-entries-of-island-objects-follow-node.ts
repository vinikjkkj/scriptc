// Object.keys / values / entries over plain objects made by engine code: own key order (integer-like keys first), empty and wide objects, repeated, and a later write by the engine.
const mk: any = new Function("n", "var o = {}; for (var i = 0; i < n; i++) o['k' + i] = i * 3; o[7] = 7; o[2] = 2; o['-1'] = -1; return o")
const grow: any = new Function("o", "o.late = 99; delete o.k0; return o")
const out: string[] = []
for (const n of [0, 1, 5, 40, 150]) {
  for (let rep = 0; rep < 3; rep++) {
    const o = mk(n) as Record<string, number>
    out.push(n + ":" + Object.keys(o).join(",") + "|" + Object.values(o).join(",") + "|" + JSON.stringify(Object.entries(o)))
  }
}
const g = grow(mk(3)) as Record<string, number>
out.push(Object.keys(g).join(",") + "|" + Object.values(g).join(","))
const s = (new Function("return { b: 'x', a: 'y', 10: 'z', 9: 'w' }") as () => Record<string, string>)()
out.push(Object.keys(s).join(",") + "|" + Object.values(s).join(",") + "|" + JSON.stringify(Object.entries(s)))
console.log(out.join("\n"))
