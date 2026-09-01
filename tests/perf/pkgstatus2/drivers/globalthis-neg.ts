// NEGATIVE CONTROL. node v25.9.0 HAS fetch, navigator and Blob (own=true in
// the same probe run that measured Bun/Deno absent). The asserted-optional
// shape must NOT fold these to `undefined`: a refusal is correct here, a
// printed "undefined" is a WRONG ANSWER.
console.log('1 fetch:', typeof (globalThis as { readonly fetch?: unknown }).fetch)
console.log('2 navigator:', typeof (globalThis as { readonly navigator?: unknown }).navigator)
