// NEGATIVE control for the --npm-static confirmation line.
//
// The positive arm (report-control.ts + `--npm-static argo-codec`) can only
// ever say "static", so on its own it is a check that can only say yes. This
// asks for a package the opt-in is expected to REFUSE, so the same code path
// must print the FELL BACK line instead. If both programs print "compiled
// statically", the line is not reporting anything.
export async function main(): Promise<void> {
  try {
    const m = (await import('ws')) as unknown as Record<string, unknown>
    console.log('  ws default = ' + typeof m['default'])
  } catch (err) {
    console.log('import failed: ' + (err as Error).message)
  }
}
void main()
