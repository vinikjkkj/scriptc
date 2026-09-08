/* patch-arm.mjs — apply a named, LINE-NEUTRAL edit to a probe provenance cache.
 *
 *   node patch-arm.mjs <probeProvRoot> <armName>
 *
 * Rules this file enforces rather than trusts:
 *   - it REFUSES to write outside a path containing `\probe\`, so it can never
 *     touch <blocks>\mongodriver\prov (the read-only real cache) or
 *     <zapo-work>;
 *   - every edit is (line, expectedOldText, newText). The old text must match
 *     the file exactly or the edit throws — a silent no-op edit is how a probe
 *     becomes a false green;
 *   - after the edit it re-counts lines and throws if the count changed. A
 *     four-line probe in this project once "cleared 37 and added 27" that were
 *     the same sites shifted by four lines.
 *   - files are read and written as UTF-8. mongodb's sources contain em dashes
 *     and a latin1 round-trip mangles them into 0x14 control bytes that ride
 *     into the artifact with every gate still green.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const MONGO = '387b6dd29e0aef37fb36607c4a0c652ef0878029'

/* Each edit: [relative path, 1-based line, exact old line, new line].
 * New lines are chosen to keep tsc happy and to change ONE thing. */
const ARMS = {
  /* control: no edit at all */
  P0: [],

  /* the `this.constructor` read inside AbstractOperation.hasAspect */
  P1: [
    [`${MONGO}/src/operations/operation.ts`, 92,
      '    const ctor = this.constructor as { aspects?: Set<symbol> };',
      '    const ctor = { aspects: undefined } as { aspects?: Set<symbol> };'],
  ],

  /* the `response.toObject(...)` call in AbstractOperation.handleOk, whose
   * parameter type is InstanceType<typeof this.SERVER_COMMAND_RESPONSE_TYPE> */
  P2: [
    [`${MONGO}/src/operations/operation.ts`, 152,
      '    return response.toObject(this.bsonOptions) as TResult;',
      '    throw new Error("probe: handleOk body removed"); // returns never, so TResult is unconstrained'],
  ],

  /* both lines of AbstractOperation */
  P3: [
    [`${MONGO}/src/operations/operation.ts`, 92,
      '    const ctor = this.constructor as { aspects?: Set<symbol> };',
      '    const ctor = { aspects: undefined } as { aspects?: Set<symbol> };'],
    [`${MONGO}/src/operations/operation.ts`, 152,
      '    return response.toObject(this.bsonOptions) as TResult;',
      '    throw new Error("probe: handleOk body removed"); // returns never, so TResult is unconstrained'],
  ],

  /* CommandOperation's field redeclaration, RESET half only: `declare` makes
   * the member type-only, so Node emits no [[Define]] and there is no reset --
   * the TYPE change over the inherited slot is untouched. */
  P5a: [
    [`${MONGO}/src/operations/command.ts`, 93,
      '  override options: CommandOperationOptions;',
      '  declare options: CommandOperationOptions;'],
  ],

  /* CommandOperation's field redeclaration removed outright: both the type
   * change and the reset go. */
  P5b: [
    [`${MONGO}/src/operations/command.ts`, 93,
      '  override options: CommandOperationOptions;',
      '  // probe P5b: the `override options` redeclaration is removed'],
  ],

  /* everything in the AbstractOperation -> CommandOperation spine */
  P4: [
    [`${MONGO}/src/operations/operation.ts`, 92,
      '    const ctor = this.constructor as { aspects?: Set<symbol> };',
      '    const ctor = { aspects: undefined } as { aspects?: Set<symbol> };'],
    [`${MONGO}/src/operations/operation.ts`, 152,
      '    return response.toObject(this.bsonOptions) as TResult;',
      '    throw new Error("probe: handleOk body removed"); // returns never, so TResult is unconstrained'],
    [`${MONGO}/src/operations/command.ts`, 93,
      '  override options: CommandOperationOptions;',
      '  // probe P4: the `override options` redeclaration is removed'],
  ],
}

const [root, arm] = process.argv.slice(2)
if (!root || !arm) { console.error('usage: node patch-arm.mjs <probeProvRoot> <armName>'); process.exit(1) }
if (!/[\\/]probe[\\/]/.test(root)) {
  console.error(`REFUSING: ${root} is not under a \\probe\\ directory. The real provenance cache is read-only.`)
  process.exit(2)
}
const edits = ARMS[arm]
if (edits === undefined) { console.error(`unknown arm ${arm}; known: ${Object.keys(ARMS).join(', ')}`); process.exit(1) }

if (edits.length === 0) { console.log(`arm ${arm}: control, 0 edits`); process.exit(0) }

for (const [rel, line, oldText, newText] of edits) {
  const p = `${root}/${rel}`
  const src = readFileSync(p, 'utf8')
  const eol = src.includes('\r\n') ? '\r\n' : '\n'
  const lines = src.split(/\r?\n/)
  const before = lines.length
  const got = lines[line - 1]
  if (got !== oldText) {
    console.error(`EDIT MISMATCH ${rel}:${line}`)
    console.error(`  expected: ${JSON.stringify(oldText)}`)
    console.error(`  found   : ${JSON.stringify(got)}`)
    process.exit(3)
  }
  if (newText.split('\n').length !== 1) { console.error('NOT LINE-NEUTRAL: replacement spans lines'); process.exit(4) }
  lines[line - 1] = newText
  if (lines.length !== before) { console.error('NOT LINE-NEUTRAL: line count changed'); process.exit(4) }
  writeFileSync(p, lines.join(eol), 'utf8')
  const check = readFileSync(p, 'utf8').split(/\r?\n/)
  if (check.length !== before) { console.error(`NOT LINE-NEUTRAL after write: ${before} -> ${check.length}`); process.exit(4) }
  if (check[line - 1] !== newText) { console.error('WRITE DID NOT TAKE'); process.exit(5) }
  console.log(`arm ${arm}: ${rel}:${line} patched, ${before} lines before and after`)
}
