// Property order of a copy: integer-like keys ascend first, the rest in insertion order, for every object of a repeated key sequence.
const keys: any = new Function("o", "return Object.keys(o).join(',') + '|' + JSON.stringify(o) + '|' + Object.entries(o).length")
const forin: any = new Function("o", "var r = []; for (var k in o) r.push(k + '=' + o[k]); return r.join(';')")
const out: string[] = []
for (let i = 0; i < 5; i++) {
  const o: any = { b: i, "2": i + 1, a: i + 2, "1": i + 3, "10": i + 4, z: "x" + i }
  out.push(keys(o), forin(o))
}
const p: any = { toString: 1, valueOf: 2, constructor: 3, hasOwnProperty: 4 }
for (let i = 0; i < 4; i++) out.push(keys(p), forin(p))
console.log(out.join("\n"))
