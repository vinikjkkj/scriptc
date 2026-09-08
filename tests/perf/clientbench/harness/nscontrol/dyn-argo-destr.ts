// The destructuring spelling, also prescribed by the hint.
export async function main(): Promise<void> {
  const { Reader } = await import('argo-codec')
  console.log('  Reader = ' + typeof Reader)
  const r = new Reader(new Uint8Array([7, 2, 3]))
  console.log('  new Reader ok')
  const b: unknown = r.byte()
  console.log('  byte() = ' + String(b as number))
}
void main()
