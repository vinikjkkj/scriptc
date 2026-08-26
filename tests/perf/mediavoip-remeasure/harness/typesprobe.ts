// ARMED CONTROL for the @types/node lane.
//
// `execFile(file, args, options, callback)` — the 4-argument overload — exists
// only in real @types/node. scriptc's fallback `scriptc-node-fallback.d.ts`
// declares a 1-3 argument `execFile` and rejects this call with SC0001
// "Expected 1-3 arguments, but got 4".
//
// MUST-BUCKET  : with real @types/node this file reports ZERO SC0001 sites.
// MUST-NOT     : `typesprobe-neg.ts` (a genuine type error) MUST report SC0001,
//                so a run that reports zero everywhere is a broken query, not a
//                clean lane.
import { execFile } from 'node:child_process'

export function probe(): void {
    execFile('node', ['-v'], { encoding: 'utf8' }, (_err, stdout) => {
        console.log(stdout)
    })
}
