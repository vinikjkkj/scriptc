// CONTROL: is an EMPTY dynamic-import namespace a --npm-static problem, or
// does every `await import()` of a statically compiled module come back
// empty? This one imports a PROGRAM module -- no npm, no rewrite.
export async function main(): Promise<void> {
  const m = (await import('./locmod.js')) as unknown as Record<string, unknown>
  console.log('  LOCAL_NUM = ' + typeof m['LOCAL_NUM'] + ' / ' + String(m['LOCAL_NUM']))
  console.log('  localFn   = ' + typeof m['localFn'])
}
void main()
