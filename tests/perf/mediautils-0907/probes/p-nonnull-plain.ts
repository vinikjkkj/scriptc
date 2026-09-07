// PROBE: `!` on an ordinary nullable union, no child surface involved.
declare const s: string | null
const t: string = s!
console.log(t.length)
