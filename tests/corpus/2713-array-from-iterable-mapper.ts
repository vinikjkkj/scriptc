// Array.from(iterable, (v, i) => ...) — the two-argument MAP form over a
// real iterable (Set / Array / String), which is `[...iterable].map(fn)`:
// only the mapper-less drains and the `{ length: n }` counted-generation
// form lowered before, so a Set/Array/String source with a mapper fenced
// (the store-teardown `Array.from(uniqueBackends, b => destroy(b))`
// shape). It builds the base array with the same drains the one-arg form
// uses, then the ordinary array-map machinery — the mapper receives the
// ELEMENT (not the counted form's undefined) and the index, left to
// right, JS-exact. Set insertion order and dedup ride the drain.

const s = new Set<number>([3, 1, 4, 1, 5, 9, 2, 6])
console.log(Array.from(s, (x) => x * 2).join(','))
console.log(Array.from(s, (x, i) => `${i}:${x}`).join('|'))

const arr = [10, 20, 30]
console.log(Array.from(arr, (n) => `n${n}`).join(','))

console.log(Array.from('abc', (c, i) => `${c}${i}`).join(''))

// The mapper's effects run left to right, exactly once each.
let order = ''
const names = new Set(['al', 'bob', 'carol'])
const lens = Array.from(names, (nm) => {
    order += nm[0]
    return nm.length
})
console.log(lens.join(','), order)
