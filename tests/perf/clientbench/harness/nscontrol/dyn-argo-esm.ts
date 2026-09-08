// CONTROL: the same census, but naming argo-codec's ESM barrel by PATH, so
// the CJS barrel's appended export table is not in the picture.
export async function main(): Promise<void> {
  const m = (await import('argo-codec/dist/esm/index.js')) as unknown as Record<string, unknown>
  for (const k of ['encode', 'decode', 'Reader', 'Buf']) console.log('  esm ' + k + ' = ' + typeof m[k])
}
void main()
