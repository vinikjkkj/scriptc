// `Array.from({ length: n }, mapfn)` synthesizes its result type straight
// from the MAPPER's signature -- `arrayOf(fnRet)` -- so no declared array
// type is ever consulted and mapType's array rule, which leaves every
// unrepresentable element unmapped, never sees it.
//
// A mapper returning the checked-dynamic value therefore built an array of
// `dyn`, which ScrArr has no element representation for, and the C backend
// died with `emitter bug: no array element representation for dyn` -- on
// every lane, including the release default (the LLVM refusal falls back to
// C). This file pins the REFUSAL that replaced the crash. Upstream
// vercel-labs/scriptc #183 (58c214a4).
//
// The counted form is the seat that was missing the gate; the two-argument
// map form over a real iterable had it, and is here as the twin so the two
// spellings stay pinned to the same answer.
//
// THE ADVICE IN THE MESSAGE WAS COMPILED AND RUN before it shipped. The
// generic component fence (SC2009) could not be used here: its hint names
// 'unknown' as part of the compilable set, and 'unknown' IS the blocker.
// A DECLARED `unknown[]` really is compilable -- mapType maps a dyn element
// to the whole-array dyn -- so the message says to build one, and both
// spellings it names match node v25.9.0 on both backends.
const counted = Array.from({ length: 2 }, (_v, i) => JSON.parse(`{"n":${i}}`) as unknown);
console.log(counted.length);

const mapped = Array.from([1, 2], (n) => JSON.parse(`{"n":${n}}`) as unknown);
console.log(mapped.length);
