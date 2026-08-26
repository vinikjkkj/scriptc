// A DataView maps to bytes<u8> statically (types.ts: "the ONE view
// kind"), and the run-time spread walk steps SCR_DYN_BYTES byte by byte
// -- but a DataView is NOT iterable in JS. Every position's text, from
// the oracle.
function fmt(args: unknown[]): string {
  let line = "n=" + String(args.length) + " ["
  for (let i = 0; i < args.length; i++) {
    if (i > 0) line = line + ","
    line = line + String(args[i])
  }
  return line + "]"
}
function take(...args: unknown[]): void {
  console.log(fmt(args))
}
function show(tag: string, f: () => void): void {
  try {
    f()
    console.log(tag + ": no throw")
  } catch (e) {
    console.log(tag + ": " + (e instanceof TypeError ? "TypeError" : "Other") + ": " + (e instanceof Error ? e.message : String(e)))
  }
}
const u8 = new Uint8Array([1, 2, 3])
const dv = new DataView(u8.buffer)
const asDyn: unknown = dv

// SOLE spread in LAST position -- the optimized apply-path text.
show("sole", () => { take(...(asDyn as unknown as unknown[])) })
// NOT sole / NOT last -- the iterator-protocol text, which describes the VALUE.
show("mid", () => { take(...(asDyn as unknown as unknown[]), "after") })
show("after-fixed", () => { take("head", ...(asDyn as unknown as unknown[])) })

// The CONTROL: the very same bytes as a Uint8Array must still spread.
show("u8-control", () => { take(...u8) })
console.log("still running")
