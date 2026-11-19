// Marshalling before and after island code adds keys to Object.prototype: a copy still has its own keys, in the same order, and an inherited key shows up through
// the prototype exactly as in Node.
const dump: any = new Function("o", "var r = []; for (var k in o) r.push(k); return JSON.stringify(o) + '|' + r.join(',') + '|' + Object.keys(o).length + '|' + (o.later === undefined ? 'noinherit' : o.later)")
const grow: any = new Function("Object.prototype.later = 'L'; return 1")
const out: string[] = []
for (let i = 0; i < 4; i++) out.push(dump({ a: i, b: i + 1 }))
out.push(String(grow()))
for (let i = 0; i < 4; i++) out.push(dump({ a: i, b: i + 1 }))
out.push(dump({ a: 1, later: "own" }))
console.log(out.join("\n"))
