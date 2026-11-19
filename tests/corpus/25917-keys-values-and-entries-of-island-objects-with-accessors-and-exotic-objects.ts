// Objects that are not plain data (a getter, a frozen object, an array, a Proxy) follow the engine's own semantics, as Node does.
const get: any = new Function("var o = { a: 1 }; Object.defineProperty(o, 'g', { get() { return 5 }, enumerable: true }); o.z = 3; return o")
const frozen: any = new Function("return Object.freeze({ p: 1, q: 2 })")
const arr: any = new Function("return [4, 5, 6]")
const proxy: any = new Function("return new Proxy({ x: 1, y: 2 }, { ownKeys() { return ['y', 'x'] } })")
const out: string[] = []
const show = (o: Record<string, number>) => Object.keys(o).join(",") + "|" + Object.values(o).join(",") + "|" + JSON.stringify(Object.entries(o))
out.push(show(get() as Record<string, number>))
out.push(show(frozen() as Record<string, number>))
out.push(show(arr() as Record<string, number>))
out.push(show(proxy() as Record<string, number>))
const plain: any = new Function("return { m: 1, n: 2 }")
out.push(show(plain() as Record<string, number>))
console.log(out.join("\n"))
