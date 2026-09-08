import { Reader } from 'argo-codec'

export function main(): void {
  console.log('  static Reader = ' + typeof Reader)
  const r = new Reader(new Uint8Array([7, 2, 3]))
  const b: unknown = r.byte()
  console.log('  static Reader().byte() = ' + String(b as number))
}
main()
