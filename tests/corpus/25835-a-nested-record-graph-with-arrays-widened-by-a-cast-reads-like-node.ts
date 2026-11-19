// A read-only record graph that carries arrays and a nested record, cast to a wider element type and read through the cast.
interface Leaf { readonly id: number; readonly tags: readonly string[] }
interface WideLeaf { readonly id: number; readonly tags: readonly string[]; readonly note?: string }
const GRAPH = Object.freeze({
  one: Object.freeze({ id: 1, tags: Object.freeze(["a", "b"]) }),
  two: Object.freeze({ id: 2, tags: Object.freeze(["c"]) }),
  three: Object.freeze({ id: 3, tags: Object.freeze([] as string[]) }),
})
type K = keyof typeof GRAPH
const wide = GRAPH as Readonly<Record<K, WideLeaf>>
const narrow: Readonly<Record<K, Leaf>> = GRAPH
for (const k of ["one", "two", "three"] as K[]) console.log(k, wide[k].id, wide[k].tags.length, wide[k].tags.join("+"), wide[k].note, narrow[k].tags.length)
console.log(JSON.stringify(wide))
