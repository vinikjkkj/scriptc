// Many key sequences (more than the cache holds), nested objects and arrays of one shape, and value kinds that differ from call to call under one key sequence.
const dump: any = new Function("o", "return JSON.stringify(o) + ':' + (o && typeof o.v)")
const out: string[] = []
const vals: unknown[] = [1, "two", true, null, undefined, [1, [2, 3]], { deep: { deeper: [1] } }, 1.5, -0, "", false]
for (let i = 0; i < 80; i++) {
  const o = { id: i, v: vals[i % vals.length], tag: "t" + (i % 3) }
  out.push(dump(o))
  const keys: any = {}
  for (let k = 0; k <= i % 40; k++) keys["k" + k + "_" + (i % 7)] = k
  out.push(dump(keys))
}
const list: any[] = []
for (let i = 0; i < 20; i++) list.push({ name: "n" + i, n: i, inner: { x: i, y: [i, i + 1] } })
out.push(dump(list), dump({ v: list }))
console.log(out.join("\n"))
