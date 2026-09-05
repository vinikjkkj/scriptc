// The `any`-indexed record crossing the checked-dynamic boundary in both
// directions: into an `unknown` parameter and back out through a cast, and
// an `unknown` value stored INTO the index and read back at its own type.
// The store's value representation is the same one `[k: string]: unknown`
// already compiles to, so the two spellings meet inside it.
interface Doc { [key: string]: any }
interface Loose { [key: string]: unknown }

function kind(u: unknown): string { return typeof u }
function takeLoose(l: Loose): string { return String(l.a) }
function takeDoc(d: Doc): string { return String(d.a) }

const d: Doc = { a: 1, s: 'x' }
console.log(kind(d), kind(d.a), kind(d.s))

// out: Doc -> unknown -> Doc
const u: unknown = d
const back = u as Doc
console.log(String(back.a), String(back.s))

// the two spellings are the same store
console.log(takeLoose(d as Loose))
const l: Loose = { a: 2 }
console.log(takeDoc(l as Doc))

// in: an unknown value written through the index, read back
const v: unknown = 'written'
d.w = v
console.log(String(d.w), typeof d.w)
const readBack: string = d.w
console.log(readBack.length)
