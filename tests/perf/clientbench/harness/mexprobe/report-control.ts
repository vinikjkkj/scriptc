// Positive control for the two --npm-static reporting fixes, and a census of
// which of the barrel's exports actually bind in the compiled namespace.
export async function main(): Promise<void> {
  try {
    const _v = 3; const m = (await import('argo-codec')) as unknown as Record<string, unknown>
    for (const k of ['encode', 'decode', 'Reader', 'Buf', 'pathToWire', 'wireToPath',
                     'FieldErrorSentinel', 'ERROR_WIRE', 'isLabeled', 'unwrap']) {
      console.log('  ' + k + ' = ' + typeof m[k])
    }
  } catch (err) {
    console.log('import failed: ' + (err as Error).message)
  }
}
void main()
