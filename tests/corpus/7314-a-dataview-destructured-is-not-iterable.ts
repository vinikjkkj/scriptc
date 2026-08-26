// Destructuring a DataView held in a dyn slot. The source is a BARE
// IDENTIFIER so the compile-time spelling is available, which is the
// shape Node's text names.
function pack(v: unknown[]): void {
  const [a, b] = v
  console.log("got " + String(a) + "," + String(b))
}
const u8 = new Uint8Array([1, 2, 3])
const dv = new DataView(u8.buffer)
const view: unknown[] = dv as unknown as unknown[]
try {
  pack(view)
} catch (e) {
  console.log("destructure: " + (e instanceof Error ? e.message : String(e)))
}
const bytes: unknown[] = u8 as unknown as unknown[]
try {
  pack(bytes)
} catch (e) {
  console.log("u8 control: " + (e instanceof Error ? e.message : String(e)))
}
