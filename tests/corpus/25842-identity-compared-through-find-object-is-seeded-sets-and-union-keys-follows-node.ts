// Every other way a program can ask whether two reads of a table entry are one object: find/findIndex/filter with ===, Object.is, !==, a Set seeded from an
// array with duplicates, a Map keyed by a union with the record arm, and indexOf/includes over an array of that union. Node has one object per entry.
interface Entry { code: number; flag: boolean | number }
const T = { alpha: { code: 1, flag: true }, beta: { code: 2, flag: 0 } }
const W = T as Record<"alpha" | "beta", Entry>
const list: Entry[] = [W.alpha, W.beta, W.alpha]
console.log(list.find((e) => e === W.beta)?.code, list.findIndex((e) => e === W.beta), list.filter((e) => e === W.alpha).length)
console.log(Object.is(W.alpha, W.alpha), Object.is(W.alpha, W.beta), W.alpha !== W.alpha, W.alpha !== W.beta)
console.log(new Set<Entry>(list).size, new Set<Entry>([W.alpha, T.alpha as Entry]).size)
const um = new Map<Entry | undefined, string>()
um.set(W.alpha, "a")
um.set(undefined, "u")
console.log(um.get(W.alpha), um.get(undefined), um.get(W.beta), um.size)
