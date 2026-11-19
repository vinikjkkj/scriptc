// The island copies a dynamic object into the engine. Objects with the same key sequence share one engine shape, and each copy stays its own object: island code
// mutates, freezes and extends its copy within one call, and the next call's copy of an equal object starts from the original, never from the last call's changes.
const mutate: any = new Function("o", "var before = Object.keys(o).join(','); o.a = o.a + 100; o.extra = 1; delete o.c; return before + '>' + Object.keys(o).join(',') + ':' + o.a")
const freeze: any = new Function("o", "Object.freeze(o); try { o.a = 5 } catch (e) {} return Object.isFrozen(o) + ':' + o.a + ':' + Object.keys(o).join(',')")
const read: any = new Function("o", "return Object.keys(o).join(',') + ':' + o.a + ':' + o.b + ':' + o.c + ':' + Object.isFrozen(o)")
const out: string[] = []
for (let i = 0; i < 6; i++) {
  out.push(read({ a: i, b: "s" + i, c: i % 2 === 0 }))
  out.push(mutate({ a: i, b: "s" + i, c: i % 2 === 0 }))
  out.push(freeze({ a: i, b: "s" + i, c: i % 2 === 0 }))
  out.push(read({ a: i, b: "s" + i, c: i % 2 === 0 }))
  out.push(mutate({ a: i, b: "s" + i, c: i % 2 === 0 }))
}
console.log(out.join("\n"))
