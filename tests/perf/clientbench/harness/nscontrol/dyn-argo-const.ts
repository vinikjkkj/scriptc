// The spelling the compiler's own hint prescribes: the namespace at a CONST
// binding, member-read directly, no cast.
export async function main(): Promise<void> {
  const ns = await import('argo-codec')
  console.log('  Reader = ' + typeof ns.Reader)
  console.log('  decode = ' + typeof ns.decode)
  const r = new ns.Reader(new Uint8Array([7, 2, 3]))
  console.log('  new Reader ok')
  const b: unknown = r.byte()
  console.log('  byte() = ' + String(b as number))
}
void main()
